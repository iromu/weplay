const EventBus = require('weplay-common').EventBus

const sio = require('socket.io')
const memwatch = require('memwatch-next')

const CompressorListeners = require('./CompressorListeners')
const RomListeners = require('./RomListeners')
const SocketHandler = require('./SocketHandler')
const FrameBroker = require('./FrameBroker')

const CHECK_INTERVAL = 10000

class GatewayService {
  constructor(port, discoveryUrl, discoveryPort, statusPort, redis) {
    const romListeners = new RomListeners()
    const compressorListeners = new CompressorListeners()

    this.uuid = require('node-uuid').v4()
    this.logger = require('weplay-common').logger('weplay-gateway-service', this.uuid)
    this.tickers = {}
    this.hashes = []
    this.hashesClient = {}
    this.roomHashes = []
    this.clients = []
    this.clientsHashes = {}
    this.roomInfo = {}

    memwatch.on('stats', (stats) => {
      this.logger.info('stats', stats)
    })
    memwatch.on('leak', (info) => {
      this.logger.error('leak', info)
    })
    this.frameBroker = new FrameBroker()

    this.bus = new EventBus({
      url: discoveryUrl,
      port: discoveryPort,
      statusPort: statusPort,
      name: 'gateway',
      id: this.uuid,
      clientListeners: [
        {name: 'rom', event: 'hash', handler: romListeners.onRomHash.bind(this)},
        {name: 'rom', event: 'data', handler: romListeners.onRomData.bind(this)},
        {name: 'compressor', event: 'connect', handler: compressorListeners.onConnect.bind(this)},
        {name: 'compressor', event: 'disconnect', handler: compressorListeners.onDisconnect.bind(this)}
      ]
    }, () => {
      this.logger.debug('GatewayService connected to discovery server', {
        discoveryUrl: discoveryUrl,
        uuid: this.uuid
      })
      this.init()
    })

    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = undefined
    }

    this.checkInterval = setInterval(() => {
      this.check()
    }, CHECK_INTERVAL)

    this.redis = redis
    this.io = module.exports = sio(port)
    // redis socket.io adapter
    const uri = process.env.WEPLAY_REDIS || 'redis://localhost:6379'
    this.io.adapter(require('socket.io-redis')(uri))
    this.io.total = 0

    const socketHandler = new SocketHandler(this)
    this.io.on('connection', socketHandler.onConnection.bind(this))
  }

  init() {
    this.logger.info('Emitting', {channel: 'rom', event: 'defaultHash'})
    this.bus.emit('rom', 'defaulthash')
    this.bus.emit('rom', 'list')
    // this.roomHashesQ = this.roomHashes
    // this.roomHashes = []
    // this.roomHashesQ.forEach(this.startBroadcastingFrames.bind(this))
    // this.logger.info('Reconnecting to frame streams');
    // this.frameBroker.reconnect.bind(this)();
  }

// sends connections count to everyone
// by aggregating all servers
  updateCount(total) {
    this.redis.hset('weplay:connections', this.uuid, total)
  }

  check() {
    var hashesClientInfo = {}
    for (var property in this.hashesClient) {
      if (this.hashesClient.hasOwnProperty(property)) {
        hashesClientInfo[property] = this.hashesClient[property].length
        if (this.hashesClient[property].length === 0) {
          delete this.hashesClient[property]
        }
      }
    }
    this.logger.info('GatewayService.check hashesClientInfo', hashesClientInfo)
    this.roomHashes.forEach(room => {
      if (this.hashesClient[room] === undefined) {
        this.frameBroker.stopBroadcastingFrames.bind(this)(room)
      }
    })
  }

  updateClients(clientId, hash) {
    // Purge client from all caches
    for (var h in this.hashesClient) {
      if (this.hashesClient.hasOwnProperty(h)) {
        this.hashesClient[h] = this.hashesClient[h].filter(c => c !== clientId)
        if (this.hashesClient[h].length === 0) {
          delete this.hashesClient[h]
        }
      }
    }
    // Create if empty
    if (!this.hashesClient[hash]) {
      this.hashesClient[hash] = []
    }
    // Add client to hash
    this.hashesClient[hash].push(clientId)
    this.clientsHashes[clientId] = hash
    this.redis.hset('weplay:clients', clientId, JSON.stringify({hash: hash, io: this.uuid}))
  }

  removeClient(clientId, clientNick) {
    delete this.clientsHashes[clientId]
    for (var hash in this.hashesClient) {
      if (this.hashesClient.hasOwnProperty(hash)) {
        this.hashesClient[hash] = this.hashesClient[hash].filter(c => c !== clientId)
        if (this.hashesClient[hash].length === 0) {
          delete this.hashesClient[hash]
        }
      }
    }
    if (clientNick) {
      this.clients = this.clients.filter(item => item !== clientNick)
    }
  }

  onFrame(frame) {
    this.logger.debug('onFrame')
  }

  onRawFrame(frame) {
    this.logger.debug('onRawFrame')
  }

  startBroadcastingFrames(room) {
    this.logger.info('GatewayService.startBroadcastingFrames', room)
    this.frameBroker.startBroadcastingFrames.bind(this)(room)
  }

  joinStream(hash, socket, clientId) {
    clientId = clientId === undefined ? socket.id : clientId
    // Already joined ?
    if (hash === this.clientsHashes[clientId]) {
      return
    }
    if (socket.room) {
      socket.leave(socket.room)
    } else if (this.clientsHashes[clientId]) {
      socket.leave(this.clientsHashes[clientId])
    }
    if (this.hashesClient[hash]) {
      this.hashesClient[hash] = this.hashesClient[hash].filter(c => c !== clientId)
    }
    // this.logger.debug('joinStream', {hash: hash, clientId: clientId})
    socket.join(hash)
    socket.room = hash
    this.clientsHashes[clientId] = hash
    this.frameBroker.startBroadcastingFrames.bind(this)(hash)
    this.updateClients(clientId, hash)
  }

  /** Sends an action performed by any user to all users connected to the same room.
   *
   * Stores user event log data.
   * */
  broadcastEventLog(socket) {
    const args = Array.prototype.slice.call(arguments, 1)
    var room = socket.room || this.defaultRomHash
    this.io.to(room).emit.apply(this.io.to(room), args)
    this.redis.lpush('weplay:log', JSON.stringify({room: room, args: args}))
    this.redis.ltrim('weplay:log', 0, 20)
  }

  replayEventLog(socket) {
    this.redis.lrange('weplay:log', 0, 20, (err, log) => {
      if (err) {
        this.logger.error(err)
      }
      if (!Array.isArray(log)) {
        return
      }
      log.reverse().forEach(data => {
        data = data.toString()
        const wrapper = JSON.parse(data)
        const args = wrapper.args
        const room = wrapper.room
        if (Array.isArray(args)) {
          if (room && socket.room && socket.room === room) {
            socket.emit(...args)
          } else if (!room) {
            socket.emit(...args)
          }
        } else {
          this.logger.error(data)
        }
      })
    })
  }

  destroy() {
    this.logger.info('Destroying data.')
    this.redis.hdel('weplay:connections', this.uuid)
    this.clients.forEach(client => {
      this.redis.hdel('weplay:clients', client)
    })
    this.bus.destroy()
  }
}

module.exports = GatewayService
