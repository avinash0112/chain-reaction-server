const { Server } = require("socket.io");
const Session = require("../services/Session.js");

const sessions = {}; // sessionName -> Session instance
const socketSessions = {}; // socket.id -> sessionName, so cellClicked knows which board to use
const connectedUsers = new Set();
const GRID_SIZE = 6;

// FIX (test-session hijack): the old code force-enrolled every connecting
// socket into one shared global "test" session before they'd clicked
// anything, via addToTestSession(). That's removed entirely — sessions
// now only come from an explicit createSession/joinSession call, and
// cellClicked operates on whichever session a socket actually joined
// (tracked via socketSessions), instead of one hardcoded global game.

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

    socket.on("cellClicked", (r, c) => {
      const sessionName = socketSessions[socket.id];
      const session = sessions[sessionName];
      if (!session) {
        socket.emit("error", "Join or create a session before playing.");
        return;
      }

      const game = session.getGame();
      if (game.gameOver) {
        socket.emit("error", "The game has already ended.");
        return;
      }
      if (!session.isCurrentPlayerTurn(socket.id)) {
        socket.emit("error", "It's not your turn.");
        return;
      }

      const player = session.getCurrentPlayerName();
      const applied = game.handleMove(
        r,
        c,
        player,
        io,
        () => ({ currentTurn: session.getCurrentPlayerName() }),
        ({ truncated }) => {
          if (truncated) {
            socket.emit(
              "error",
              "That move caused an unresolvable chain reaction and was voided."
            );
            return;
          }

          // Runs once the full explosion cascade has settled — only then
          // is the board final enough to check for a winner or hand off
          // the turn.
          const winner = game.checkWinner(session.getActivePlayerCount());
          if (winner) {
            game.gameOver = true;
          } else {
            session.updatePlayerTurn();
          }

          io.to(sessionName).emit("gameUpdateByOther", {
            grid: game.board,
            currentTurn: session.getCurrentPlayerName(),
          });

          if (winner) {
            io.to(sessionName).emit("gameOver", { winner });
          }
        }
      );

      if (!applied) {
        socket.emit("error", "Invalid move.");
      }
    });

    socket.on("createSession", (sessionName) => {
      if (socketSessions[socket.id]) {
        socket.emit(
          "error",
          "Leave your current session before creating another."
        );
        return;
      }
      if (sessions[sessionName]) {
        socket.emit("error", "Session name already exists.");
        return;
      }

      const session = new Session(sessionName, GRID_SIZE);
      sessions[sessionName] = session;
      socket.join(sessionName);
      socketSessions[socket.id] = sessionName;

      const added = session.addPlayer(socket.id);
      const myPlayer = added ? session.getPlayerLabel(socket.id) : null;

      socket.emit("sessionCreated", sessionName);
      socket.emit("playerAssigned", myPlayer); // null = spectator
      socket.emit("initialGameState", {
        grid: session.getGame().board,
        currentTurn: session.getCurrentPlayerName(),
      });
      console.log(`🎮 Session created: ${sessionName}`);
    });

    socket.on("joinSession", (sessionName) => {
      if (socketSessions[socket.id]) {
        socket.emit(
          "error",
          "Leave your current session before joining another."
        );
        return;
      }

      const session = sessions[sessionName];
      if (!session) {
        socket.emit("error", "Session not found.");
        return;
      }

      socket.join(sessionName);
      socketSessions[socket.id] = sessionName;

      const added = session.addPlayer(socket.id);
      const myPlayer = added ? session.getPlayerLabel(socket.id) : null;

      socket.emit("sessionJoined", sessionName);
      socket.emit("playerAssigned", myPlayer); // null = spectator (session full)
      socket.emit("initialGameState", {
        grid: session.getGame().board,
        currentTurn: session.getCurrentPlayerName(),
      });
      io.to(sessionName).emit("playerJoined", session.getPlayerLabels());
      console.log(`👤 User ${socket.id} joined session ${sessionName}`);
    });

    socket.on("leaveSession", (sessionName) => {
      const session = sessions[sessionName];
      if (!session) return;

      session.removePlayer(socket.id);
      socket.leave(sessionName);
      delete socketSessions[socket.id];

      io.to(sessionName).emit("playerLeft", session.getPlayerLabels());
      console.log(`🚪 User ${socket.id} left session ${sessionName}`);

      if (session.isEmpty()) {
        delete sessions[sessionName];
        console.log(`🗑️ Session removed (empty): ${sessionName}`);
      }
    });

    socket.on("disconnect", () => {
      connectedUsers.delete(socket.id);
      io.emit("userCount", connectedUsers.size);
      console.log(`❌ User disconnected: ${socket.id}`);

      const sessionName = socketSessions[socket.id];
      delete socketSessions[socket.id];
      if (!sessionName) return;

      const session = sessions[sessionName];
      if (!session) return;

      session.removePlayer(socket.id);
      io.to(sessionName).emit("playerLeft", session.getPlayerLabels());

      if (session.isEmpty()) {
        delete sessions[sessionName];
        console.log(`🗑️ Session removed (empty): ${sessionName}`);
      }
    });
  });
};

module.exports = { setupSocket };
