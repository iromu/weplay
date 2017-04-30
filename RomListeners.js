class RomListeners {
  onRomHash(hashData) {
    this.logger.info('RomListeners.onRomHash', hashData)
    if (hashData.defaultRom) {
      this.defaultRomHash = hashData.hash
    }
    if (!this.hashes) {
      this.hashes = []
    }
    this.hashes.push(hashData)
  }
}

module.exports = RomListeners
