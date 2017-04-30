process.title = 'weplay-gateway'

const discoveryUrl = process.env.DISCOVERY_URL || 'http://localhost:3010'
const discoveryPort = process.env.DISCOVERY_PORT || 3050
const port = process.env.WEPLAY_PORT || 3001

const redis = require('weplay-common').redis()

const GatewayService = require('./GatewayService')
const service = new GatewayService(port, discoveryUrl, discoveryPort, redis)

require('weplay-common').cleanup(service.destroy.bind(service))
