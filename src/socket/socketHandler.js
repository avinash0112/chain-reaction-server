const { Server } = require("socket.io");
const {
  handleGameStateUpdate,
  getInitialGameBoardState,
} = require("../services/gameService.js");

const sessions = {}; // Game sessions
const connectedUsers = new Set();
const GRID_SIZE = 6;

let gameState = getInitialGameBoardState(GRID_SIZE);

const setupSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log(`🔗 User connected: ${socket.id}`);
    connectedUsers.add(socket.id);
    io.emit("userCount", connectedUsers.size);

    socket.emit("initialGameState", gameState);

    socket.on("cellClicked", (r, c) => {
      gameState = handleGameStateUpdate(gameState, io, r, c);
      io.emit("gameUpdateByOther", gameState);
    });

    socket.on("createSession", (sessionName) => {
      if (sessions[sessionName]) {
        socket.emit("error", "Session name already exists.");
      } else {
        sessions[sessionName] = { players: [socket.id] };
        socket.join(sessionName);
        socket.emit("sessionCreated", sessionName);
        console.log(`🎮 Session created: ${sessionName}`);
      }
    });

    socket.on("joinSession", (sessionName) => {
      if (sessions[sessionName]) {
        sessions[sessionName].players.push(socket.id);
        socket.join(sessionName);
        io.to(sessionName).emit("playerJoined", sessions[sessionName].players);
        console.log(`👤 User ${socket.id} joined session ${sessionName}`);
      } else {
        socket.emit("error", "Session not found.");
      }
    });

    socket.on("leaveSession", (sessionName) => {
      if (sessions[sessionName]) {
        sessions[sessionName].players = sessions[sessionName].players.filter(
          (id) => id !== socket.id
        );
        socket.leave(sessionName);
        io.to(sessionName).emit("playerLeft", sessions[sessionName].players);
        console.log(`🚪 User ${socket.id} left session ${sessionName}`);
      }
    });

    socket.on("disconnect", () => {
      connectedUsers.delete(socket.id);
      io.emit("userCount", connectedUsers.size);
      console.log(`❌ User disconnected: ${socket.id}`);

      for (const sessionName in sessions) {
        sessions[sessionName].players = sessions[sessionName].players.filter(
          (id) => id !== socket.id
        );
        io.to(sessionName).emit("playerLeft", sessions[sessionName].players);
      }
    });
  });
};

module.exports = { setupSocket };
