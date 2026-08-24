/*
 * GameClient.js
 *
 * Everything the player sees and touches: the lobby, the canvas, the sounds,
 * and - the important bit - the local measurement of how fast you drew.
 *
 * Your reaction time is (timestamp of your keydown) - (timestamp of the frame
 * that painted DRAW! on YOUR screen). Both numbers come from the same monotonic
 * performance clock in this tab. Nothing about that number travels over the
 * network before it is calculated, so ping cannot shrink it or stretch it, and
 * the host measures theirs through this exact same code path.
 */

var fontFamily = 'Permanent Marker';

var globalState     = null;  //latest authoritative state from the host
var myId            = null;
var drawAtHost      = null;  //scheduled draw instant, on the host clock
var localDrawTs     = null;  //rAF timestamp of the frame that painted DRAW!
var localDrawActive = false;
var localFlashAt    = null;  //when we pulled our own trigger, for instant feedback
var shotSent        = false;
var inRoom          = false;

var sounds = {
    mainMusic:   new Audio('sounds/mainMusic.mp3'),
    tickTock:    new Audio('sounds/tickTock.mp3'),
    tollingBell: new Audio('sounds/tollingBell.wav'),
    gunShot:     new Audio('sounds/gunShot.wav'),
    whipCracked: new Audio('sounds/whipCracked.mp3'),
    highNoon:    new Audio('sounds/itsHighNoon.mp3')
};

/* =======================================================================
 * Networking
 * ==================================================================== */
function wireNetwork() {
    PeerNet.on('ready', function (info) {
        myId   = info.id;
        inRoom = true;
        if (info.isHost)
            GameHost.start();
        showRoom(info);
    });

    //Messages from the host (the host gets its own broadcasts here too)
    PeerNet.on('guestMessage', function (msg) {
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'gs') {
            applyState(msg);
        } else if (msg.type === 'schedule') {
            //The draw instant, handed to us seconds early. From here on our own
            //clock decides when DRAW! appears - no packet on the critical path.
            drawAtHost      = msg.drawAt;
            localDrawActive = false;
            localDrawTs     = null;
            localFlashAt    = null;
            shotSent        = false;
        }
    });

    PeerNet.on('status', function (text) {
        $('#connStatus').text(text);
    });

    PeerNet.on('joinFailed', function (text) {
        showLobbyError(text);
        $('#createRoomButton, #joinRoomButton').prop('disabled', false);
    });

    PeerNet.on('hostGone', function () {
        inRoom = false;
        stopAllSounds();
        $('#offlineMessage span').text('The table has folded. Refresh to ride again.');
        $('#offlineMessage').css('display', 'flex');
    });

    PeerNet.on('error', function (err) {
        if (!inRoom) {
            showLobbyError(prettyPeerError(err));
            $('#createRoomButton, #joinRoomButton').prop('disabled', false);
        }
    });

    PeerNet.on('clock', updatePing);
}

function prettyPeerError(err) {
    var t = err && err.type;
    if (t === 'peer-unavailable') return 'No table found with that code.';
    if (t === 'network')          return 'Could not reach the matchmaking service.';
    if (t === 'browser-incompatible') return 'This browser cannot do peer to peer.';
    return 'Connection trouble: ' + (t || 'unknown');
}

function applyState(gs) {
    globalState = gs;

    //A fresh round is coming, forget everything about the last one. Clearing the
    //old schedule matters: a stale draw instant sits in the past, and would flip
    //us to DRAW! the moment the next tick-tock started.
    if (gs.state === 'highnoon' || gs.state === 'waiting' || gs.state === 'resetting') {
        localDrawActive = false;
        localDrawTs     = null;
        localFlashAt    = null;
        shotSent        = false;
        drawAtHost      = null;
    }

    updateQueueTable(gs);
}

/* =======================================================================
 * The local draw flip - where the stopwatch starts
 * ==================================================================== */
function currentPhase() {
    if (!globalState) return null;
    var state = globalState.state;

    //Your gun goes off the instant you pull the trigger. The host is still
    //settling who actually won - it has to wait long enough that a faster shot
    //from your opponent could not still be in flight - but none of that belongs
    //on the critical path of your own muzzle flash.
    if (localFlashAt !== null && (state === 'draw' || state === 'ticktock'))
        return 'flashed';

    //We may have flipped locally a hair before the host's own state change
    //message shows up. What we render is what we are timed against.
    if (state === 'ticktock' && localDrawActive) return 'draw';
    return state;
}

