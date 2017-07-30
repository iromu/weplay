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
      this.logger.error('On connection found no default hash to join.', {id: socket.id})
    }

    socket.on('disconnect', () => {
      this.updateCount(--this.io.total)
      this.broadcastEventLog(socket, 'disconnected', clientNick)

      this.removeClient(clientId, clientNick)

      if (this.redis) {
        this.redis.hdel('weplay:clients', clientId)
        this.redis.hdel('weplay:nicks', clientId)
      }
      clientNick = undefined
    })

    // send events log so far
    this.replayEventLog(socket)

    // broadcast moves, throttling them first
    socket.on('move', key => {
      if (!keys.hasOwnProperty(key)) {
        return
      }
      var self = this
      // Send message to emitter through room
      self.bus.emit({channel: 'emu', room: this.defaultRomHash, event: 'move', data: keys[key]})
      self.broadcastEventLog(socket, 'move', key, socket.nick)
    })

    socket.on('command', command => {
      if (!command) {
        return
      }
      var game = parseInt(command.split('#')[1])
      if (this.roms) {
        var romGameSelection = this.roms.filter((data) => data.idx === game)[0]
        if (romGameSelection) {
          this.joinStream(romGameSelection.hash, socket, clientId)
        }
      }
    })

    // send chat mesages
    socket.on('message', msg => {
      this.broadcastEventLog(socket, 'message', msg, socket.nick)
    })

    // < User has selected a nick name and can join the chat.
    // > Broadcast user nick event
    socket.on('join', nick => {
      if (clientNick) {
        return
      }
      socket.nick = nick
      this.broadcastEventLog(socket, 'join', nick)
      // event done, notify client
      socket.emit('joined')

      // All services gets the event
      // no impl TODO
      this.bus.broadcast('game:nick', {nick: nick, clientId: socket.id})
    })
  }
}

module.exports = SocketHandler
