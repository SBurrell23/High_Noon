const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

var gs = {
    type: "gs",
    state: 'waiting',
    playerQueue:[],
    player1:undefined,
    player2:undefined,
    playTime: 0
};

var playerObject ={
    id: -1,
    name: "",
    isConnected: false,
    wins: 0,
    falseDraws: 0,
    fastestDraw: 0,
    isDead: false
};

var defaultGameState = JSON.parse(JSON.stringify(gs));

var canvas = {width: 1200,height: 500};

const users = new Map();

wss.on('connection', (ws, req) => {
    
    // Send the current game state to the client
    ws.on('message', (message) => {
        message = JSON.parse(message);

        if(message.type == "playerJoin"){
            var newPlayer = JSON.parse(JSON.stringify(playerObject));
            newPlayer.isConnected = true;
            newPlayer.name = message.name;
            newPlayer.id = Date.now();
            users.set(ws, newPlayer.id);
            gs.playerQueue.push(newPlayer);
            console.log("Player joined: " + JSON.stringify(newPlayer));
            // Send the player's ID back to the client
            ws.send(JSON.stringify({ type: "playerId", id: newPlayer.id }));

            if(gs.state == "waiting")
                checkForGameStart();
        }

        if(message.type == "playerShot")
            playerShot(message.id);

    });

    //A user has disconnected
    ws.on('close', function() {
        console.log('Connection closed');
        console.log('User id ' + users.get(ws) + ' disconnected');
        const disconnectedUserId = users.get(ws);
        users.delete(ws);
        // Remove the player from the gs.players array with the id of the disconnected user
        gs.playerQueue = gs.playerQueue.filter(player => player.id !== disconnectedUserId);
        
        if(users.size === 0) {
            console.log('All clients disconnected...');
            resetGameState();
        }
    });

});

function checkForGameStart(){
    if(gs.player1 == undefined)
        gs.player1 = gs.playerQueue.shift();
    else if(gs.player2 == undefined)
        gs.player2 = gs.playerQueue.shift();

    if(gs.player1 && gs.player2){
        setTimeout(function() {
            gs.state = "highnoon";
            setTimeout(function() {
                gs.state = "ticktock";
                setTimeout(function() {
                    gs.state = "draw";
                }, getRandSeconds(1,3)); //rand x seconds after ticktock, draw
            }, 1000); //x seconds after high noon, show the clock
        }, 1000); //x second after players are both in, high noon
    }
}

function playerShot(id){
    console.log("Player shot: " + id);
    if(gs.player1.id == id){
        gs.player1.wins++;
        gs.player2.isDead = true;
    }
    else if(gs.player2.id == id){
        gs.player2.wins++;
        gs.player1.isDead = true;
    }
    else
        console.log("Player shot not found ???" + id);

    gs.state = "flashed";
    setTimeout(function() {
        gs.state = "gameover";
    },2000); //x seconds after gunshot, show gameover
    
}

function getRandSeconds(min, max) {
    return (Math.random() * (max - min) + min) * 1000;
}

function resetGameState(){
    gs = JSON.parse(JSON.stringify(defaultGameState));
}

function updatePlayTime(){
    gs.playTime += 1;
}

setInterval(function() {
    updatePlayTime();

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(gs));
        }
    });
}, 50);