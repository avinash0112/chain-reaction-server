const { Server } = require("socket.io");
const {
  handleGameStateUpdate,
  getInitialGameBoardState,
} = require("../services/gameService.js");

const sessions = {}; // Game sessions
const connectedUsers = [];
const GRID_SIZE = 6;
const PLAYER_COUNT = 2;
let index = 0;

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
    if(!connectedUsers.includes(socket.id)) {
       connectedUsers.push(socket.id);
    }
    io.emit("userCount", connectedUsers.length);
    io.emit("activePlayer", connectedUsers[0]);

    socket.emit("initialGameState", gameState);

    socket.on("cellClicked", (r, c) => {
      gameState = handleGameStateUpdate(gameState, io, r, c);
      io.emit("gameUpdateByOther", gameState);
      index++
      io.emit("activePlayer", connectedUsers[index % PLAYER_COUNT]);
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
      connectedUsers.splice(connectedUsers.indexOf(socket.id),1);
      io.emit("userCount", connectedUsers.length);
      console.log(`❌ User disconnected: ${socket.id}`);

      for (const sessionName in sessions) {
        sessions[sessionName].players = sessions[sessionName].players.filter(
          (id) => id !== socket.id
        );
        io.to(sessionName).emit("playerLeft", sessions[sessionName].players);
      }

      if (connectedUsers.length > 0) {
        // Set the next player as the active player
        const newActivePlayerIndex = index % connectedUsers.length;
        io.emit("activePlayer", connectedUsers[newActivePlayerIndex]);
      }
    });
  });
};

module.exports = { setupSocket };
