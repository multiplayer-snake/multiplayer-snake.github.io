// server.js
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

// Create WebSocket server on port 8080
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  // Serve the HTML file for any HTTP request
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(require('fs').readFileSync('./index.html'));
  }
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ server });

// Game state
let players = {};
let foods = [];
let started = false;
let paused = false;
let gameInterval;
const gridSize = 35; // Must match client's tileCount
let adminConnected = false; // Track if admin is connected

// Player colors
const colors = [
  "#0f0",    // Green
  "#00f",    // Blue
  "#ff0",    // Yellow
  "#0ff",    // Cyan
  "#f0f",    // Magenta
  "#ff8800", // Orange
  "#8800ff", // Purple
  "#00ff88", // Mint
  "#ff0088"  // Pink
];

// Game settings
let gameSpeed = 100; // milliseconds per tick
const initialFoodCount = 5;
console.log('WebSocket Server started on port ' + PORT);

// Initialize foods
function initializeFoods() {
  foods = [];
  for (let i = 0; i < initialFoodCount; i++) {
    foods.push(spawnFood());
  }
}

// Create a new food item
function spawnFood() {
  return {
    x: Math.floor(Math.random() * gridSize),
    y: Math.floor(Math.random() * gridSize),
    color: '#f00'
  };
}

// Initialize a new player
function createPlayer(ws, name, isAdmin = false) {
  const playerId = uuidv4();
  const colorIndex = Object.keys(players).length % colors.length;

  players[playerId] = {
    id: playerId,
    ws: ws,
    name: name,
    color: isAdmin ? "#ffffff" : colors[colorIndex],
    snake: [{ 
      x: 5 + Math.floor(Math.random() * (gridSize - 10)), 
      y: 5 + Math.floor(Math.random() * (gridSize - 10)) 
    }],
    direction: { x: 0, y: 0 },
    score: 0,
    alive: true,
    isAdmin: isAdmin
  };

  if (isAdmin) {
    adminConnected = true;
  }

  return playerId;
}

// Send message to a specific client
function sendToClient(ws, message) {
  try {
    ws.send(JSON.stringify(message));
  } catch (error) {
    console.error('Error sending to client:', error);
  }
}

// Send message to all connected clients
function broadcast(message, excludeId = null) {
  const msg = JSON.stringify(message);
  for (const pid in players) {
    if (excludeId && pid === excludeId) continue;
    try {
      players[pid].ws.send(msg);
    } catch (error) {
      console.error(`Error broadcasting to player ${pid}:`, error);
    }
  }
}

// Get game state without WebSocket objects (for sending to clients)
function getClientGameState() {
  const clientPlayers = {};

  for (const playerId in players) {
    const player = players[playerId];
    clientPlayers[playerId] = {
      id: player.id,
      name: player.name,
      color: player.color,
      snake: player.snake,
      score: player.score,
      alive: player.alive,
      isAdmin: player.isAdmin  // Include admin status in client state
    };
  }

  return {
    type: "game_state",
    players: clientPlayers,
    foods: foods,
    started: started,
    paused: paused
  };
}

// Update game logic
function updateGame() {
  if (!started || paused) return;

  // Move each snake
  for (const playerId in players) {
    const player = players[playerId];
    if (!player.alive) continue;

    // Skip if snake isn't moving
    if (player.direction.x === 0 && player.direction.y === 0) continue;

    // Calculate new head position
    const head = player.snake[0];
    const newHead = {
      x: head.x + player.direction.x,
      y: head.y + player.direction.y
    };

    // Check for wall collision before moving
    if (
      newHead.x < 0 || newHead.x >= gridSize ||
      newHead.y < 0 || newHead.y >= gridSize
    ) {
      playerDied(playerId);
      player.direction = { x: 0, y: 0 }; // Stop movement after death
      continue;
    }

    // Check for self collision
    if (player.snake.some(segment => segment.x === newHead.x && segment.y === newHead.y)) {
      playerDied(playerId);
      continue;
    }

    // Check for collision with other snakes
    let collisionWithOther = false;
    for (const otherId in players) {
      if (otherId === playerId) continue;
      const other = players[otherId];
      if (!other || !other.alive) continue;

      if (other.snake.some(segment => segment.x === newHead.x && segment.y === newHead.y)) {
        collisionWithOther = true;
        break;
      }
    }

    if (collisionWithOther) {
      playerDied(playerId);
      continue;
    }

    // Move snake
    player.snake.unshift(newHead);

    // Check for food collision
    const foodIndex = foods.findIndex(food => food.x === newHead.x && food.y === newHead.y);
    if (foodIndex !== -1) {
      // Eat food
      foods.splice(foodIndex, 1);
      player.score += 10;  // 10 points for eating food

      // Add new food
      foods.push(spawnFood());
    } else {
      // Remove tail if no food was eaten
      player.snake.pop();
    }
  }

  // Send updated game state to all clients
  broadcast(getClientGameState());
}

// Handle player death
function playerDied(playerId) {
  const player = players[playerId];
  if (!player) return;

  player.alive = false;
  player.score = Math.max(0, player.score - 5);  // -5 points for dying, minimum 0

  // Notify all clients
  broadcast({
    type: "player_died",
    playerId: playerId
  });

  // After a short delay, respawn if game is still going
  setTimeout(() => {
    if (!players[playerId]) return; // Player may have disconnected

    player.snake = [{ 
      x: 5 + Math.floor(Math.random() * (gridSize - 10)), 
      y: 5 + Math.floor(Math.random() * (gridSize - 10)) 
    }];
    player.direction = { x: 0, y: 0 };
    player.alive = true;

    // Notify player that they've respawned
    sendToClient(player.ws, {
      type: "you_respawned"
    });
  }, 3000);
}

