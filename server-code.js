// server.js - Snake Game Server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Create Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',  // In production, replace with your GitHub Pages URL
    methods: ['GET', 'POST']
  }
});

// Game Configuration
const config = {
  canvasWidth: 600,
  canvasHeight: 400,
  gridSize: 20,
  initialSnakeLength: 3,
  initialSpeed: 150,
  playerColors: [
    '#00ff00', '#0000ff', '#ffff00', '#ff00ff',
    '#00ffff', '#ff8000', '#8000ff', '#00ff80'
  ]
};

// Game State
let gameState = {
  isRunning: false,
  players: {},
  food: null,
  colorIndex: 0
};

// Generate random food position
function generateFood() {
  let foodX, foodY;
  let validPosition = false;
  
  while (!validPosition) {
    foodX = Math.floor(Math.random() * (config.canvasWidth / config.gridSize)) * config.gridSize;
    foodY = Math.floor(Math.random() * (config.canvasHeight / config.gridSize)) * config.gridSize;
    
    validPosition = true;
    
    // Check if food position collides with any snake
    for (const playerId in gameState.players) {
      const player = gameState.players[playerId];
      for (const segment of player.snake) {
        if (segment.x === foodX && segment.y === foodY) {
          validPosition = false;
          break;
        }
      }
      if (!validPosition) break;
    }
  }
  
  return { x: foodX, y: foodY };
}

// Initialize new snake
function initializeSnake() {
  // We'll give each player a random starting position
  const startX = Math.floor(Math.random() * (config.canvasWidth / config.gridSize / 2) + 5) * config.gridSize;
  const startY = Math.floor(Math.random() * (config.canvasHeight / config.gridSize / 2) + 5) * config.gridSize;
  
  // Create snake body segments
  const snake = [];
  for (let i = 0; i < config.initialSnakeLength; i++) {
    snake.push({ x: startX - i * config.gridSize, y: startY });
  }
  
  return snake;
}

// Socket.io Connection Handler
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  // Handle player joining
  socket.on('join', (data) => {
    const playerName = data.name.trim();
    if (!playerName) return;
    
    // Assign color
    const colorIndex = gameState.colorIndex % config.playerColors.length;
    gameState.colorIndex++;
    
    // Create player
    gameState.players[socket.id] = {
      id: socket.id,
      name: playerName,
      color: config.playerColors[colorIndex],
      score: 0,
      snake: initializeSnake(),
      direction: 'right'
    };
    
    // Determine if player is host (first player)
    const isHost = Object.keys(gameState.players).length === 1;
    
    // Send player joined event
    io.emit('player_joined', {
      players: gameState.players
    });
    
    // Send specific data to the connected player
    socket.emit('player_joined', {
      players: gameState.players,
      id: socket.id,
      isHost: isHost
    });
    
    console.log(`Player joined: ${playerName} (${socket.id}) - Host: ${isHost}`);
  });
  
  // Handle direction update
  socket.on('update_direction', (data) => {
    if (!gameState.isRunning || !gameState.players[socket.id]) return;
    
    const player = gameState.players[socket.id];
    const newDirection = data.direction;
    const currentDirection = player.direction;
    
    // Prevent opposite direction movement
    if ((newDirection === 'up' && currentDirection === 'down') ||
        (newDirection === 'down' && currentDirection === 'up') ||
        (newDirection === 'left' && currentDirection === 'right') ||
        (newDirection === 'right' && currentDirection === 'left')) {
      return;
    }
    
    player.direction = newDirection;
  });
  
  // Handle game start
  socket.on('start_game', () => {
    if (gameState.isRunning) return;
    
    gameState.isRunning = true;
    gameState.food = generateFood();
    
    // Send game started event
    io.emit('game_started', {
      food: gameState.food
    });
    
    console.log('Game started');
  });
  
  // Handle game restart
  socket.on('restart_game', () => {
    if (!gameState.isRunning) return;
    
    // Reset player scores and positions
    for (const playerId in gameState.players) {
      const player = gameState.players[playerId];
      player.snake = initializeSnake();
      player.direction = 'right';
      player.score = 0;
    }
    
    // Generate new food
    gameState.food = generateFood();
    
    // Send game restarted event
    io.emit('game_restarted', {
      players: gameState.players,
      food: gameState.food
    });
    
    console.log('Game restarted');
  });
  
  // Handle player disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    
    // Remove player from game
    if (gameState.players[socket.id]) {
      delete gameState.players[socket.id];
      
      // Determine new host if there are still players
      const players = Object.keys(gameState.players);
      if (players.length > 0) {
        const newHostId = players[0];
        io.to(newHostId).emit('host_assigned');
      }
      
      // Send updated players list
      io.emit('player_left', {
        players: gameState.players
      });
    }
    
    // Stop game if no players left
    if (Object.keys(gameState.players).length === 0) {
      gameState.isRunning = false;
      gameState.colorIndex = 0;
      console.log('Game stopped: no players remaining');
    }
  });
});

// Game loop
function gameLoop() {
  if (!gameState.isRunning || Object.keys(gameState.players).length === 0) {
    return;
  }
  
  // Update all snakes
  for (const playerId in gameState.players) {
    const player = gameState.players[playerId];
    const head = { ...player.snake[0] };
    
    // Move snake based on direction
    switch (player.direction) {
      case 'up': head.y -= config.gridSize; break;
      case 'down': head.y += config.gridSize; break;
      case 'left': head.x -= config.gridSize; break;
      case 'right': head.x += config.gridSize; break;
    }
    
    // Check if snake collides with walls
    if (head.x < 0 || head.x >= config.canvasWidth || 
        head.y < 0 || head.y >= config.canvasHeight) {
      resetPlayer(playerId);
      continue;
    }
    
    // Check if snake collides with itself or other snakes
    let collision = false;
    for (const otherPlayerId in gameState.players) {
      const otherPlayer = gameState.players[otherPlayerId];
      for (let i = (otherPlayerId === playerId ? 1 : 0); i < otherPlayer.snake.length; i++) {
        if (head.x === otherPlayer.snake[i].x && head.y === otherPlayer.snake[i].y) {
          collision = true;
          break;
        }
      }
      if (collision) break;
    }
    
    if (collision) {
      resetPlayer(playerId);
      continue;
    }
    
    // Check if snake eats food
    if (head.x === gameState.food.x && head.y === gameState.food.y) {
      // Increase score
      player.score += 10;
      
      // Generate new food
      gameState.food = generateFood();
      
      // Trigger food collected event
      io.emit('food_collected', {
        food: gameState.food,
        players: gameState.players
      });
    } else {
      // Remove tail
      player.snake.pop();
    }
    
    // Add new head
    player.snake.unshift(head);
  }
  
  // Send game state update
  io.emit('game_updated', {
    players: gameState.players,
    food: gameState.food
  });
}

// Reset player after collision
function resetPlayer(playerId) {
  const player = gameState.players[playerId];
  player.snake = initializeSnake();
  player.direction = 'right';
  player.score = Math.max(0, player.score - 5); // Penalty for dying
}

// Start game loop
setInterval(gameLoop, 150);

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
