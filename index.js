'use strict';

const uuid = require('node-uuid').v4();
const logger = require('weplay-common').logger('weplay-io');

var sio = require('socket.io');
var forwarded = require('forwarded-for');

process.title = 'weplay-io';

const port = process.env.WEPLAY_PORT || 3001;
const io = module.exports = sio(port);

const throttle = process.env.WEPLAY_THROTTLE || 100;

// redis socket.io adapter
const uri = process.env.WEPLAY_REDIS || 'redis://localhost:6379';

io.adapter(require('socket.io-redis')(uri));

// redis
const redis = require('weplay-common').redis();
const redisSub = require('weplay-common').redis();

const EventBus = require('weplay-common').EventBus;
const bus = new EventBus(redis, redisSub);

logger.debug('io listening', {port: port, uuid: uuid, adapter: uri});

var clients = [];
var clientsHashes = {};


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


io.total = 0;


io.on('connection', socket => {
    const req = socket.request;
    const ip = forwarded(req, req.headers);
    const clientId = socket.id;
    clients.push(clientId);
    var clientNick;
    var currentHash;
    // keep track of connected clients
    updateCount(++io.total);

    redis.get('weplay:rom:default', (err, _defaultHash) => {
        if (_defaultHash) {
            currentHash = _defaultHash.toString();
            join(currentHash, socket, clientId);
        }
        else {
            logger.error('On connection found no default hash to join.', {id: socket.id, ip: ip});
        }
    });

    socket.on('disconnect', () => {
        updateCount(--io.total);
        logger.debug('disconnect', {nick: clientNick, id: socket.id, ip: ip});
        broadcast(socket, 'disconnected', clientNick);
        if (currentHash) {
            delete clientsHashes[clientId];
            redis.publish(`weplay:leave:${currentHash}`, clientId);
        }
        redis.hdel('weplay:clients', clientId);
        redis.hdel('weplay:nicks', clientId);
        clients = clients.filter(item => item !== clientNick);
        clientNick = undefined;
    });

    // send events log so far
    redis.lrange('weplay:log', 0, 20, (err, log) => {
        if (!Array.isArray(log)) {
            return;
        }
        log.reverse().forEach(data => {
            data = data.toString();
            const args = JSON.parse(data);
            if (Array.isArray(args)) {
                socket.emit(...args);
            } else {
                logger.error(data);
            }
        });
    });

    // broadcast moves, throttling them first
    socket.on('move', key => {
        if (null == keys[key]) {
            return;
        }
        redis.get(`weplay:move-last:${clientId}`, (err, last) => {
            if (last) {
                last = last.toString();
                if (Date.now() - last < throttle) {
                    return;
                }
            }
            logger.debug('> weplay:move', {
                key: keys[key],
                move: key,
                socket: {nick: socket.nick, id: socket.id},
                ip: ip
            });
            redis.set(`weplay:move-last:${clientId}`, Date.now());
            redis.expire(`weplay:move-last:${clientId}`, 1);
            redis.publish(`weplay:move:${currentHash}`, keys[key]);
            broadcast(socket, 'move', key, socket.nick);
        });
    });

    socket.on('command', command => {
        if (null == command) {
            return;
        }
        redis.get(`weplay:command-last:${clientId}`, (err, last) => {
            if (last) {
                last = last.toString();
                if (Date.now() - last < throttle) {
                    return;
                }
            }
            logger.info('< weplay:command', {command: command, socket: {nick: socket.nick, id: socket.id}, ip: ip});
            redis.set(`weplay:command-last:${clientId}`, Date.now());
            redis.expire(`weplay:command-last:${clientId}`, 1);
            var game = command.split('#')[1];
            redis.get(`weplay:rom:${game}`, (err, hash) => {
                if (hash) {
                    if (currentHash) {
                        socket.leave(currentHash);
                        redis.publish(`weplay:leave:${currentHash}`, clientId);
                    }
                    currentHash = hash.toString();
                    join(currentHash, socket, clientId);
                }
            });
        });
    });


    // send chat mesages
    socket.on('message', msg => {
        logger.info('message', {msg: msg, socket: {nick: socket.nick, id: socket.id}, ip: ip});
        broadcast(socket, 'message', msg, socket.nick);
    });

    // broadcast user joining
    socket.on('join', nick => {
        if (clientNick) {
            return;
        }
        socket.nick = nick;
        clientNick = nick;
        logger.info('< join', {nick: socket.nick, id: socket.id, ip: ip});
        broadcast(socket, 'join', socket.nick);
        redis.hset('weplay:nicks', clientId, nick);
        // event done, notify client
        socket.emit('joined');
    });


    function broadcast(socket/*, …*/) {
        const args = Array.prototype.slice.call(arguments, 1);
        logger.debug('broadcast', {room: currentHash, args: args});
        redis.lpush('weplay:log', JSON.stringify(args));
        redis.ltrim('weplay:log', 0, 20);
        io.to(currentHash).emit.apply(io.to(currentHash), args);
    }

});


// sends connections count to everyone
// by aggregating all servers
function updateCount(total) {
    redis.hset('weplay:connections', uuid, total);
}

function updateClients(clientId, hash) {
    clientsHashes[clientId] = hash;
    redis.hset('weplay:clients', clientId, JSON.stringify({hash: hash, io: uuid}));
}

function join(currentHash, socket, clientId) {
    logger.debug(`> weplay:join:${currentHash}`, {nick: socket.nick, hash: currentHash, clientId: clientId});
    socket.join(currentHash);
    updateClients(clientId, currentHash);
    redis.publish(`weplay:join:${currentHash}`, clientId);
}

require('weplay-common').cleanup(function destroyData() {
    logger.info('Destroying data.');
    redis.hdel('weplay:connections', uuid);
    clients.forEach(client=> {
        redis.hdel('weplay:clients', client);
    });
    for (var key in clientsHashes) {
        if (clientsHashes.hasOwnProperty(key)) {
            redis.publish(`weplay:leave:${clientsHashes[key]}`, key);
        }
    }

    bus.publish('weplay:io:unsubscribe', uuid);
    bus.destroy();
});

let loaded = false;
let retryCount = 0;

bus.subscribe(`weplay:io:${uuid}:subscribe:done`, (channel, id) => {
    logger.info(`< weplay:io:${uuid}:subscribe:done`, {uuid: id.toString()});
    loaded = true;
    retryCount = 0;
});

function discover() {
    logger.info('> weplay:io:subscribe', {uuid, retry: retryCount++});
    bus.publish('weplay:io:subscribe', uuid);
    setTimeout(() => {
        if (!loaded) {
            discover();
        }
    }, 10000); //saveIntervalDelay
}

discover();