// Find admin player id if any
function getAdminPlayerId() {
  for (const pid in players) {
    if (players[pid].isAdmin) {
      return pid;
    }
  }
  return null;
}

// Handle WebSocket connection
wss.on('connection', (ws) => {
  console.log('New client connected');
  let playerId = null;

  // Handle messages from client
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "admin_command":
          if (playerId && players[playerId] && players[playerId].isAdmin) {
            console.log("Admin command received:", message);
            switch (message.command) {
              case "kick_player":
                if (message.targetId && players[message.targetId]) {
                  console.log("Kicking player:", message.targetId);
                  sendToClient(players[message.targetId].ws, {
                    type: "kicked",
                    reason: "Kicked by admin"
                  });
                  players[message.targetId].ws.close();
                  delete players[message.targetId];
                  broadcast(getClientGameState());
                }
                break;
              case "set_speed":
                const newSpeed = Math.max(50, Math.min(200, parseInt(message.speed)));
                console.log("Setting game speed to:", newSpeed);
                clearInterval(gameInterval);
                gameSpeed = newSpeed;
                gameInterval = setInterval(updateGame, gameSpeed);
                broadcast({
                  type: "speed_changed",
                  speed: gameSpeed
                });
                break;
              case "reset_game":
                console.log("Resetting game");
                started = false;
                paused = false;
                initializeFoods();
                for (const pid in players) {
                  const player = players[pid];
                  player.score = 0;
                  player.snake = [{ 
                    x: 5 + Math.floor(Math.random() * (gridSize - 10)), 
                    y: 5 + Math.floor(Math.random() * (gridSize - 10)) 
                  }];
                  player.direction = { x: 0, y: 0 };
                  player.alive = true;
                }
                broadcast(getClientGameState());
                break;
            }
          } else {
            console.log("Non-admin tried to use admin command:", playerId);
          }
          break;

        case "join":
          // Check if "admin" name and password are used
          const isAdmin = message.name === "admin" && message.password === "admin123";

          // If admin is already connected, reject new admin attempts
          if (isAdmin && adminConnected) {
            sendToClient(ws, {
              type: "error",
              message: "Admin is already connected"
            });
            return;
          }

          // Create new player
          playerId = createPlayer(ws, message.name || "Player", isAdmin);
          console.log(`Player ${playerId} (${message.name}) joined${isAdmin ? " as ADMIN" : ""}`);

          // Send player their ID and current game state
          sendToClient(ws, {
            type: "you_joined",
            playerId: playerId,
            isAdmin: players[playerId].isAdmin,
            players: getClientGameState().players,
            foods: foods,
            started: started,
            paused: paused,
            speed: gameSpeed
          });

          // Notify other players of new player
          broadcast({
            type: "player_joined",
            playerId: playerId,
            name: players[playerId].name,
            color: players[playerId].color,
            snake: players[playerId].snake,
            score: players[playerId].score,
            isAdmin: players[playerId].isAdmin
          }, playerId);

          // Start game interval if it's not running
          if (!gameInterval) {
            gameInterval = setInterval(updateGame, gameSpeed);
          }
          break;

        case "start":
          // Only admin can start the game
          if (playerId && players[playerId] && players[playerId].isAdmin) {
            if (!started) {
              started = true;
              paused = false;
              initializeFoods();
              broadcast({
                type: "game_started"
              });
              console.log("Game started by admin");
            }
          } else {
            sendToClient(ws, {
              type: "error",
              message: "Only admin can start the game"
            });
          }
          break;

        case "toggle_pause":
          // Only admin can pause/resume the game
          if (playerId && players[playerId] && players[playerId].isAdmin) {
            paused = !paused;
            broadcast({
              type: "game_paused",
              paused: paused
            });
            console.log(`Game ${paused ? "paused" : "resumed"} by admin`);
          } else {
            sendToClient(ws, {
              type: "error",
              message: "Only admin can pause/resume the game"
            });
          }
          break;

        case "direction":
          if (!playerId || !players[playerId]) return;

          // Update player direction
          const directions = {
            "up": { x: 0, y: -1 },
            "down": { x: 0, y: 1 },
            "left": { x: -1, y: 0 },
            "right": { x: 1, y: 0 }
          };

          const newDirection = directions[message.direction];
          if (newDirection) {
            const currentDirection = players[playerId].direction;

            // Prevent 180-degree turns
            if (
              !(newDirection.x === -currentDirection.x && newDirection.y === -currentDirection.y)
            ) {
              players[playerId].direction = newDirection;
            }
          }
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    if (playerId && players[playerId]) {
      const wasAdmin = players[playerId].isAdmin;
      console.log(`Player ${playerId} disconnected${wasAdmin ? " (ADMIN)" : ""}`);

      // Notify other players
      broadcast({
        type: "player_left",
        playerId: playerId
      });

      // Remove player
      delete players[playerId];

      // If admin left, update adminConnected flag
      if (wasAdmin) {
        adminConnected = false;
      }

      // If no players left, clear game interval
      if (Object.keys(players).length === 0) {
        clearInterval(gameInterval);
        gameInterval = null;
        started = false;
        paused = false;
        console.log("Game stopped - no players left");
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Initialize game
initializeFoods();
