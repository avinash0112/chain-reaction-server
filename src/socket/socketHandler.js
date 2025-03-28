const { Server } = require("socket.io");

const Game = require("../services/Game.js");
const Session = require("../services/Session.js");
const { addToTestSession } = require("./testSessionHandler.js");
const sessions = {}; // Game sessions
const connectedUsers = new Set();
const GRID_SIZE = 6;
const TEST_SESSION_NAME = "test";

// test session to keep one game instance running, to be removed.
const chainReactionSession = new Session(TEST_SESSION_NAME, GRID_SIZE);
sessions[TEST_SESSION_NAME] = chainReactionSession;
const chainReactionGame = chainReactionSession.getGame();
let gameState = chainReactionGame.board;

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

    // Added all the joining clients into the "test" session for development
    // process; should be removed.
    // *--------------------------------------------------------------*
    addToTestSession(
      chainReactionSession,
      socket,
      io,
      sessions,
      TEST_SESSION_NAME
    );
    // *--------------------------------------------------------------*
    socket.emit("initialGameState", gameState);

    if (chainReactionSession.isCurrentPlayerTurn(socket.id)) {
      socket.emit("yourTurn", true);
    }

    socket.on("cellClicked", (r, c) => {
      if (chainReactionSession.isCurrentPlayerTurn(socket.id)) {
        chainReactionGame.handleMove(
          r,
          c,
          chainReactionSession.getCurrentPlayerName(),
          io
        );
        io.emit("gameUpdateByOther", gameState);
        chainReactionSession.updatePlayerTurn();
        // io.to(chainReactionSession.getCurrentPlayer()).emit("yourTurn", true);
        // chainReactionSession.getExceptCurrentPlayer().forEach((p) => {
        //   if (chainReactionSession.getCurrentPlayer() !== p) {
        //     io.to(p).emit("yourTurn", false);
        //   }
        // });
      } else {
        // to be handled
      }
    });

    socket.on("createSession", (sessionName) => {
      if (sessions[sessionName]) {
        socket.emit("error", "Session name already exists.");
      } else {
        const session = new Session(sessionName, GRID_SIZE);
        session.addPlayer(socket.id);
        sessions[sessionName] = session;
        socket.join(sessionName);

        socket.emit("sessionCreated", sessionName);
        console.log(`🎮 Session created: ${sessionName}`);
      }
    });

    socket.on("joinSession", (sessionName) => {
      if (sessions[sessionName]) {
        sessions[sessionName].addPlayer(socket.id);
        socket.join(sessionName);

        io.to(sessionName).emit("playerJoined", sessions[sessionName].players);
        console.log(`👤 User ${socket.id} joined session ${sessionName}`);
      } else {
        socket.emit("error", "Session not found.");
      }
    });

    socket.on("leaveSession", (sessionName) => {
      if (sessions[sessionName]) {
        sessions[sessionName].removePlayer(socket.id);
        socket.leave(sessionName);
        // io.to(sessionName)
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
        socket.leave(sessionName);
        // io.to(sessionName).
        io.to(sessionName).emit("playerLeft", sessions[sessionName].players);
      }
    });
  });
};

module.exports = { setupSocket };