function maybeFlipToDraw(ts) {
    if (localDrawActive || !globalState) return;
    if (globalState.state !== 'ticktock' && globalState.state !== 'draw') return;

    var scheduleReached = (drawAtHost !== null && PeerNet.hostNow() >= drawAtHost);
    //Fallback: if the schedule never reached us, the host's state change still
    //starts the round for us. We are simply timed from our own later start.
    var hostSaysDraw = (globalState.state === 'draw');

    if (scheduleReached || hostSaysDraw) {
        localDrawActive = true;
        localDrawTs     = ts; //timestamp of the frame that is about to paint DRAW!
    }
}

function amDueling() {
    var gs = globalState;
    if (!gs || !myId) return false;
    return (gs.player1 && gs.player1.id === myId) || (gs.player2 && gs.player2.id === myId);
}

//Prefer the event's own timestamp over "whenever the handler happened to run",
//so a busy main thread does not get charged to the player.
function eventTime(e) {
    var oe = e.originalEvent || e;
    var ts = oe ? oe.timeStamp : null;
    if (typeof ts !== 'number' || !isFinite(ts) || Math.abs(ts - PeerNet.now()) > 1000)
        return PeerNet.now();
    return ts;
}

function pullTrigger(ts) {
    if (shotSent) return;
    var phase = currentPhase();

    if (phase === 'ticktock') {
        shotSent     = true;
        localFlashAt = ts;
        PeerNet.sendToHost({ type: 'shot', kind: 'missfire', atHost: PeerNet.toHost(ts) });
        return;
    }

    if (phase !== 'draw' || localDrawTs === null) return;

    var rt = ts - localDrawTs;
    if (!isFinite(rt) || rt < 0) rt = 0;
    shotSent     = true;
    localFlashAt = ts;
    PeerNet.sendToHost({ type: 'shot', kind: 'draw', rt: rt, atHost: PeerNet.toHost(ts) });
}

/* =======================================================================
 * Sound
 * ==================================================================== */
function playSound(soundName, volume) {
    var s = sounds[soundName];
    if (s.paused) {
        s.volume = (volume === undefined) ? 1.0 : volume;
        var p = s.play();
        if (p && p.catch) p.catch(function () {});
    }
}

function stopSound(soundName) {
    sounds[soundName].pause();
    sounds[soundName].currentTime = 0;
}

function stopAllSounds() {
    for (var name in sounds) {
        sounds[name].pause();
        sounds[name].currentTime = 0;
    }
}

/* =======================================================================
 * Lobby / room UI
 * ==================================================================== */
function nameOrDefault() {
    var name = $.trim($('#playerNameInput').val());
    if (name === '') {
        name = 'Big Iron #' + (Math.floor(Math.random() * 100) + 1);
        $('#playerNameInput').val(name);
    }
    return name;
}

function showLobbyError(text) {
    $('#lobbyError').text(text).css('display', 'block');
}

function showRoom(info) {
    $('#lobbyError').css('display', 'none');
    $('#lobbyPanel').css('display', 'none');
    $('#roomPanel').css('display', 'block');
    $('#roomCodeDisplay').text(info.roomCode);
    $('#roomRole').text(info.isHost ? 'You are dealing' : 'You are sitting in');
    try {
        history.replaceState(null, '', location.pathname + '?table=' + info.roomCode);
    } catch (e) {}
    updatePing();
}

//The async clipboard rejects whenever the page is not focused, so fall back to
//the old textarea trick rather than throwing a blocking prompt at the player.
function copyToClipboard(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
            function () { done(true); },
            function () { legacyCopy(text, done); }
        );
    } else {
        legacyCopy(text, done);
    }
}

function legacyCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    done(ok);
}

function updatePing() {
    if (!inRoom) return;
    if (PeerNet.isHost()) {
        $('#pingDisplay').text('Dealer - 0ms to yourself');
        return;
    }
    var c = PeerNet.clock();
    $('#pingDisplay').text(c.synced ? ('Ping to dealer: ' + Math.round(c.rtt) + 'ms')
                                    : 'Syncing clocks...');
}

function updateQueueTable(gs) {
    var tbody = $('#playerQueue tbody');
    tbody.empty();

    tbody.append(duelistRow(gs, gs.player1, 'RED', 'redQueue'));
    tbody.append(duelistRow(gs, gs.player2, 'BLU', 'blueQueue'));

    gs.playerQueue.forEach(function (player, index) {
        var row = $('<tr>');
        row.append($('<td>').text('#' + (index + 1)));
        row.append($('<td>').text(nameFor(player)));
        row.append($('<td>').text(player.wins));
        row.append($('<td>').text(player.missfire));
        row.append($('<td>').text(formatDraw(player.fastestDraw)));
        tbody.append(row);
    });
}

