const forwarded = require('forwarded-for')

const throttle = process.env.WEPLAY_THROTTLE || 100

const keys = {
  right: 0,
  left: 1,
  up: 2,
  down: 3,
  a: 4,
  b: 5,
  select: 6,
  start: 7
}

class SocketHandler {
  constructor(delegate) {
    this.delegate = delegate
    this.queue = []
  }

  onConnection(socket) {
    const req = socket.request
    const ip = forwarded(req, req.headers)
    const clientId = socket.id
    this.clients.push(clientId)
    var clientNick
    // keep track of connected clients
    this.updateCount(++this.io.total)
    if (this.defaultRomHash) {
      socket.romHash = this.defaultRomHash
      this.joinStream(this.defaultRomHash, socket, clientId)
    } else {
      this.bus.emit('rom', 'defaulthash')
      // if (!this.queue[this.defaultRomHash])this.queue[this.defaultRomHash] = {};
      // if (!this.queue[this.defaultRomHash].joinStream)this.queue[this.defaultRomHash].joinStream = [];
      // this.queue[this.defaultRomHash].joinStream.push({socket: socket, clientId: clientId});
      this.logger.error('On connection found no default hash to join.', {id: socket.id, ip: ip})
    }

    socket.on('disconnect', () => {
      this.updateCount(--this.io.total)
      this.logger.debug('disconnect', {event: 'disconnect', nick: clientNick, id: socket.id, ip: ip})
      this.broadcastEventLog(socket, 'disconnected', clientNick)
      if (this.defaultRomHash) {
        delete this.clientsHashes[clientId]
        this.redis.publish(`weplay:leave:${this.defaultRomHash}`, clientId)
      }
      this.redis.hdel('weplay:clients', clientId)
      this.redis.hdel('weplay:nicks', clientId)
      this.clients = this.clients.filter(item => item !== clientNick)
      clientNick = undefined
    })

    // send events log so far
    this.replayEventLog(socket)

    // broadcast moves, throttling them first
    socket.on('move', key => {
      if (!keys[key]) {
        return
      }
      var self = this
      this.redis.get(`weplay:move-last:${clientId}`, function (err, last) {
        if (last) {
          last = last.toString()
          if (Date.now() - last < throttle) {
            return
          }
        }
        self.logger.debug('< weplay:move', {
          event: 'move',
          key: keys[key],
          move: key,
          socket: {nick: socket.nick, id: socket.id},
          ip: ip
        })
        self.redis.set(`weplay:move-last:${clientId}`, Date.now())
        self.redis.expire(`weplay:move-last:${clientId}`, 1)
        self.redis.publish(`weplay:move:${this.defaultRomHash}`, keys[key])
        self.broadcastEventLog(socket, 'move', key, socket.nick)
      })
    })

    socket.on('command', command => {
      if (!command) {
        return
      }
      this.redis.get(`weplay:command-last:${clientId}`, (err, last) => {
        if (last) {
          last = last.toString()
          if (Date.now() - last < throttle) {
            return
          }
        }
        this.logger.debug('< weplay:command', {
          event: 'command',
          command: command,
          socket: {nick: socket.nick, id: socket.id},
          ip: ip
        })
        this.redis.set(`weplay:command-last:${clientId}`, Date.now())
        this.redis.expire(`weplay:command-last:${clientId}`, 1)
        var game = command.split('#')[1]
        this.redis.get(`weplay:rom:${game}`, (err, hash) => {
          if (hash) {
            if (this.defaultRomHash) {
              socket.leave(this.defaultRomHash)
              this.redis.publish(`weplay:leave:${this.defaultRomHash}`, clientId)
            }
            this.defaultRomHash = hash.toString()
            this.joinStream(this.defaultRomHash, socket, clientId)
          }
        })
      })
    })

    // send chat mesages
    socket.on('message', msg => {
      this.logger.debug('message', {
        event: 'message',
        msg: msg,
        socket: {nick: socket.nick, id: socket.id},
        ip: ip
      })
      this.broadcastEventLog(socket, 'message', msg, socket.nick)
    })

    // < User has selected a nick name and can join the chat.
    // > Broadcast user nick event
    socket.on('join', nick => {
      if (clientNick) {
        return
      }
      socket.nick = nick
      this.logger.debug('User has selected a nick name and can join the chat', {
        event: 'join',
        room: socket.room,
        nick: nick,
        id: socket.id,
        ip: ip
      })
      this.broadcastEventLog(socket, 'join', nick)
      // this.redis.hset('weplay:nicks', clientId, nick);
      // event done, notify client
      socket.emit('joined')

      // All services gets the event
      // no impl TODO
      this.bus.broadcast('game:nick', {nick: nick, clientId: socket.id})
    })
  }
}

module.exports = SocketHandler
