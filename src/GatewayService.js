const EventBus = require('weplay-common').EventBus

const sio = require('socket.io')
const fps = require('fps')

const CompressorListeners = require('./CompressorListeners')
const RomListeners = require('./RomListeners')
const SocketHandler = require('./SocketHandler')
const FrameBroker = require('./FrameBroker')

class GatewayService {
  constructor(port, discoveryUrl, discoveryPort, statusPort, redis) {
    const romListeners = new RomListeners()
    const compressorListeners = new CompressorListeners()

    this.uuid = require('node-uuid').v4()
    this.logger = require('weplay-common').logger('weplay-gateway-service', this.uuid)
    this.tickers = {}
    this.ticker = fps({every: 200})
    this.ticker.on('data', framerate => {
      this.logger.info('GatewayService[%s] fps %s', this.uuid, framerate)
    })

    this.roomHashes = []
    this.clients = []
    this.clientsHashes = {}
    this.roomInfo = {}

    this.frameBroker = new FrameBroker()

    this.bus = new EventBus({
      url: discoveryUrl,
      port: discoveryPort,
      statusPort: statusPort,
      name: 'gateway',
      id: this.uuid,
      clientListeners: [
        {name: 'rom', event: 'hash', handler: romListeners.onRomHash.bind(this)},
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

    // this.logger.info('Reconnecting to frame streams');
    // this.frameBroker.reconnect.bind(this)();
  }

// sends connections count to everyone
// by aggregating all servers
  updateCount(total) {
    this.redis.hset('weplay:connections', this.uuid, total)
  }

  updateClients(clientId, hash) {
    this.clientsHashes[clientId] = hash
    this.redis.hset('weplay:clients', clientId, JSON.stringify({hash: hash, io: this.uuid}))
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
    this.logger.debug('joinStream', {hash: hash, clientId: clientId})
    socket.join(hash)
    socket.room = hash
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
    this.logger.info('GatewayService.broadcast', {room: room, args: args})

    this.io.to(room).emit.apply(this.io.to(room), args)

    this.redis.lpush('weplay:log', JSON.stringify({room: room, args: args}))
    this.redis.ltrim('weplay:log', 0, 20)

    // ? this.bus.broadcast('game:nick', {nick: nick, clientId: socket.id});
  }

  replayEventLog(socket) {
    this.logger.info('GatewayService.replayEventLog', socket.nick)
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
    this.bus.broadcast('weplay:io:unsubscribe', this.uuid)
    this.bus.destroy()
  }
}
module.exports = GatewayService