function duelistRow(gs, player, label, cls) {
    var row = $('<tr class="' + cls + '">');
    row.append($('<td>').text(label));

    //Keep the result under our hat until the flash clears
    if (gs.state === 'flashed') {
        for (var i = 0; i < 4; i++) row.append($('<td>').text('?'));
        return row;
    }
    if (!player) {
        for (var j = 0; j < 4; j++) row.append($('<td>').text('-'));
        return row;
    }
    row.append($('<td>').text(nameFor(player)));
    row.append($('<td>').text(player.wins));
    row.append($('<td>').text(player.missfire));
    row.append($('<td>').text(formatDraw(player.fastestDraw)));
    return row;
}

//Whatever this browser's own player is called, wherever they are sitting
function myNameIn(gs) {
    if (gs.player1 && gs.player1.id === myId) return gs.player1.name;
    if (gs.player2 && gs.player2.id === myId) return gs.player2.name;
    for (var i = 0; i < gs.playerQueue.length; i++)
        if (gs.playerQueue[i].id === myId) return gs.playerQueue[i].name;
    return null;
}

function nameFor(player) {
    return player.id === myId ? player.name + ' (you)' : player.name;
}

function formatDraw(ms) {
    return (typeof ms !== 'number' || ms > 2900) ? 'N/A' : ms + 'ms';
}

/* =======================================================================
 * Rendering
 * ==================================================================== */
var tollOnce        = true;
var shootOnce       = true;
var drawOnce        = true;
var tickTockOnce    = true;
var gameOverOnce    = true;
var whipCrackedOnce = true;
var highNoonOnce    = true;

function gameLoop(ts) {
    if (globalState) {
        maybeFlipToDraw(ts);
        drawGameState(globalState, currentPhase());
    } else {
        drawIdle();
    }
    requestAnimationFrame(gameLoop);
}

function drawIdle() {
    var ctx = document.getElementById('canvas').getContext('2d');
    drawBackround(ctx);
    ctx.fillStyle = 'black';
    ctx.font = '30px ' + fontFamily;
    var text = inRoom ? 'Waiting on the wire...' : 'Start a table or join one, partner.';
    var w = ctx.measureText(text).width;
    ctx.fillText(text, (ctx.canvas.width / 2) - (w / 2) - 5, (ctx.canvas.height / 2) - 25);
}

function drawGameState(gs, phase) {
    var ctx = document.getElementById('canvas').getContext('2d');

    drawBackround(ctx);
    drawPlayers(ctx, phase, gs.player1, gs.player2);

    if (phase === 'highnoon') {
        shootOnce = true;
        tollOnce = true;
        tickTockOnce = true;
        drawOnce = true;
        if (whipCrackedOnce) {
            playSound('whipCracked', .35);
            whipCrackedOnce = false;
        }
        if (highNoonOnce) {
            stopSound('mainMusic');
            playSound('highNoon', .45);
            highNoonOnce = false;
        }
        if (tickTockOnce) {
            playSound('tickTock', .45);
            tickTockOnce = false;
        }
        drawHighNoonText(ctx);
    }

    if (phase === 'ticktock') {
        whipCrackedOnce = true;
        if (tollOnce) {
            playSound('tollingBell', .50);
            tollOnce = false;
        }
        drawClock(ctx);
    }

    if (phase === 'draw') {
        if (drawOnce) {
            playSound('whipCracked', .35);
            stopSound('tickTock');
            drawOnce = false;
        }
        drawDrawText(ctx);
    }

    if (phase === 'flashed' || phase === 'gameover') {
        if (shootOnce) {
            stopSound('tickTock');
            playSound('gunShot', .45);
            shootOnce = false;
        }
        drawFlashed(ctx);
    }

    if (phase === 'gameover') {
        if (gameOverOnce)
            playSound('mainMusic', .35);
        drawGameOverText(gs, ctx);
    }

    if (phase === 'resetting' || phase === 'waiting') {
        whipCrackedOnce = true;
        highNoonOnce = true;
        drawWaitingForQueue(gs, ctx);
    }
}

