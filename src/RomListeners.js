class RomListeners {
  onConnect() {
    this.bus.emit('rom', 'defaulthash')
    this.bus.emit('rom', 'list')
  }

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
    this.logger.info('RomListeners.onRomData', romData)
    if (!this.roms) {
      this.roms = []
    }
    const romFiltered = this.roms.filter(r => r.hash === romData.hash)[0]
    if (!romFiltered) {
      this.roms.push(romData)
      this.bus.emit('rom', 'image', romData.hash)
    } else {
      romFiltered.idx = romData.idx
      romFiltered.name = romData.name
    }
  }

  onRomImage(romData) {
    this.logger.debug('RomListeners.onRomImage', romData.hash)
    if (!this.roms) {
      this.roms = []
    }
    this.roms.filter(r => r.hash === romData.hash)[0].image = romData.image
  }
}

export default RomListeners
