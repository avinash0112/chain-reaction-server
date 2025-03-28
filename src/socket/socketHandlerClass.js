const { Server } = require("socket.io");
const Session = require("../services/Session");

const sessions = {}; // Stores active sessions
const connectedUsers = new Set();

const setupSocket = (server) => {
  const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket) => {
    console.log(`🔗 User connected: ${socket.id}`);
    connectedUsers.add(socket.id);
    io.emit("userCount", connectedUsers.size);

    socket.on("createSession", (sessionName) => {
      if (sessions[sessionName]) {
        socket.emit("error", "Session name already exists.");
      } else {
        sessions[sessionName] = new Session(sessionName);
        sessions[sessionName].addPlayer(socket.id);
        socket.join(sessionName);
        socket.emit("sessionCreated", sessionName);
      }
    });

    socket.on("joinSession", (sessionName) => {
      if (sessions[sessionName]) {
        sessions[sessionName].addPlayer(socket.id);
        socket.join(sessionName);
        io.to(sessionName).emit("playerJoined", sessions[sessionName].players);
      } else {
        socket.emit("error", "Session not found.");
      }
    });

    socket.on("cellClicked", (sessionName, row, col) => {
      if (sessions[sessionName]) {
        sessions[sessionName].game.handleMove(row, col, "P1", io);
        io.to(sessionName).emit(
          "gameUpdateByOther",
          sessions[sessionName].game.board
        );
      }
    });

    socket.on("leaveSession", (sessionName) => {
      if (sessions[sessionName]) {
        sessions[sessionName].removePlayer(socket.id);
        socket.leave(sessionName);
        io.to(sessionName).emit("playerLeft", sessions[sessionName].players);
        if (sessions[sessionName].isEmpty()) {
          delete sessions[sessionName];
        }
      }
    });

    socket.on("disconnect", () => {
      connectedUsers.delete(socket.id);
      io.emit("userCount", connectedUsers.size);

      for (const sessionName in sessions) {
        sessions[sessionName].removePlayer(socket.id);
        io.to(sessionName).emit("playerLeft", sessions[sessionName].players);
        if (sessions[sessionName].isEmpty()) {
          delete sessions[sessionName];
        }
      }
    });
  });
};

module.exports = { setupSocket };
