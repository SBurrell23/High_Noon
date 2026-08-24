/*
 * PeerNet.js
 *
 * PeerJS transport for High Noon. Owns the lobby (create / join a table),
 * the star topology (every guest holds one data connection to the host) and
 * the NTP style clock sync that gives every peer a single shared timeline.
 *
 * No game rules live in here. See GameHost.js for those.
 */
var PeerNet = (function () {

    var ID_PREFIX   = 'highnoon-v1-';
    var CODE_CHARS  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; //no I/O/0/1, they get misread out loud
    var SYNC_EVERY  = 1500;  //ms between clock sync probes
    var SYNC_WINDOW = 8;     //how many probes we keep to pick the cleanest one
    var GUEST_TIMEOUT = 7000; //silence this long and we assume they rode off

    var peer          = null;
    var hosting       = false;
    var roomCode      = null;
    var localId       = null;   //'host' for the host, 'pN' for a guest
    var localName     = '';
    var hostConn      = null;   //guest side: the one connection we care about
    var guests        = {};     //host side: playerId -> {conn, name, rtt, oneWay}
    var guestCounter  = 0;
    var listeners     = {};
    var samples       = [];
    var clock         = { offset: 0, rtt: 0, oneWay: 0, synced: false };
    var syncTimer     = null;
    var reapTimer     = null;
    var hostRetries   = 0;

    function emit(event) {
        var args = Array.prototype.slice.call(arguments, 1);
        (listeners[event] || []).forEach(function (fn) { fn.apply(null, args); });
    }

    function on(event, fn) {
        (listeners[event] = listeners[event] || []).push(fn);
    }

    function randomCode() {
        var code = '';
        for (var i = 0; i < 4; i++)
            code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
        return code;
    }

    /* ---------------------------------------------------------------------
     * Clock
     *
     * Everything the game needs to be fair is timed against the host clock.
     * Guests estimate their offset from it with the classic NTP round trip:
     *      offset = t1 - (t0 + rtt/2)
     * and keep the sample with the lowest round trip time, since that is the
     * sample least polluted by queueing delay.
     * ------------------------------------------------------------------ */
    function now() {
        return performance.now();
    }

    //Local monotonic time expressed on the host's timeline
    function hostNow() {
        return now() + clock.offset;
    }

    //A host timestamp expressed on our own monotonic timeline
    function toLocal(hostTs) {
        return hostTs - clock.offset;
    }

    //One of our own timestamps expressed on the host's timeline
    function toHost(localTs) {
        return localTs + clock.offset;
    }

    function recordSample(t0, t1, t2) {
        var rtt = t2 - t0;
        samples.push({ rtt: rtt, offset: t1 - (t0 + rtt / 2) });
        if (samples.length > SYNC_WINDOW)
            samples.shift();

        var best = samples[0];
        for (var i = 1; i < samples.length; i++)
            if (samples[i].rtt < best.rtt)
                best = samples[i];

        clock.offset = best.offset;
        clock.rtt    = best.rtt;
        clock.oneWay = best.rtt / 2;
        clock.synced = true;

        //Let the host know how far away we are so it can reason about how long
        //it must wait before it can be sure our shot is not still in flight.
        rawSendToHost({ type: '__clock', rtt: clock.rtt });
        emit('clock', clock);
    }

    function startSyncing() {
        stopSyncing();
        var probe = function () {
            rawSendToHost({ type: '__ping', t0: now() });
        };
        probe();
        //A quick burst up front so the first duel is already well synced
        setTimeout(probe, 120);
        setTimeout(probe, 260);
        setTimeout(probe, 420);
        syncTimer = setInterval(probe, SYNC_EVERY);
    }

    function stopSyncing() {
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = null;
    }

    /* ---------------------------------------------------------------------
     * Wire
     * ------------------------------------------------------------------ */
    function rawSendToHost(msg) {
        if (hostConn && hostConn.open) {
            try { hostConn.send(msg); } catch (e) { console.warn('send failed', e); }
        }
    }

    //Guest -> host, or host -> its own game logic with zero latency.
    function sendToHost(msg) {
        if (hosting)
            emit('hostMessage', localId, msg);
        else
            rawSendToHost(msg);
    }

    //Host -> everybody (including a local delivery to the host's own client).
    function broadcast(msg) {
        if (!hosting) return;
        Object.keys(guests).forEach(function (pid) {
            var g = guests[pid];
            if (g.conn && g.conn.open) {
                try { g.conn.send(msg); } catch (e) { console.warn('broadcast failed', e); }
            }
        });
        emit('guestMessage', msg);
    }

    function sendTo(playerId, msg) {
        if (!hosting) return;
        if (playerId === localId) { emit('guestMessage', msg); return; }
        var g = guests[playerId];
        if (g && g.conn && g.conn.open) {
            try { g.conn.send(msg); } catch (e) { console.warn('send failed', e); }
        }
    }

    /* ---------------------------------------------------------------------
     * Host side
     * ------------------------------------------------------------------ */
    function dropGuest(playerId) {
        if (!guests[playerId]) return;
        delete guests[playerId];
        emit('playerLeave', playerId);
    }

    //PeerJS is slow to notice a closed tab, so we also watch for silence. Every
    //guest pings on a fixed cadence, so a long gap means they are gone.
    function startReaper() {
        if (reapTimer) clearInterval(reapTimer);
        reapTimer = setInterval(function () {
            var cutoff = now() - GUEST_TIMEOUT;
            Object.keys(guests).forEach(function (pid) {
                if (guests[pid].lastSeen < cutoff)
                    dropGuest(pid);
            });
        }, 1000);
    }

    function handleHostSideMessage(playerId, msg) {
        if (guests[playerId])
            guests[playerId].lastSeen = now();

        if (msg.type === '__ping') {
            sendTo(playerId, { type: '__pong', t0: msg.t0, t1: now() });
            return;
        }
        if (msg.type === '__bye') {
            dropGuest(playerId);
            return;
        }
        if (msg.type === '__clock') {
            if (guests[playerId]) {
                guests[playerId].rtt    = msg.rtt;
                guests[playerId].oneWay = msg.rtt / 2;
                guests[playerId].synced = true;
            }
            return;
        }
        emit('hostMessage', playerId, msg);
    }

    function attachGuest(conn) {
        var playerId = 'p' + (++guestCounter);

        conn.on('data', function (msg) {
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === '__hello') {
                guests[playerId] = { conn: conn, name: String(msg.name || 'Stranger').slice(0, 15), rtt: 0, oneWay: 0, synced: false, lastSeen: now() };
                conn.send({ type: '__welcome', id: playerId, roomCode: roomCode });
                emit('playerJoin', playerId, guests[playerId].name);
                return;
            }
            if (!guests[playerId]) return; //never said hello, ignore
            handleHostSideMessage(playerId, msg);
        });

        conn.on('close', function () { dropGuest(playerId); });
        conn.on('error', function () { dropGuest(playerId); });
    }

    function host(name, done) {
        hosting   = true;
        localId   = 'host';
        localName = String(name || '').slice(0, 15);
        roomCode  = randomCode();
        clock     = { offset: 0, rtt: 0, oneWay: 0, synced: true }; //we are the clock

        emit('status', 'Setting up the table...');
        peer = new Peer(ID_PREFIX + roomCode, { debug: 1 });

        peer.on('open', function () {
            hostRetries = 0;
            emit('status', 'Table open. Waiting for cowfolk...');
            emit('ready', { isHost: true, roomCode: roomCode, id: localId, name: localName });
            if (done) done(null, roomCode);
        });

        peer.on('connection', attachGuest);
        startReaper();

        peer.on('error', function (err) {
            //A code collision just means somebody else grabbed it first.
            if (err && err.type === 'unavailable-id' && hostRetries < 5) {
                hostRetries++;
                try { peer.destroy(); } catch (e) {}
                host(localName, done);
                return;
            }
            console.error('peer error', err);
            emit('error', err);
        });

        peer.on('disconnected', function () {
            emit('status', 'Signalling dropped, reconnecting...');
            try { peer.reconnect(); } catch (e) {}
        });
    }

    /* ---------------------------------------------------------------------
     * Guest side
     * ------------------------------------------------------------------ */
    function join(code, name, done) {
        hosting   = false;
        localName = String(name || '').slice(0, 15);
        roomCode  = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        samples   = [];
        clock     = { offset: 0, rtt: 0, oneWay: 0, synced: false };

        if (roomCode.length < 3) {
            if (done) done(new Error('That is not a table code.'));
            return;
        }

        emit('status', 'Riding out to table ' + roomCode + '...');
        peer = new Peer({ debug: 1 });

        peer.on('open', function () {
            hostConn = peer.connect(ID_PREFIX + roomCode, { reliable: true });

            hostConn.on('open', function () {
                hostConn.send({ type: '__hello', name: localName });
                startSyncing();
            });

            hostConn.on('data', function (msg) {
                if (!msg || typeof msg !== 'object') return;
                if (msg.type === '__welcome') {
                    localId = msg.id;
                    emit('status', 'Sat down at table ' + roomCode + '.');
                    emit('ready', { isHost: false, roomCode: roomCode, id: localId, name: localName });
                    if (done) done(null, roomCode);
                    return;
                }
                if (msg.type === '__pong') {
                    recordSample(msg.t0, msg.t1, now());
                    return;
                }
                emit('guestMessage', msg);
            });

            hostConn.on('close', function () {
                stopSyncing();
                emit('hostGone');
            });

            hostConn.on('error', function (err) {
                console.error('connection error', err);
                emit('error', err);
            });
        });

        peer.on('error', function (err) {
            console.error('peer error', err);
            if (err && err.type === 'peer-unavailable')
                emit('joinFailed', 'No table found with code ' + roomCode + '.');
            emit('error', err);
        });

        peer.on('disconnected', function () {
            try { peer.reconnect(); } catch (e) {}
        });
    }

    //Tell the host we are leaving rather than making them wait on a timeout.
    function sayGoodbye() {
        if (!hosting) rawSendToHost({ type: '__bye' });
    }
    window.addEventListener('pagehide', sayGoodbye);
    window.addEventListener('beforeunload', sayGoodbye);

    function leave() {
        sayGoodbye();
        stopSyncing();
        if (reapTimer) clearInterval(reapTimer);
        reapTimer = null;
        try { if (peer) peer.destroy(); } catch (e) {}
        peer = null; hostConn = null; guests = {}; hosting = false;
    }

    return {
        on: on,
        host: host,
        join: join,
        leave: leave,
        broadcast: broadcast,
        sendTo: sendTo,
        sendToHost: sendToHost,
        now: now,
        hostNow: hostNow,
        toLocal: toLocal,
        toHost: toHost,
        clock: function () { return clock; },
        isHost: function () { return hosting; },
        myId: function () { return localId; },
        myName: function () { return localName; },
        roomCode: function () { return roomCode; },
        //How long a message from this player can still be in flight to the host
        oneWayFor: function (playerId) {
            if (playerId === localId) return 0;
            var g = guests[playerId];
            return g ? g.oneWay : 0;
        },
        //True once we have a usable estimate of this player's clock offset
        isSynced: function (playerId) {
            if (playerId === localId) return clock.synced;
            var g = guests[playerId];
            return !!(g && g.synced);
        },
        guestName: function (playerId) {
            var g = guests[playerId];
            return g ? g.name : null;
        }
    };
})();
