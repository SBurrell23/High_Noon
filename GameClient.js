var socket = null;
var reConnectInterval = null;
var fontFamily = 'Permanent Marker';

function connectWebSocket() {
    console.log("Attempting to connect to websocket...");
    globalState = null;
    playerId = -1;
    $("#playerNameInput").prop('disabled', false);
    $("#joinGameButton").prop('disabled', false);
    
    clearInterval(reConnectInterval);

    socket = new WebSocket('ws://localhost:8080'); //stayaway.onrender.com
    socket.addEventListener('open', function () {
        console.log('WebSocket connection established!');
        $("#offlineMessage").css("display", "none");
        socket.addEventListener('message', function (event) {
            recievedServerMessage(event.data);
        });
        requestAnimationFrame(gameLoop);
    });


    socket.addEventListener('close', function(event) {
        console.log('WebSocket connection closed.');
        stopAllSounds();
        $("#offlineMessage").css("display", "flex");
        reConnectInterval = setInterval(function() {
            connectWebSocket();
        }, 3000) //On disconnect, try to reconnect every 3 seconds
    });
}

connectWebSocket();

var globalState = null;
var playerId = -1;

var sounds  = {
    mainMusic: new Audio('sounds/mainMusic.mp3'),
    highNoon: new Audio('sounds/highNoon.mp3'),
    tollingBell: new Audio('sounds/tollingBell.wav'),
    gunShot: new Audio('sounds/gunShot.wav'),
    whipCracked: new Audio('sounds/whipCracked.mp3')
}

function recievedServerMessage(message) {
    var message = JSON.parse(message);

    if(message.type == "playerId"){
        playerId = message.id
        localStorage.setItem("HNPID", playerId);
    }
    else if(message.type == "gs"){
        globalState = message;
        updateLobby(globalState);
        updateInput(globalState,playerId);
    }
}

function gameLoop(gs) {
    var gs = globalState;
    if (gs) {
        drawGameState(gs);
    }
    requestAnimationFrame(gameLoop); // schedule next game loop
}

function playSound(soundName, volume = 1.0) {
    // Only play the sound if it's not currently playing
    if (sounds[soundName].paused) {
        sounds[soundName].volume = volume;
        sounds[soundName].play();
    }
}

function stopSound(soundName) {
    sounds[soundName].pause();
    sounds[soundName].currentTime = 0;
}

function stopAllSounds() {
    for (let soundName in sounds) {
        sounds[soundName].pause();
        sounds[soundName].currentTime = 0;
    }
}

