/*
 * GameHost.js
 *
 * The rules of High Noon, running inside the host player's browser instead of
 * on a server. The host owns the queue, the state machine and the scoring; it
 * broadcasts state to every peer over the data channels in PeerNet.
 *
 * ---------------------------------------------------------------------------
 * How reaction times stay honest (this is the whole point of the rewrite)
 * ---------------------------------------------------------------------------
 * 1. The draw is SCHEDULED, never announced. When tick-tock begins the host
 *    picks the exact instant of the draw on the shared clock and tells every
 *    peer about it seconds ahead of time. Nobody's DRAW! is gated on a packet
 *    arriving, so a slow link cannot delay when you see it.
 *
 * 2. Reaction time is measured ENTIRELY LOCALLY. Each peer subtracts the
 *    timestamp of the frame that actually painted DRAW! from the timestamp of
 *    its own keydown event. That number never touches the network, so it can
 *    not be inflated by ping. The host measures its own the same way through
 *    the same code path, so hosting buys you exactly nothing.
 *
 * 3. The host compares reported reaction times - it does NOT race packets.
 *    "Whoever's shot arrives first" would hand the win to the lower ping, so
 *    instead the host waits until a faster shot from the other player could no
 *    longer still be in flight (their measured one way latency plus slack)
 *    before it calls the round.
 */
