const EventBus = require('weplay-common').EventBus;

const sio = require('socket.io');
const forwarded = require('forwarded-for');

const throttle = process.env.WEPLAY_THROTTLE || 100;

const keys = {
    right: 0,
    left: 1,
    up: 2,
    down: 3,
    a: 4,
    b: 5,
    select: 6,
    start: 7
};

class GatewayService {

    constructor(port, discoveryUrl, discoveryPort, redis) {
        this.uuid = require('node-uuid').v4();
        this.logger = require('weplay-common').logger('weplay-gateway-service', this.uuid);


        this.clients = [];
        this.clientsHashes = {};

        this.bus = new EventBus({
            url: discoveryUrl,
            port: discoveryPort,
            name: 'gateway',
            id: this.uuid,
            clientListeners: [
                {name: 'rom', event: 'hash', handler: this.onRomHash.bind(this)},
                {name: 'compressor', event: 'frame:location', handler: this.onFrameLocation.bind(this)}
            ]
        }, ()=> {
            this.logger.info('GatewayService connected to discovery server', {
                discoveryUrl: discoveryUrl,
                uuid: this.uuid
            });

            this.logger.info('Emitting', {channel: 'rom', event: 'default:hash'});
            this.bus.emit('rom', 'default:hash');
        });

        this.redis = redis;
        this.io = module.exports = sio(port);

        // redis socket.io adapter
        const uri = process.env.WEPLAY_REDIS || 'redis://localhost:6379';

        this.io.adapter(require('socket.io-redis')(uri));

        this.io.total = 0;
        this.io.on('connection', this.onConnection.bind(this));
    }

    onRomHash(hashData) {
        this.logger.info('GatewayService.onRomHash', hashData);
        if (!this.defaultRomHash || !this.defaultRomHash === hashData.hash) {
            this.defaultRomHash = hashData.hash;
        }
    }

    onFrameLocation(uuid) {
        this.logger.info('onFrameLocation');
    }

    onConnection(socket) {
        const req = socket.request;
        const ip = forwarded(req, req.headers);
        const clientId = socket.id;
        this.clients.push(clientId);
        var clientNick;
        // keep track of connected clients
        this.updateCount(++this.io.total);

        if (this.defaultRomHash) {
            this.joinStream(this.defaultRomHash, socket, clientId);
        }
        else {
            this.logger.error('On connection found no default hash to join.', {id: socket.id, ip: ip});
        }

        socket.on('disconnect', () => {
            this.updateCount(--this.io.total);
            this.logger.info('disconnect', {event: 'disconnect', nick: clientNick, id: socket.id, ip: ip});
            this.broadcast(socket, 'disconnected', clientNick);
            if (this.defaultRomHash) {
                delete this.clientsHashes[clientId];
                this.redis.publish(`weplay:leave:${this.defaultRomHash}`, clientId);
            }
            this.redis.hdel('weplay:clients', clientId);
            this.redis.hdel('weplay:nicks', clientId);
            this.clients = this.clients.filter(item => item !== clientNick);
            clientNick = undefined;
        });

        // send events log so far
        this.redis.lrange('weplay:log', 0, 20, (err, log) => {
            if (!Array.isArray(log)) {
                return;
            }
            log.reverse().forEach(data => {
                data = data.toString();
                const args = JSON.parse(data);
                if (Array.isArray(args)) {
                    socket.emit(...args);
                } else {
                    this.logger.error(data);
                }
            });
        });

        // broadcast moves, throttling them first
        socket.on('move', key => {
            if (null == keys[key]) {
                return;
            }
            var self = this;
            this.redis.get(`weplay:move-last:${clientId}`, function (err, last) {
                if (last) {
                    last = last.toString();
                    if (Date.now() - last < throttle) {
                        return;
                    }
                }
                self.logger.debug('< weplay:move', {
                    event: 'move',
                    key: keys[key],
                    move: key,
                    socket: {nick: socket.nick, id: socket.id},
                    ip: ip
                });
                self.redis.set(`weplay:move-last:${clientId}`, Date.now());
                self.redis.expire(`weplay:move-last:${clientId}`, 1);
                self.redis.publish(`weplay:move:${this.defaultRomHash}`, keys[key]);
                self.broadcast(socket, 'move', key, socket.nick);
            });
        });

        socket.on('command', command => {
            if (null == command) {
                return;
            }
            this.redis.get(`weplay:command-last:${clientId}`, (err, last) => {
                if (last) {
                    last = last.toString();
                    if (Date.now() - last < throttle) {
                        return;
                    }
                }
                this.logger.info('< weplay:command', {
                    event: 'command',
                    command: command,
                    socket: {nick: socket.nick, id: socket.id},
                    ip: ip
                });
                this.redis.set(`weplay:command-last:${clientId}`, Date.now());
                this.redis.expire(`weplay:command-last:${clientId}`, 1);
                var game = command.split('#')[1];
                this.redis.get(`weplay:rom:${game}`, (err, hash) => {
                    if (hash) {
                        if (this.defaultRomHash) {
                            socket.leave(this.defaultRomHash);
                            this.redis.publish(`weplay:leave:${this.defaultRomHash}`, clientId);
                        }
                        this.defaultRomHash = hash.toString();
                        this.joinStream(this.defaultRomHash, socket, clientId);
                    }
                });
            });
        });


        // send chat mesages
        socket.on('message', msg => {
            this.logger.info('message', {
                event: 'message',
                msg: msg,
                socket: {nick: socket.nick, id: socket.id},
                ip: ip
            });
            this.broadcast(socket, 'message', msg, socket.nick);
        });

        // < User has selected a nick name and can join the chat.
        // > Broadcast user nick event
        socket.on('join', nick => {
            if (clientNick) {
                return;
            }
            socket.nick = nick;
            this.logger.info('User has selected a nick name and can join the chat', {
                event: 'join',
                room: socket.romHash,
                nick: socket.nick,
                id: socket.id,
                ip: ip
            });
            this.broadcast(socket, 'join', socket.nick);
            this.redis.hset('weplay:nicks', clientId, nick);
            // event done, notify client
            socket.emit('joined');

            this.bus.broadcast('game:nick', {nick: socket.nick, clientId: socket.id});
        });


    }

