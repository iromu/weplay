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
      this.logger.info('FrameBroker.startBroadcastingFrames', room)
      this.bus.streamJoin('compressor', room, 'frame', (frame) => {
        this.ticker.tick()
        this.io.to(room).emit('frame', frame)
      })
      this.roomHashes.push(room)
    }
  }
}

module.exports = FrameBroker
