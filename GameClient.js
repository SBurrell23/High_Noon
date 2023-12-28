const socket = new WebSocket('ws://localhost:8080'); //stayaway.onrender.com
socket.addEventListener('open', function () {
    $("#offlineMessage").css("display", "none");
    socket.addEventListener('message', function (event) {
        recievedServerMessage(event.data);
    });
    requestAnimationFrame(gameLoop);
});

socket.addEventListener('close', function(event) {
    console.log('WebSocket connection closed.');
    $("#offlineMessage").css("display", "flex");
});

var globalState = null;
var playerId = -1;

function recievedServerMessage(message) {
    var message = JSON.parse(message);

    if(message.type == "playerId"){
        playerId = message.id
        localStorage.setItem("HNPID", playerId);
    }
    else if(message.type == "gs"){
        globalState = message;
        updateLobby(globalState);
    }
}

function gameLoop(gs) {
    var gs = globalState;
    if (gs) {
        drawGameState(gs);
    }
    requestAnimationFrame(gameLoop); // schedule next game loop
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
        player1Row.append($('<td>').text(player1.fastestDraw + "ms"));
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
        player2Row.append($('<td>').text(player2.fastestDraw + "ms"));
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
        row.append($('<td>').text(player.fastestDraw + "ms"));
        playerQueue.append(row);
    });
}

function drawGameState(gs) {
    // Get a reference to the canvas context
    var ctx = document.getElementById('canvas').getContext('2d');

    drawBackround(ctx);
    
    drawPlayers(ctx, gs.player1, gs.player2);

    if(gs.state == "highnoon")
        drawHighNoonText(ctx);

    if(gs.state == "ticktock")
        drawClock(gs,ctx);

    if(gs.state == "draw"){
        drawDrawText(ctx);
        var event = new KeyboardEvent('keydown', {key: ' ', code: 'Space', which: 32, keyCode: 32});
        document.dispatchEvent(event);
    }

    if(gs.state == "gameover")
        drawGameOverText(gs,ctx);

    if(gs.state == "flashed" || gs.state == "gameover")
        drawFlashed(ctx);

    if(gs.state == "resetting" || gs.state == "waiting")
        drawWaitingForQueue(gs,ctx);

}   

function drawWaitingForQueue(gs,ctx) {
    ctx.fillStyle = 'black';
    ctx.font = '30px Arial';
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
    
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(centerX - 5, centerY - 100, radius, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.fill();
}

function drawGameOverText(gs,ctx) {
    ctx.fillStyle = 'black';
    ctx.font = '45px Arial';
    var text = "Duel Over!";
    var textWidth = ctx.measureText(text).width;
    var textX = (ctx.canvas.width / 2) - (textWidth / 2) - 5;
    var textY = (ctx.canvas.height / 2) - 120;
    ctx.fillText(text, textX, textY);

    ctx.font = '28px Arial';
    text = gs.reasonForEnd;
    textWidth = ctx.measureText(text).width;
    textX = (ctx.canvas.width / 2) - (textWidth / 2) - 5;
    textY = (ctx.canvas.height / 2) - 50;
    ctx.fillText(text, textX, textY);
}

function drawHighNoonText(ctx) {
    ctx.fillStyle = 'black';
    ctx.font = '40px Arial';
    var text = "ITS HIGH NOON!";
    const textWidth = ctx.measureText(text).width;
    const textX = (ctx.canvas.width / 2) - (textWidth / 2) - 5;
    const textY = (ctx.canvas.height / 2) - 90;
    ctx.fillText(text, textX, textY);
}

function drawDrawText(ctx) {
    ctx.fillStyle = 'brown';
    ctx.font = '80px bold Arial';
    var text = "DRAW!";
    const textWidth = ctx.measureText(text).width;
    const textX = (ctx.canvas.width / 2) - (textWidth / 2) - 5;
    const textY = (ctx.canvas.height / 2) - 90;
    ctx.fillText(text, textX, textY);
}

function drawPlayers(ctx, player1, player2) {
    const canvasWidth = ctx.canvas.width;
    const rectangleWidth = 20;
    const rectangleHeight = 60;

    if(player1){
        // Write player1's name above the red rectangle
        ctx.fillStyle = 'black';
        ctx.font = '12px Arial';
        const textWidth1 = ctx.measureText(player1.name).width;
        const textX1 = 200 + (rectangleWidth / 2) - (textWidth1 / 2);
        ctx.fillText(player1.name, textX1, ctx.canvas.height - 150);
        // Draw red rectangle on the left side
        ctx.fillStyle = 'red';
        if(player1.isDead)
            ctx.fillRect(150, ctx.canvas.height - 100, rectangleHeight,rectangleWidth);
        else
            ctx.fillRect(200, ctx.canvas.height - 140, rectangleWidth, rectangleHeight);
    }

    if(player2){
        // Write player2's name above the blue rectangle
        ctx.fillStyle = 'black';
        ctx.font = '12px Arial';
        const textWidth2 = ctx.measureText(player2.name).width;
        const textX2 = (canvasWidth - rectangleWidth) - 200 + (rectangleWidth / 2) - (textWidth2 / 2);
        ctx.fillText(player2.name, textX2, ctx.canvas.height - 150);
        // Draw blue rectangle on the right side
        ctx.fillStyle = 'blue';
        if(player2.isDead)
            ctx.fillRect((canvasWidth - rectangleWidth) - 195, ctx.canvas.height - 100,rectangleHeight, rectangleWidth);
        else
            ctx.fillRect((canvasWidth - rectangleWidth) - 200, ctx.canvas.height - 140, rectangleWidth, rectangleHeight);
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
    if(e.which == 32)
        e.preventDefault();
});

$(document).ready(function() {
    var HNPID = localStorage.getItem('HNPID');
    if (HNPID) {
        playerId = HNPID;
    }

    $('#joinGameButton').click(function() {
        socket.send(JSON.stringify({
            type:"playerJoin",
            name:$('#playerNameInput').val(),
            id:playerId
        }));
    });
});