    broadcast(socket/*, …*/) {
        const args = Array.prototype.slice.call(arguments, 1);
        this.logger.debug('broadcast', {room: this.defaultRomHash, args: args});
        this.redis.lpush('weplay:log', JSON.stringify(args));
        this.redis.ltrim('weplay:log', 0, 20);
        this.io.to(this.defaultRomHash).emit.apply(this.io.to(this.defaultRomHash), args);
    }

// sends connections count to everyone
// by aggregating all servers
    updateCount(total) {
        this.redis.hset('weplay:connections', this.uuid, total);
    }

    updateClients(clientId, hash) {
        this.clientsHashes[clientId] = hash;
        this.redis.hset('weplay:clients', clientId, JSON.stringify({hash: hash, io: this.uuid}));
    }

    joinStream(hash, socket, clientId) {
        this.logger.debug('joinStream', {nick: socket.nick, hash: hash, clientId: clientId});
        this.bus.emit('compressor', 'stream:join', {nick: socket.nick, hash: hash, clientId: clientId});

        socket.join(hash);
        this.bus.on('compressor', `${hash}:frame`, (frame)=> {
            // Clients can connect only to one hash
            // Several clients can connect to this server
            this.io.to(hash).emit('frame', frame);
        });

        //this.io.to(hash).emit('frame', frame);
        this.updateClients(clientId, hash);
        //this.redis.publish(`weplay:join:${this.defaultRomHash}`, clientId);
    }

    destroy() {
        this.logger.info('Destroying data.');
        this.redis.hdel('weplay:connections', this.uuid);
        this.clients.forEach(client=> {
            this.redis.hdel('weplay:clients', client);
        });
        //for (var key in this.clientsHashes) {
        //    if (clientsHashes.hasOwnProperty(key)) {
        //        //this.redis.publish(`weplay:leave:${clientsHashes[key]}`, key);
        //    }
        //}

        this.bus.publish('weplay:io:unsubscribe', this.uuid);
        this.bus.destroy();
    }
}


module.exports = GatewayService;