function drawWaitingForQueue(gs, ctx) {
    ctx.fillStyle = 'black';
    ctx.font = '30px ' + fontFamily;
    var text;
    if (gs.playerQueue.length === 0 && !gs.player1 && !gs.player2)
        text = 'Waiting for cowfolk...';
    else if (!gs.player1 && !gs.player2 && gs.playerQueue.length >= 2)
        text = 'Next up is ' + gs.playerQueue[0].name + ' and ' + gs.playerQueue[1].name + '!';
    else if (gs.playerQueue.length)
        text = 'Prepared to die ' + (myNameIn(gs) || gs.playerQueue[0].name) + '?';
    else
        text = 'Need one more soul at this table...';

    var textWidth = ctx.measureText(text).width;
    ctx.fillText(text, (ctx.canvas.width / 2) - (textWidth / 2) - 5, (ctx.canvas.height / 2) - 25);

    if (!gs.player1 || !gs.player2) {
        ctx.font = '20px ' + fontFamily;
        var code = 'Table code: ' + (gs.roomCode || PeerNet.roomCode());
        var codeWidth = ctx.measureText(code).width;
        ctx.fillText(code, (ctx.canvas.width / 2) - (codeWidth / 2) - 5, (ctx.canvas.height / 2) + 20);
    }
}

var flashAlpha = 1;
function drawFlashed(ctx) {
    ctx.fillStyle = 'rgba(255, 255, 255,' + flashAlpha + ')';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    flashAlpha -= .001;
}

function drawClock(ctx) {
    flashAlpha = 1; //Reset flash Alpha here because why not
    var centerX = ctx.canvas.width / 2;
    var centerY = ctx.canvas.height / 2;
    var radius = 60;

    ctx.fillStyle = '#fffaed';
    ctx.beginPath();
    ctx.arc(centerX - 5, centerY - 100, radius, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();
}

function drawGameOverText(gs, ctx) {
    ctx.fillStyle = 'black';
    ctx.font = '55px ' + fontFamily;
    var text = 'Duel Over!';
    var textWidth = ctx.measureText(text).width;
    ctx.fillText(text, (ctx.canvas.width / 2) - (textWidth / 2) - 5, (ctx.canvas.height / 2) - 120);

    ctx.font = '28px ' + fontFamily;
    text = gs.reasonForEnd;
    textWidth = ctx.measureText(text).width;
    ctx.fillText(text, (ctx.canvas.width / 2) - (textWidth / 2) - 5, (ctx.canvas.height / 2) - 40);
}

function drawHighNoonText(ctx) {
    ctx.fillStyle = 'black';
    ctx.font = '50px ' + fontFamily;
    var text = "IT'S HIGH NOON!";
    var textWidth = ctx.measureText(text).width;
    ctx.fillText(text, (ctx.canvas.width / 2) - (textWidth / 2) - 5, (ctx.canvas.height / 2) - 90);
}

function drawDrawText(ctx) {
    ctx.fillStyle = 'brown';
    ctx.font = '120px ' + fontFamily;
    var text = 'DRAW!';
    var textWidth = ctx.measureText(text).width;
    ctx.fillText(text, (ctx.canvas.width / 2) - (textWidth / 2) - 5, (ctx.canvas.height / 2) - 70);
}

function drawPlayers(ctx, phase, player1, player2) {
    var canvasWidth = ctx.canvas.width;
    var rectangleWidth = 20;
    var rectangleHeight = 60;
    var gunWidth = 25;
    var gunHeight = 8;
    var showGuns = (phase === 'flashed' || phase === 'gameover');

    if (player1) {
        ctx.fillStyle = 'black';
        ctx.font = '18px ' + fontFamily;
        var textWidth1 = ctx.measureText(player1.name).width;
        ctx.fillText(player1.name, 200 + (rectangleWidth / 2) - (textWidth1 / 2), ctx.canvas.height - 160);

        if (showGuns && player1.lastDraw !== '')
            ctx.fillText(player1.lastDraw + 'ms', 200 - 70, ctx.canvas.height - 110);

        ctx.fillStyle = '#E53737';
        if (player1.isDead)
            ctx.fillRect(150, ctx.canvas.height - 100, rectangleHeight, rectangleWidth);
        else {
            ctx.fillRect(200, ctx.canvas.height - 140, rectangleWidth, rectangleHeight);
            if (showGuns) {
                ctx.fillStyle = '#5e666e';
                ctx.fillRect(220, ctx.canvas.height - 145 + (rectangleHeight / 2) - (gunHeight / 2), gunWidth, gunHeight);
            }
        }
    }

    if (player2) {
        ctx.fillStyle = 'black';
        ctx.font = '18px ' + fontFamily;
        var textWidth2 = ctx.measureText(player2.name).width;
        ctx.fillText(player2.name, (canvasWidth - rectangleWidth) - 200 + (rectangleWidth / 2) - (textWidth2 / 2), ctx.canvas.height - 160);

        if (showGuns && player2.lastDraw !== '')
            ctx.fillText(player2.lastDraw + 'ms', canvasWidth - 170, ctx.canvas.height - 110);

        ctx.fillStyle = '#3737E5';
        if (player2.isDead)
            ctx.fillRect((canvasWidth - rectangleWidth) - 195, ctx.canvas.height - 100, rectangleHeight, rectangleWidth);
        else {
            ctx.fillRect((canvasWidth - rectangleWidth) - 200, ctx.canvas.height - 140, rectangleWidth, rectangleHeight);
            if (showGuns) {
                ctx.fillStyle = '#5e666e';
                ctx.fillRect((canvasWidth - rectangleWidth) - 200 - gunWidth, ctx.canvas.height - 145 + (rectangleHeight / 2) - (gunHeight / 2), gunWidth, gunHeight);
            }
        }
    }
}

function drawBackround(ctx) {
    var squareSize = 10;
    var numRows = Math.ceil(ctx.canvas.height / squareSize);
    var numCols = Math.ceil(ctx.canvas.width / squareSize);

    for (var row = 0; row < numRows; row++) {
        for (var col = 0; col < numCols; col++) {
            ctx.fillStyle = ((row + col) % 2 === 0) ? '#FFF0C1' : '#FFEAAA';
            ctx.fillRect(col * squareSize, row * squareSize, squareSize, squareSize);
        }
    }

    ctx.fillStyle = '#705636';
    ctx.fillRect(0, ctx.canvas.height - 80, ctx.canvas.width, 80);

    var lineWidth = 3;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, ctx.canvas.width, lineWidth);
    ctx.fillRect(0, 0, lineWidth, ctx.canvas.height);
    ctx.fillRect(ctx.canvas.width - lineWidth, 0, lineWidth, ctx.canvas.height);
    ctx.fillRect(0, ctx.canvas.height - lineWidth, ctx.canvas.width, lineWidth);
}

