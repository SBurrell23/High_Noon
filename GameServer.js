const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

var gs = {
    type: "gs",
    state: 'waiting',
    playerQueue:[],
    player1:undefined,
    player2:undefined,
    playTime: 0,
    reasonForEnd: ""
};

var playerObject ={
    id: -1,
    name: "",
    isConnected: false,
    wins: 0,
    missfire: 0,
    fastestDraw: 5000,
    lastDraw: "",
    isDead: false
};

var timeouts = [];
var drawTime = 0;
var defaultGameState = JSON.parse(JSON.stringify(gs));
const users = new Map();

wss.on('connection', (ws) => {
    
    // Send the current game state to the client
    ws.on('message', (message) => {
        message = JSON.parse(message);

        if(message.type == "playerJoin"){
            console.log("Player join request: " + message.id);
            if(playerConnected(message.id) == false){
                var newPlayer = JSON.parse(JSON.stringify(playerObject));
                newPlayer.isConnected = true;
                newPlayer.name = message.name;
                 newPlayer.id = String(Date.now());
                users.set(ws, newPlayer.id);
                gs.playerQueue.push(newPlayer);
                console.log("Player joined: " + JSON.stringify(newPlayer));
                // Send the player's ID back to the client
                ws.send(JSON.stringify({ type: "playerId", id: newPlayer.id }));

                if(gs.state == "waiting")
                    checkForGameStart();
            }else{
                //Player is already connected
                console.log("Player already connected: " + message.id);
            }
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
        
        if(gs.player1 && gs.player1.id == disconnectedUserId){
            gs.player1 = undefined;
            clearAllTimeouts();
            gs.state = "waiting";
        }
        else if(gs.player2 && gs.player2.id == disconnectedUserId){
            gs.player2= undefined;
            clearAllTimeouts();
            gs.state = "waiting";
        }

        if(users.size === 0) {
            console.log('All clients disconnected...');
            clearAllTimeouts();
            resetGameState();
        }
    });

});

function playerConnected(id){
    for (let i = 0; i < gs.playerQueue.length; i++) 
        if (gs.playerQueue[i].id == id) 
            return true;
    if (gs.player1 && gs.player1.id == id) 
        return true;
    if (gs.player2 && gs.player2.id == id) 
        return true;
    return false;
}

function checkForGameStart(){
    if(gs.player1 == undefined)
        gs.player1 = gs.playerQueue.shift();
    else if(gs.player2 == undefined)
        gs.player2 = gs.playerQueue.shift();

    if(gs.player1 && gs.player2){
        gs.state = "highnoon";
        createTimeout(function() {
            gs.state = "ticktock";
            createTimeout(function() {
                if(gs.state == "ticktock"){ //if nobody missfired...
                    gs.state = "draw";
                    drawTime = Date.now();
                    //On draw, immediately send the draw state to the clients
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) 
                            client.send(JSON.stringify(gs));
                    });
                    createTimeout(function() {
                        if(gs.state == "draw")
                            playerShot("peace");
                    }, 3000); //3 seconds and then peace is not an option
                }
            }, getRandSeconds(5,17)); //rand x seconds after ticktock, draw
        }, 5100); //x seconds after high noon, show the clock
    }
}

function getPlayerById(id) {
    if (gs.player1 && gs.player1.id === id) {
        return gs.player1;
    } else if (gs.player2 && gs.player2.id === id) {
        return gs.player2;
    } else {
        return null;
    }
}

function playerShot(id){
    gs.reasonForEnd = "";
    gs.player1.lastDraw = "";
    gs.player2.lastDraw = "";

    var timeToShoot = parseInt(Date.now() - parseInt(drawTime));

    if(id == "peace"){
        gs.player1.wins -= 1;
        gs.player1.isDead = true;
        gs.player2.wins -= 1;
        gs.player2.isDead = true;
        gs.reasonForEnd = "Peace is not an option!";
    }
    else if(gs.state == "ticktock"){
        var player = getPlayerById(id);
        console.log("Player missfired: " + player.name);
        if(player.id == gs.player1.id)
            gs.player2.wins += 1;
        else
            gs.player1.wins += 1;
        player.missfire +=1;
        player.isDead = true;
        gs.reasonForEnd = player.name + " missfired!";
        
    }
    else if(gs.state == "draw"){
        if(gs.player1.id == id){
            console.log( gs.player1.name + " shot " + gs.player2.name) + " dead!";
            gs.player1.wins += 1;
            gs.player1.lastDraw = timeToShoot;
            if(timeToShoot < parseInt(gs.player1.fastestDraw))
                gs.player1.fastestDraw = timeToShoot;
            gs.player2.isDead = true;
            gs.reasonForEnd = gs.player1.name + " wins!";
        }
        else if(gs.player2.id == id){
            console.log( gs.player2.name + " shot " + gs.player1.name) + " dead!";
            gs.player2.wins += 1;
            gs.player2.lastDraw = timeToShoot;
            if(timeToShoot <  parseInt(gs.player2.fastestDraw))
                gs.player2.fastestDraw = timeToShoot;
            gs.player1.isDead = true;
            gs.reasonForEnd = gs.player2.name + " wins!";
        }
    }

    gs.state = "flashed";
    wss.clients.forEach((client) => { //Immediately send the flashed state to the clients
        if (client.readyState === WebSocket.OPEN)
            client.send(JSON.stringify(gs));
    });
    createTimeout(function() {
        gs.state = "gameover";
        //BOTH Players can die if peace was chosen
        if(gs.player1 && gs.player1.isDead){
            gs.player1.isDead = false;
            gs.playerQueue.push(gs.player1);
            gs.player1 = undefined;
        }
        if(gs.player2 && gs.player2.isDead){
            gs.player2.isDead = false;
            gs.playerQueue.push(gs.player2);
            gs.player2 = undefined;
        } 
        createTimeout(function() {
            gs.state = "resetting";// This state is temporary so we can show game over and players for a while before moving on
            createTimeout(function() {
                gs.state = "waiting";
                checkForGameStart();
            },4200); //Short delay before attempting to immediately queue in next player...
        },5200);//x seconds after displaying game over message,,reset
    },3300); //x seconds after gunshot, show gameover
    
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

function createTimeout(fn, delay) {
    let timeoutId = setTimeout(fn, delay);
    timeouts.push(timeoutId);
}

//This is really only called if player1 or player2 disconnects at any time to preserver the proper game state
function clearAllTimeouts() {
    for (let timeoutId of timeouts) {
        clearTimeout(timeoutId);
    }
    timeouts = [];
}

setInterval(function() {
    updatePlayTime();

    if(gs.state == "waiting")
        checkForGameStart();

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN)
            client.send(JSON.stringify(gs));
    });
}, 50);