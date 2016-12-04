'use strict';

var sio = require('socket.io');
var forwarded = require('forwarded-for');

process.title = 'weplay-io';

const port = process.env.WEPLAY_PORT || 3001;
const io = module.exports = sio(port);
console.log(`listening on *:${port}`);

const throttle = process.env.WEPLAY_IP_THROTTLE || 100;

// redis socket.io adapter
const uri = process.env.WEPLAY_REDIS || 'redis://localhost:6379';
io.adapter(require('socket.io-redis')(uri));

// redis queries instance
const redis = require('./redis')();

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

const uid = process.env.WEPLAY_SERVER_UID || port;
console.log('server uid %s', uid);

io.total = 0;
io.on('connection', socket => {
    const req = socket.request;
    const ip = forwarded(req, req.headers);
    console.log('client ip %s', JSON.stringify(ip));

    // keep track of connected clients
    updateCount(++io.total);
    socket.on('disconnect', () => {
        updateCount(--io.total);
    });

    // send events log so far
    redis.lrange('weplay:log', 0, 20, (err, log) => {
        if (!Array.isArray(log)) return;
        log.reverse().forEach(data => {
            data = data.toString();
            const args = JSON.parse(data);
            if (Array.isArray(args)) {
                socket.emit(...args);
            } else {
                console.error(data);
            }
        });
    });

    // broadcast moves, throttling them first
    socket.on('move', key => {
        if (null == keys[key]) return;
        redis.get(`weplay:move-last:${ip}`, (err, last) => {
            if (last) {
                last = last.toString();
                if (Date.now() - last < throttle) {
                    return;
                }
            }
            redis.set(`weplay:move-last:${ip}`, Date.now());
            redis.publish('weplay:move', keys[key]);
            socket.emit('move', key, socket.nick);
            broadcast(socket, 'move', key, socket.nick);
        });
    });

    // send chat mesages
    socket.on('message', msg => {
        broadcast(socket, 'message', msg, socket.nick);
    });

    // broadcast user joining
    socket.on('join', nick => {
        if (socket.nick) return;
        socket.nick = nick;
        socket.emit('joined');
        broadcast(socket, 'join', nick);
    });
});

// sends connections count to everyone
// by aggregating all servers
function updateCount(total) {
    redis.hset('weplay:connections', uid, total);
}

// broadcast events and persist them to redis

function broadcast(socket/*, …*/) {
    const args = Array.prototype.slice.call(arguments, 1);
    redis.lpush('weplay:log', JSON.stringify(args));
    redis.ltrim('weplay:log', 0, 20);
    socket.broadcast.emit.apply(socket, args);
}
