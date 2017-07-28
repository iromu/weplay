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

  onRomData(romData) {
    this.logger.info('RomListeners.onRomHash', romData)
    if (!this.roms) {
      this.roms = []
    }
    this.roms.push(romData)
  }
}
module.exports = RomListeners