/* =======================================================================
 * Boot
 * ==================================================================== */
$(document).keydown(function (e) {
    if (e.which !== 32) return;
    if (!inRoom || !amDueling()) return;
    var phase = currentPhase();
    if (phase !== 'draw' && phase !== 'ticktock') return;
    e.preventDefault();
    pullTrigger(eventTime(e));
});

$(document).ready(function () {
    wireNetwork();
    requestAnimationFrame(gameLoop);

    var params = new URLSearchParams(location.search);
    var table = params.get('table');
    if (table) {
        $('#roomCodeInput').val(table.toUpperCase());
        $('#joinHint').text('You were invited to table ' + table.toUpperCase() + '.');
    }

    $('#createRoomButton').click(function () {
        var name = nameOrDefault();
        $('#createRoomButton, #joinRoomButton').prop('disabled', true);
        playSound('whipCracked', .35);
        playSound('mainMusic', .35);
        PeerNet.host(name);
    });

    $('#joinRoomButton').click(function () {
        var code = $.trim($('#roomCodeInput').val());
        if (code === '') {
            showLobbyError('Enter the table code your partner gave you.');
            return;
        }
        var name = nameOrDefault();
        $('#createRoomButton, #joinRoomButton').prop('disabled', true);
        playSound('whipCracked', .35);
        playSound('mainMusic', .35);
        PeerNet.join(code, name, function (err) {
            if (err) {
                showLobbyError(err.message);
                $('#createRoomButton, #joinRoomButton').prop('disabled', false);
            }
        });
    });

    $('#roomCodeInput').keypress(function (e) {
        if (e.which === 13) $('#joinRoomButton').click();
    });

    $('#playerNameInput').keypress(function (e) {
        if (e.which === 13) {
            if ($.trim($('#roomCodeInput').val()) !== '')
                $('#joinRoomButton').click();
            else
                $('#createRoomButton').click();
        }
    });

    $('#copyCodeButton').click(function () {
        var button = $(this);
        copyToClipboard(PeerNet.roomCode(), function (ok) {
            button.text(ok ? 'Copied!' : 'Press Ctrl+C');
            setTimeout(function () { button.text('Copy Code'); }, 1500);
        });
    });

    setInterval(updatePing, 1000);
});
