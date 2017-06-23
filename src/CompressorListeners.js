class CompressorListeners {
  onConnect() {
    if (this.roomHashesQ) {
      this.logger.info('compressor GatewayService x reconnect')
      this.roomHashesQ.forEach(this.startBroadcastingFrames.bind(this))
    }
  }

  onDisconnect() {
    this.logger.info('compressor GatewayService x disconnected from')
    this.roomHashesQ = this.roomHashes
    this.roomHashes = []
  }
}
module.exports = CompressorListeners
