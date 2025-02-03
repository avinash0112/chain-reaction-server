const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const app = express();
const server = http.createServer(app);
const { handleGameStateUpdate } = require("./utils");

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

let gameState = Array(GRID_SIZE)
  .fill()
  .map(() => Array(GRID_SIZE).fill({ count: 0, player: null }));

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  connectedUsers.add(socket.id);
  io.emit("userCount", connectedUsers.size);

  //send initial state of game when user conects
  socket.emit("initialGameState", gameState);

  socket.on("cellClicked", (r, c) => {
    const newState = handleGameStateUpdate(gameState, r, c);
    gameState = newState;
    io.emit("gameUpdateByOther", gameState);
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

    console.log("connectedUsers", connectedUsers);

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
