const fps = require('fps')

class FrameBroker {
  reconnect() {
    this.roomHashes.forEach(room => {
      this.logger.info('FrameBroker.reconnect', room)
      this.bus.streamJoin('compressor', room, 'frame', (frame) => {
        this.ticker.tick()
        this.io.to(room).emit('frame', frame)
      })
    })
  }

  startBroadcastingFrames(room) {
    if (room && !this.roomHashes.includes(room)) {
      this.tickers[room] = fps({every: 10})
      this.roomInfo[room] = {}
      this.tickers[room].on('data', framerate => {
        var hashesClientInfo = {}
        for (var property in this.hashesClient) {
          if (this.hashesClient.hasOwnProperty(property)) {
            hashesClientInfo[property] = this.hashesClient[property].length
          }
        }
        this.logger.info('FrameBroker[%s] fps %s %s', room, Math.floor(framerate), JSON.stringify(hashesClientInfo))
      })
      this.logger.info('FrameBroker.startBroadcastingFrames', room)
      this.bus.streamJoin('compressor', room, 'frame', (frame) => {
        this.tickers[room].tick()
        this.io.to(room).emit('frame', frame)
      })
      this.bus.streamJoin('emu', room, 'move', (move) => {
        this.logger.info('FrameBroker[%s] move %s', room, move)
      })
      this.roomHashes.push(room)
    }
  }
}

module.exports = FrameBroker
