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
}
module.exports = CompressorListeners