//Looks at the player list, and updates the lobby inputs according to each players state
function updateLobby(gs){
    var playerQueue = $('#playerQueue tbody');
    playerQueue.empty(); // Clear the existing player queue

    var player1 = gs.player1;
    var player1Row = $('<tr class=\'redQueue\' >');
    if(player1 && gs.state != "flashed"){
        player1Row.append($('<td>').text("RED"));
        player1Row.append($('<td>').text(player1.name));
        player1Row.append($('<td>').text(player1.wins));
        player1Row.append($('<td>').text(player1.missfire));
        if(player1.fastestDraw > 2900)
            player1.fastestDraw = "N/A"; 
        else
            player1.fastestDraw = player1.fastestDraw + "ms";
        player1Row.append($('<td>').text(player1.fastestDraw));
        playerQueue.append(player1Row);
    }else if(gs.state == "flashed"){
        player1Row.append($('<td>').text("RED"));
        player1Row.append($('<td>').text("?"));
        player1Row.append($('<td>').text("?"));
        player1Row.append($('<td>').text("?"));
        player1Row.append($('<td>').text("?"));
        playerQueue.append(player1Row);
    }else{
        player1Row.append($('<td>').text("RED"));
        player1Row.append($('<td>').text("-"));
        player1Row.append($('<td>').text("-"));
        player1Row.append($('<td>').text("-"));
        player1Row.append($('<td>').text("-"));
        playerQueue.append(player1Row);
    }

    var player2 = gs.player2;
    var player2Row = $('<tr class=\'blueQueue\' >');
    if(player2 && gs.state != "flashed"){
        player2Row.append($('<td>').text("BLU"));
        player2Row.append($('<td>').text(player2.name));
        player2Row.append($('<td>').text(player2.wins));
        player2Row.append($('<td>').text(player2.missfire));
        if(player2.fastestDraw > 2900)
            player2.fastestDraw = "N/A"; 
        else
            player2.fastestDraw = player2.fastestDraw + "ms";
        player2Row.append($('<td>').text(player2.fastestDraw));
        playerQueue.append(player2Row);
    }else if(gs.state == "flashed"){
        player2Row.append($('<td>').text("BLU"));
        player2Row.append($('<td>').text("?"));
        player2Row.append($('<td>').text("?"));
        player2Row.append($('<td>').text("?"));
        player2Row.append($('<td>').text("?"));
        playerQueue.append(player2Row);
    }else{
        player2Row.append($('<td>').text("BLU"));
        player2Row.append($('<td>').text("-"));
        player2Row.append($('<td>').text("-"));
        player2Row.append($('<td>').text("-"));
        player2Row.append($('<td>').text("-"));
        playerQueue.append(player2Row);
    }

    gs.playerQueue.forEach(function(player, index) {
        var row = $('<tr>');
        row.append($('<td>').text("#" + (index + 1) ));
        row.append($('<td>').text(player.name));
        row.append($('<td>').text(player.wins));
        row.append($('<td>').text(player.missfire));
        if(player.fastestDraw > 2900)
            player.fastestDraw = "N/A";
        else
            player.fastestDraw = player.fastestDraw + "ms";
        row.append($('<td>').text(player.fastestDraw));
        playerQueue.append(row);
    });
}

function updateInput(gs,id){
    if(playerConnected(gs,id)){
        $("#playerNameInput").prop('disabled', true);
        $("#joinGameButton").prop('disabled', true);
    }
}

function playerConnected(gs,id){
    for (let i = 0; i < gs.playerQueue.length; i++) 
        if (gs.playerQueue[i].id == id) 
            return true;
    if (gs.player1 && gs.player1.id == id) 
        return true;
    if (gs.player2 && gs.player2.id == id) 
        return true;
    return false;
}

var tollOnce = true;
var shootOnce = true;
var noonOnce = true;
var gameOverOnce = true;
var whipCrackedOnce = true;
function drawGameState(gs) {
    // Get a reference to the canvas context
    var ctx = document.getElementById('canvas').getContext('2d');

    drawBackround(ctx);
    
    drawPlayers(ctx, gs.player1, gs.player2);

    if(gs.state == "highnoon"){
        shootOnce = true;
        tollOnce = true;
        noonOnce = true;
        if(whipCrackedOnce){
            playSound("whipCracked",.35);
            whipCrackedOnce = false;
        }
        stopSound("mainMusic");
        drawHighNoonText(ctx);
    }

    if(gs.state == "ticktock"){
        whipCrackedOnce = true;
        if(tollOnce){
            playSound("tollingBell",.50);
            tollOnce = false;
         }
        if(noonOnce){
            playSound("highNoon",.45);
            noonOnce = false;
        }
        drawClock(gs,ctx);
    }

    if(gs.state == "draw"){
        drawDrawText(ctx);
        //testing code that smashes space immediately after draw
        //var event = new KeyboardEvent('keydown', {key: ' ', code: 'Space', which: 32, keyCode: 32});
        //document.dispatchEvent(event);
    }

    if(gs.state == "flashed" || gs.state == "gameover"){
        if(shootOnce){
            stopSound("highNoon");
            playSound("gunShot",.45);
            shootOnce = false;
        }
        drawFlashed(ctx);
    }

    if(gs.state == "gameover"){
        if(gameOverOnce){
            playSound("mainMusic",.35);
        }
        if(whipCrackedOnce){
            playSound("whipCracked",.35);
            whipCrackedOnce = false;
        }
        drawGameOverText(gs,ctx);
    }

    if(gs.state == "resetting" || gs.state == "waiting"){
        whipCrackedOnce = true;
        drawWaitingForQueue(gs,ctx);
    }

}   

