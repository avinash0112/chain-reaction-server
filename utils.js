const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const app = express();
const server = http.createServer(app);
const { handleGameStateUpdate, isValidMove, checkWinner } = require("./utils");

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

const sessions = {}; // Object to store game sessions
const connectedUsers = new Set();
const GRID_SIZE = 6;

function createEmptyGrid(size) {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ count: 0, player: null }))
  );
}

let gameState = createEmptyGrid(GRID_SIZE);

// Player-slot tracking: which two sockets are P1 / P2, and whose turn it is.
// (Single shared game for now — this becomes per-session in the next change.)
const players = {}; // socket.id -> "P1" | "P2"
const PLAYER_ORDER = ["P1", "P2"];
let currentTurn = "P1";
let moveCount = 0;
let gameOver = false;

function assignPlayerSlot(socketId) {
  const taken = Object.values(players);
  const freeSlot = PLAYER_ORDER.find((p) => !taken.includes(p));
  if (freeSlot) {
    players[socketId] = freeSlot;
  }
  return freeSlot || null; // null means this socket is a spectator
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  connectedUsers.add(socket.id);
  io.emit("userCount", connectedUsers.size);

  const myPlayer = assignPlayerSlot(socket.id);
  socket.emit("playerAssigned", myPlayer); // null = spectator (P1 and P2 already taken)

  //send initial state of game when user conects
  socket.emit("initialGameState", { grid: gameState, currentTurn });

  socket.on("cellClicked", (r, c) => {
    if (gameOver) {
      socket.emit("error", "The game has already ended.");
      return;
    }

    const player = players[socket.id];

    if (!player) {
      socket.emit("error", "Spectators cannot make moves.");
      return;
    }
    if (player !== currentTurn) {
      socket.emit("error", "It's not your turn.");
      return;
    }
    if (!isValidMove(gameState, r, c, player, GRID_SIZE)) {
      socket.emit("error", "Invalid move.");
      return;
    }

    gameState = handleGameStateUpdate(gameState, r, c, player, GRID_SIZE);
    moveCount += 1;

    const winner = checkWinner(gameState, moveCount);
    if (winner) {
      gameOver = true;
      io.emit("gameUpdateByOther", { grid: gameState, currentTurn });
      io.emit("gameOver", { winner });
      return;
    }

    currentTurn = currentTurn === "P1" ? "P2" : "P1";
    io.emit("gameUpdateByOther", { grid: gameState, currentTurn });
  });

  // Handle creating a new session
  socket.on("createSession", (sessionName) => {
    if (sessions[sessionName]) {
      socket.emit("error", "Session name already exists.");
    } else {
      sessions[sessionName] = { players: [socket.id] };
      socket.join(sessionName);
      socket.emit("sessionCreated", sessionName);
      console.log(`Session created: ${sessionName}`);
    }
  });

  // Handle joining a session
  socket.on("joinSession", (sessionName) => {
    if (sessions[sessionName]) {
      sessions[sessionName].players.push(socket.id);
      socket.join(sessionName);
      io.to(sessionName).emit("playerJoined", sessions[sessionName].players);
      console.log(`User ${socket.id} joined session ${sessionName}`);
    } else {
      socket.emit("error", "Session not found.");
    }
  });

  // Handle leaving a session
  socket.on("leaveSession", (sessionName) => {
    if (sessions[sessionName]) {
      sessions[sessionName].players = sessions[sessionName].players.filter(
        (id) => id !== socket.id
      );
      socket.leave(sessionName);
      io.to(sessionName).emit("playerLeft", sessions[sessionName].players);
      console.log(`User ${socket.id} left session ${sessionName}`);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    io.emit("userCount", connectedUsers.size);
    console.log(`User disconnected: ${socket.id}`);

    delete players[socket.id];

    for (const sessionName in sessions) {
      sessions[sessionName].players = sessions[sessionName].players.filter(
        (id) => id !== socket.id
      );
      io.to(sessionName).emit("playerLeft", sessions[sessionName].players);
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