var GameHost = (function () {

    var HIGH_NOON_MS   = 5100;  //how long IT'S HIGH NOON! hangs on screen
    var DRAW_MIN_S     = 5;     //earliest the draw can come after tick-tock
    var DRAW_MAX_S     = 17;    //latest
    var DRAW_WINDOW    = 3000;  //you get this long to pull the trigger
    var SETTLE_MARGIN  = 200;   //slack on top of measured latency before calling a round
    var CHEAT_SLACK    = 150;   //how much benefit of the doubt a claimed time gets
    var FLASH_MS       = 3300;
    var GAMEOVER_MS    = 5800;
    var RESET_MS       = 4200;

    var freshPlayer = {
        id: '',
        name: '',
        wins: 0,
        missfire: 0,
        fastestDraw: 5000,
        lastDraw: '',
        isDead: false
    };

    var gs = null;
    var timeouts   = [];
    var drawAtHost = null;   //the scheduled draw instant, on the host clock
    var reports    = {};     //playerId -> {rt} or {missfire:true} for this round
    var roundLive  = false;
    var ticker     = null;
    var tickCount  = 0;

    function blankState() {
        return {
            type: 'gs',
            state: 'waiting',
            playerQueue: [],
            player1: undefined,
            player2: undefined,
            reasonForEnd: '',
            roomCode: PeerNet.roomCode()
        };
    }

    function newPlayer(id, name) {
        var p = JSON.parse(JSON.stringify(freshPlayer));
        p.id = id;
        p.name = name;
        return p;
    }

    function broadcastState() {
        gs.roomCode = PeerNet.roomCode();
        PeerNet.broadcast(gs);
    }

    function createTimeout(fn, delay) {
        timeouts.push(setTimeout(fn, Math.max(0, delay)));
    }

    function clearAllTimeouts() {
        timeouts.forEach(clearTimeout);
        timeouts = [];
    }

    function getDuelist(id) {
        if (gs.player1 && gs.player1.id === id) return gs.player1;
        if (gs.player2 && gs.player2.id === id) return gs.player2;
        return null;
    }

    function randDrawDelay() {
        return (Math.random() * (DRAW_MAX_S - DRAW_MIN_S) + DRAW_MIN_S) * 1000;
    }

    /* ---------------------------------------------------------------------
     * Table management
     * ------------------------------------------------------------------ */
    function addPlayer(id, name) {
        if (getDuelist(id)) return;
        if (gs.playerQueue.some(function (p) { return p.id === id; })) return;
        gs.playerQueue.push(newPlayer(id, name));
        broadcastState();
    }

    function removePlayer(id) {
        gs.playerQueue = gs.playerQueue.filter(function (p) { return p.id !== id; });

        //If one of the duelists walks out the round is void, no result.
        if ((gs.player1 && gs.player1.id === id) || (gs.player2 && gs.player2.id === id)) {
            if (gs.player1 && gs.player1.id === id) gs.player1 = undefined;
            if (gs.player2 && gs.player2.id === id) gs.player2 = undefined;
            clearAllTimeouts();
            roundLive  = false;
            drawAtHost = null;
            reports    = {};
            gs.state = 'waiting';
            if (gs.player1) gs.player1.isDead = false;
            if (gs.player2) gs.player2.isDead = false;
        }
        broadcastState();
    }

    //A player is only allowed into a duel once we know how far away they are,
    //otherwise we cannot place the draw on their clock accurately.
    function readyToDuel(player) {
        return !!player && PeerNet.isSynced(player.id);
    }

    function checkForGameStart() {
        if (gs.state !== 'waiting') return;

        if (gs.player1 === undefined && gs.playerQueue.length)
            gs.player1 = gs.playerQueue.shift();
        else if (gs.player2 === undefined && gs.playerQueue.length)
            gs.player2 = gs.playerQueue.shift();

        if (!gs.player1 || !gs.player2) return;
        if (!readyToDuel(gs.player1) || !readyToDuel(gs.player2)) return; //still syncing clocks

        reports    = {};
        drawAtHost = null;
        roundLive  = false;
        gs.reasonForEnd = '';
        gs.player1.lastDraw = '';
        gs.player2.lastDraw = '';
        gs.player1.isDead = false;
        gs.player2.isDead = false;

        gs.state = 'highnoon';
        broadcastState();

        createTimeout(beginTickTock, HIGH_NOON_MS);
    }

    /* ---------------------------------------------------------------------
     * The round
     * ------------------------------------------------------------------ */
    function beginTickTock() {
        if (gs.state !== 'highnoon') return;

        gs.state   = 'ticktock';
        roundLive  = true;
        reports    = {};

        //Fix the draw instant now and hand it out well in advance. Every peer
        //flips to DRAW! off its own clock, so no packet sits on the critical path.
        drawAtHost = PeerNet.hostNow() + randDrawDelay();
        PeerNet.broadcast({ type: 'schedule', drawAt: drawAtHost });
        broadcastState();

        createTimeout(enterDraw, drawAtHost - PeerNet.hostNow());
    }

    function enterDraw() {
        if (gs.state !== 'ticktock' || !roundLive) return;
        gs.state = 'draw';
        broadcastState();
    }

    function onShot(playerId, msg) {
        if (!roundLive) return;
        var player = getDuelist(playerId);
        if (!player) return;                 //spectators cannot shoot
        if (reports[playerId]) return;       //one trigger pull per round

        if (msg.kind === 'missfire') {
            reports[playerId] = { missfire: true };
            endRound({ type: 'missfire', playerId: playerId });
            return;
        }

        if (gs.state !== 'draw' || drawAtHost === null) return;

        var rt = Number(msg.rt);
        if (!isFinite(rt)) return;
        rt = Math.max(0, Math.min(DRAW_WINDOW, rt));

        //Floor check: a claimed time cannot be faster than the wire allows. If
        //the report shows up 900ms after the draw on a 40ms link, a claimed 20ms
        //is a lie. Honest players never come near this bound.
        var observed = PeerNet.hostNow() - drawAtHost;
        var floor    = observed - PeerNet.oneWayFor(playerId) - CHEAT_SLACK;
        if (rt < floor) {
            console.warn('Implausible draw from ' + player.name + ': claimed ' +
                         Math.round(rt) + 'ms, floor is ' + Math.round(floor) + 'ms');
            rt = floor;
        }

        reports[playerId] = { rt: rt };
        tryResolve();
    }

    function tryResolve() {
        if (!roundLive || gs.state !== 'draw') return;
        var a = gs.player1, b = gs.player2;
        if (!a || !b) return;

        var ra = reports[a.id], rb = reports[b.id];
        var elapsed = PeerNet.hostNow() - drawAtHost;

        if (ra && rb) { endRound({ type: 'duel' }); return; }

        if (ra || rb) {
            //One shot is in. Hold the result until a faster shot from the other
            //player could no longer be in flight - otherwise we would just be
            //rewarding whoever has the shorter cable.
            var missing = ra ? b : a;
            var knownRt = (ra || rb).rt;
            if (elapsed >= knownRt + PeerNet.oneWayFor(missing.id) + SETTLE_MARGIN) {
                endRound({ type: 'duel' });
                return;
            }
        }

        //Nobody drew inside the window.
        var latest = Math.max(PeerNet.oneWayFor(a.id), PeerNet.oneWayFor(b.id));
        if (elapsed >= DRAW_WINDOW + latest + SETTLE_MARGIN)
            endRound({ type: 'timeout' });
    }

    function endRound(outcome) {
        if (!roundLive) return;
        roundLive = false;
        clearAllTimeouts();

        var a = gs.player1, b = gs.player2;
        gs.reasonForEnd = '';
        a.lastDraw = '';
        b.lastDraw = '';

        if (outcome.type === 'missfire') {
            var shooter = getDuelist(outcome.playerId);
            var other   = (shooter === a) ? b : a;
            shooter.missfire += 1;
            shooter.isDead = true;
            other.wins += 1;
            gs.reasonForEnd = shooter.name + ' missfired!';
        } else {
            var ra = reports[a.id] ? reports[a.id].rt : null;
            var rb = reports[b.id] ? reports[b.id].rt : null;

            //Everyone who actually drew gets their true time recorded, win or lose.
            if (ra !== null) {
                a.lastDraw = Math.round(ra);
                if (ra < a.fastestDraw) a.fastestDraw = Math.round(ra);
            }
            if (rb !== null) {
                b.lastDraw = Math.round(rb);
                if (rb < b.fastestDraw) b.fastestDraw = Math.round(rb);
            }

            if (ra === null && rb === null) {
                a.wins -= 1; a.isDead = true;
                b.wins -= 1; b.isDead = true;
                gs.reasonForEnd = 'Peace is not an option!';
            } else if (ra !== null && rb !== null && Math.abs(ra - rb) < 0.5) {
                a.isDead = true;
                b.isDead = true;
                gs.reasonForEnd = 'Both drew at the very same instant!';
            } else {
                var winner = (rb === null || (ra !== null && ra < rb)) ? a : b;
                var loser  = (winner === a) ? b : a;
                winner.wins += 1;
                loser.isDead = true;
                gs.reasonForEnd = winner.name + ' wins!';
            }
        }

        gs.state = 'flashed';
        broadcastState();

        createTimeout(function () {
            gs.state = 'gameover';
            //Both can die if peace was chosen, or on a dead heat.
            if (gs.player1 && gs.player1.isDead) {
                gs.player1.isDead = false;
                gs.playerQueue.push(gs.player1);
                gs.player1 = undefined;
            }
            if (gs.player2 && gs.player2.isDead) {
                gs.player2.isDead = false;
                gs.playerQueue.push(gs.player2);
                gs.player2 = undefined;
            }
            broadcastState();

            createTimeout(function () {
                //Temporary state so the result stays up for a beat
                gs.state = 'resetting';
                broadcastState();
                createTimeout(function () {
                    gs.state = 'waiting';
                    drawAtHost = null;
                    reports = {};
                    broadcastState();
                    checkForGameStart();
                }, RESET_MS);
            }, GAMEOVER_MS);
        }, FLASH_MS);
    }

    /* ---------------------------------------------------------------------
     * Wiring
     * ------------------------------------------------------------------ */
    function onMessage(playerId, msg) {
        if (msg.type === 'shot') onShot(playerId, msg);
    }

    function start() {
        gs = blankState();

        PeerNet.on('hostMessage', onMessage);
        PeerNet.on('playerJoin', addPlayer);
        PeerNet.on('playerLeave', removePlayer);

        //The host is a player at their own table.
        addPlayer(PeerNet.myId(), PeerNet.myName());

        if (ticker) clearInterval(ticker);
        ticker = setInterval(function () {
            tickCount++;
            if (gs.state === 'draw') tryResolve();
            if (gs.state === 'waiting') checkForGameStart();
            if (tickCount % 4 === 0) broadcastState(); //periodic resync, ~100ms
        }, 25);

        broadcastState();
    }

    function stop() {
        clearAllTimeouts();
        if (ticker) clearInterval(ticker);
        ticker = null;
    }

    return {
        start: start,
        stop: stop,
        state: function () { return gs; }
    };
})();
