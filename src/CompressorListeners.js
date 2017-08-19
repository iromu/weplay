class CompressorListeners {
  onConnect() {
    if (this.roomHashesQ) {
      this.logger.info('compressor GatewayService x reconnect')
      // this.roomHashesQ.forEach(this.startBroadcastingFrames.bind(this))
    }
  }

  onDisconnect(reason) {
    this.logger.info('compressor GatewayService x disconnected from', reason)
    // this.roomHashesQ = this.roomHashes
    this.roomHashes = []
  }

  onStreamRejected(room) {
    this.logger.info('CompressorListeners.onStreamRejected', room)
    if (this.roms.filter(r => r.hash === room)[0].image) {
      this.io.to(room).emit('frame', this.roms.filter(r => r.hash === room)[0].image)
    } else {
      this.io.to(room).emit('frame', this.NO_CONN_FRAME)
    }
    // This will trigger a reconnection attempt
    // this.roomHashes = this.roomHashes.filter(r => r !== room)
    this.tickers[room] && this.tickers[room].removeAllListeners('data')
    delete this.tickers[room]
  }
}

module.exports = CompressorListeners
