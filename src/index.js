import GatewayService from './GatewayService'

process.title = 'weplay-gateway'

const discoveryUrl = process.env.DISCOVERY_URL || 'http://localhost:3010'
const discoveryPort = process.env.DISCOVERY_PORT || 3050
const port = process.env.WEPLAY_PORT || 3001
const statusPort = process.env.STATUS_PORT || 8084

const redis = require('weplay-common').redis()

const service = new GatewayService(port, discoveryUrl, discoveryPort, statusPort, redis)

require('weplay-common').cleanup(service.destroy.bind(service))