function drawWaitingForQueue(gs,ctx) {
    ctx.fillStyle = 'black';
    ctx.font = '30px ' + fontFamily;
    var text = "";
    if(gs.playerQueue.length == 0)
        text = "Waiting for cowfolk...";
    else if (gs.player1 == undefined && gs.player2 == undefined && gs.playerQueue.length >= 2)
        text = "Next up is " + gs.playerQueue[0].name + " and " + gs.playerQueue[1].name + "!";
    else
        text = "Prepared to die " + gs.playerQueue[0].name + "?";

    const textWidth = ctx.measureText(text).width;
    const textX = (ctx.canvas.width / 2) - (textWidth / 2) - 5;
    const textY = (ctx.canvas.height / 2) - 25;
    ctx.fillText(text, textX, textY);
}

var flashAlpha = 1;
function drawFlashed(ctx) {
    ctx.fillStyle = "rgba(255, 255, 255,"+flashAlpha+")";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    flashAlpha -= .001;
}

function drawClock(gs, ctx) {
    flashAlpha = 1; //Reset flash Alpha here because why not
    const centerX = ctx.canvas.width / 2;
    const centerY = ctx.canvas.height / 2;
    const radius = 60;
    
    ctx.fillStyle = '#fffaed';
    ctx.beginPath();
    ctx.arc(centerX - 5, centerY - 100, radius, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();
}

function drawGameOverText(gs,ctx) {
    ctx.fillStyle = 'black';
    ctx.font = '55px ' + fontFamily;
    var text = "Duel Over!";
    var textWidth = ctx.measureText(text).width;
    var textX = (ctx.canvas.width / 2) - (textWidth / 2) - 5;
    var textY = (ctx.canvas.height / 2) - 120;
    ctx.fillText(text, textX, textY);

    ctx.font = '28px ' + fontFamily;
    text = gs.reasonForEnd;
    textWidth = ctx.measureText(text).width;
    textX = (ctx.canvas.width / 2) - (textWidth / 2) - 5;
    textY = (ctx.canvas.height / 2) - 40;
    ctx.fillText(text, textX, textY);
}

function drawHighNoonText(ctx) {
    ctx.fillStyle = 'black';
    ctx.font = '50px ' + fontFamily;
    var text = "IT'S HIGH NOON!";
    const textWidth = ctx.measureText(text).width;
    const textX = (ctx.canvas.width / 2) - (textWidth / 2) - 5;
    const textY = (ctx.canvas.height / 2) - 90;
    ctx.fillText(text, textX, textY);
}

function drawDrawText(ctx) {
    ctx.fillStyle = 'brown';
    ctx.font = '120px ' + fontFamily;
    var text = "DRAW!";
    const textWidth = ctx.measureText(text).width;
    const textX = (ctx.canvas.width / 2) - (textWidth / 2) - 5;
    const textY = (ctx.canvas.height / 2) - 70;
    ctx.fillText(text, textX, textY);
}

function drawPlayers(ctx, player1, player2) {
    const canvasWidth = ctx.canvas.width;
    const rectangleWidth = 20;
    const rectangleHeight = 60;
    const gunWidth = 25;
    const gunHeight = 8;

    if (player1) {
        // Write player1's name above the red rectangle
        ctx.fillStyle = 'black';
        ctx.font = '18px ' + fontFamily;
        const textWidth1 = ctx.measureText(player1.name).width;
        const textX1 = 200 + (rectangleWidth / 2) - (textWidth1 / 2);
        ctx.fillText(player1.name, textX1, ctx.canvas.height - 160);

        // Write player2's fastestDraw next to the player on the right
        if ((globalState.state == "flashed" || globalState.state == "gameover") && player1.lastDraw != ""){
            const fastestDrawText = player1.lastDraw + "ms";
            ctx.fillText(fastestDrawText, 200 - 70, ctx.canvas.height - 110);
        }

        // Draw red rectangle on the left side
        ctx.fillStyle = 'red';
        if (player1.isDead)
            ctx.fillRect(150, ctx.canvas.height - 100, rectangleHeight, rectangleWidth);
        else {
            ctx.fillRect(200, ctx.canvas.height - 140, rectangleWidth, rectangleHeight);

            if (globalState.state == "flashed" || globalState.state == "gameover") {
                ctx.fillStyle = '#5e666e';
                ctx.fillRect(220, ctx.canvas.height - 145 + (rectangleHeight / 2) - (gunHeight / 2), gunWidth, gunHeight);
            }
        }
    }

    if (player2) {
        // Write player2's name above the blue rectangle
        ctx.fillStyle = 'black';
        ctx.font = '18px ' + fontFamily;
        const textWidth2 = ctx.measureText(player2.name).width;
        const textX2 = (canvasWidth - rectangleWidth) - 200 + (rectangleWidth / 2) - (textWidth2 / 2);
        ctx.fillText(player2.name, textX2, ctx.canvas.height - 160);

        // Write player2's fastestDraw next to the player on the right
        if ((globalState.state == "flashed" || globalState.state == "gameover") && player2.lastDraw != ""){
            const fastestDrawText = player2.lastDraw + "ms";
            ctx.fillText(fastestDrawText, canvasWidth - 170, ctx.canvas.height - 110);
        }
    

        // Draw blue rectangle on the right side
        ctx.fillStyle = 'blue';
        if (player2.isDead)
            ctx.fillRect((canvasWidth - rectangleWidth) - 195, ctx.canvas.height - 100, rectangleHeight, rectangleWidth);
        else {
            
            ctx.fillRect((canvasWidth - rectangleWidth) - 200, ctx.canvas.height - 140, rectangleWidth, rectangleHeight);
                
            if (globalState.state == "flashed" || globalState.state == "gameover") {
                ctx.fillStyle = '#5e666e';
                ctx.fillRect((canvasWidth - rectangleWidth) - 200 - gunWidth, ctx.canvas.height - 145 + (rectangleHeight / 2) - (gunHeight / 2), gunWidth, gunHeight);
            }
        }
    }
}

function drawBackround(ctx) {
    const squareSize = 10;
    const numRows = Math.ceil(ctx.canvas.height / squareSize);
    const numCols = Math.ceil(ctx.canvas.width / squareSize);

    for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {
            const x = col * squareSize;
            const y = row * squareSize;

            if ((row + col) % 2 === 0) {
                ctx.fillStyle = '#FFF0C1';
            } else {
                ctx.fillStyle = '#FFEAAA';
            }

            ctx.fillRect(x, y, squareSize, squareSize);
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

function shoot(e){
    socket.send(JSON.stringify({
        type:"playerShot",
        id:playerId
    }));
    e.preventDefault();
}

$(document).keydown(function(e) {
    if (
    (globalState.state == "draw" || globalState.state == "ticktock") && 
    (globalState.player1.id == playerId || globalState.player2.id == playerId)
    ){
        if(e.which == 32)
            shoot(e);
    }
});

$(document).ready(function() {
    var HNPID = localStorage.getItem('HNPID');
    if (HNPID) {
        playerId = HNPID;
    }

    $('#joinGameButton').click(function() {
        var playerName = $('#playerNameInput').val();
        if(playerName == ""){
          playerName = "Big Iron #"+ (Math.floor(Math.random() * 100) + 1);
          $('#playerNameInput').val(playerName);
        }
        playSound("whipCracked",.35);
        playSound("mainMusic",.35);
        socket.send(JSON.stringify({
            type:"playerJoin",
            name:playerName,
            id:playerId
        }));
    });

    $('#playerNameInput').keypress(function(e) {
        if (e.which === 13) {
            $('#joinGameButton').click();
        }
    });
});

