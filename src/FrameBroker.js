const fps = require('fps')

class FrameBroker {
  reconnect() {
    this.roomHashes.forEach(room => {
      this.logger.info('FrameBroker.reconnect', room)
      // this.bus.streamJoin('compressor', room, 'frame', (frame) => {
      //   if (this.tickers[room]) {
      //     this.tickers[room].tick()
      //   }
      //   this.io.to(room).emit('frame', frame)
      // })
    })
  }

  startBroadcastingFrames(room) {
    if (room && !this.roomHashes.includes(room)) {
      this.logger.info('FrameBroker[%s] startBroadcastingFrames INIT', room)
      this.roomHashes.push(room)
      this.roomsTimestamp[room] = Date.now()
      if (!this.tickers[room]) {
        this.logger.info('FrameBroker.startBroadcastingFrames tickers', room)
        this.tickers[room] = fps({every: 200})
        const listener = (framerate) => {
          this.logger.info('FrameBroker[%s] fps %s %s', room, Math.floor(framerate), this.tickers[room].listenerCount('data'))
        }
        this.tickers[room].removeListener('data', listener)
        this.tickers[room].on('data', listener)
      }
      this.roomInfo[room] = {}
      this.bus.streamJoin('compressor', room, 'frame' + room, (frame) => {
        if (this.tickers[room]) {
          this.tickers[room].tick()
        }
        this.roomsTimestamp[room] = Date.now()
        // broadcast frames to users
        this.lastFrameByRoom[room] = frame
        this.io.to(room).emit('frame', frame)
      })
      this.bus.streamJoin('compressor', room, 'audio' + room, (audio) => {
        this.roomsTimestamp[room] = Date.now()
        this.io.to(room).emit('audio', audio)
      })

      // this.bus.streamJoin('emu', room, 'move' + room, (move) => {
      //   this.logger.info('FrameBroker[%s] move %s', room, move)
      // })
    }
  }

  stopBroadcastingFrames(room) {
    if (room && this.roomHashes.includes(room)) {
      this.roomHashes = this.roomHashes.filter(r => r !== room)
      delete this.hashesClient[room]
      if (this.tickers[room]) {
        this.tickers[room].removeAllListeners('data')
        delete this.tickers[room]
      }
      delete this.roomsTimestamp[room]
      this.bus.streamLeave('compressor', room)
    }
  }
}

module.exports = FrameBroker
