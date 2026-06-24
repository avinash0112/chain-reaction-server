const { Server } = require("socket.io");
const Session = require("../services/Session.js");
const { createLogger } = require("../utils/logger");

const log = createLogger("socket");

const sessions = {}; // sessionName -> Session instance
const socketSessions = {}; // socket.id -> sessionName, so cellClicked knows which board to use
const GRID_SIZE = 6;
const MAX_NAME_LENGTH = 20;
// Per-turn countdown. Configurable via env so tests can use a short turn
// instead of waiting the full 30 seconds for a timeout/skip.
const TURN_DURATION_MS = Number(process.env.TURN_DURATION_MS) || 30 * 1000;

// Short, URL-friendly, collision-free room id for shareable links.
function generateSessionId() {
  let id;
  do {
    id = Math.random().toString(36).slice(2, 8); // 6 base36 chars
  } while (sessions[id]);
  return id;
}

// Trim and cap a user-supplied display name; "" lets Session fall back to label.
function cleanName(raw) {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_NAME_LENGTH) : "";
}

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

  // sessionName -> Node.js Timeout handle
  const sessionTimers = {};

  function startTurnTimer(sessionName) {
    clearTurnTimer(sessionName);
    const session = sessions[sessionName];
    if (!session || session.getGame().gameOver || session.getActivePlayerCount() < 2) return;

    const currentTurn = session.getCurrentPlayerName();
    log.debug(`Timer started for ${sessionName}`, {
      currentTurn,
      durationMs: TURN_DURATION_MS,
    });
    io.to(sessionName).emit("turnTimer", {
      currentTurn,
      duration: TURN_DURATION_MS,
    });

    sessionTimers[sessionName] = setTimeout(() => {
      const s = sessions[sessionName];
      if (!s || s.getGame().gameOver) return;

      const skippedPlayer = s.getCurrentPlayerName();
      s.updatePlayerTurn();
      log.info(`Turn timed out in ${sessionName}: ${skippedPlayer} skipped`, {
        nextTurn: s.getCurrentPlayerName(),
      });

      io.to(sessionName).emit("turnSkipped", {
        skippedPlayer,
        currentTurn: s.getCurrentPlayerName(),
      });

      startTurnTimer(sessionName);
    }, TURN_DURATION_MS);
  }

  function clearTurnTimer(sessionName) {
    if (sessionTimers[sessionName]) {
      clearTimeout(sessionTimers[sessionName]);
      delete sessionTimers[sessionName];
      log.debug(`Timer cleared for ${sessionName}`);
    }
  }

  io.on("connection", (socket) => {
    log.info(`User connected: ${socket.id}`);

    socket.on("cellClicked", (r, c) => {
      const sessionName = socketSessions[socket.id];
      const session = sessions[sessionName];
      if (!session) {
        log.warn(`cellClicked with no session`, { socket: socket.id });
        socket.emit("error", "Join or create a session before playing.");
        return;
      }

      const game = session.getGame();
      if (game.gameOver) {
        log.debug(`cellClicked after game over in ${sessionName}`, { socket: socket.id });
        socket.emit("error", "The game has already ended.");
        return;
      }
      if (!session.isCurrentPlayerTurn(socket.id)) {
        log.debug(`Out-of-turn click in ${sessionName}`, {
          socket: socket.id,
          expected: session.getCurrentPlayerName(),
        });
        socket.emit("error", "It's not your turn.");
        return;
      }

      // Freeze the countdown while the move is being processed and animated.
      clearTurnTimer(sessionName);
      io.to(sessionName).emit("turnPaused");

      const player = session.getCurrentPlayerName();
      log.info(`Move in ${sessionName}: ${player} clicked (${r},${c})`);
      const applied = game.handleMove(
        r,
        c,
        player,
        io,
        () => ({ currentTurn: session.getCurrentPlayerName() }),
        ({ truncated }) => {
          if (truncated) {
            log.error(`Move voided in ${sessionName} (cascade truncated)`, {
              player,
              cell: [r, c],
            });
            socket.emit(
              "error",
              "That move caused an unresolvable chain reaction and was voided."
            );
            io.to(sessionName).emit("gameUpdateByOther", {
              grid: game.board,
              currentTurn: session.getCurrentPlayerName(),
            });
            // Move was voided — restart timer for the same player.
            startTurnTimer(sessionName);
            return;
          }

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
            log.info(`Game over in ${sessionName} — winner: ${winner}`);
            io.to(sessionName).emit("gameOver", { winner });
          } else {
            startTurnTimer(sessionName);
          }
        }
      );

      if (!applied) {
        log.warn(`Move not applied in ${sessionName}`, {
          player,
          cell: [r, c],
        });
        socket.emit("error", "Invalid move.");
      }
    });

    socket.on("restartGame", () => {
      const sessionName = socketSessions[socket.id];
      const session = sessions[sessionName];

      if (!session) {
        socket.emit("error", "Join or create a session first.");
        return;
      }

      if (!session.isPlayerInSession(socket.id)) {
        socket.emit("error", "Spectators cannot restart the game.");
        return;
      }

      session.reset();
      clearTurnTimer(sessionName);
      io.to(sessionName).emit("gameRestarted", {
        grid: session.getGame().board,
        currentTurn: session.getCurrentPlayerName(),
      });
      startTurnTimer(sessionName);
      log.info(`Session ${sessionName} restarted by ${socket.id}`);
    });

    // Create a brand-new room with an auto-generated id (for shareable links).
    // Payload: { playerName }.
    socket.on("createSession", (payload = {}) => {
      if (socketSessions[socket.id]) {
        socket.emit(
          "error",
          "Leave your current session before creating another."
        );
        return;
      }

      const playerName = cleanName(payload && payload.playerName);
      const sessionName = generateSessionId();
      const session = new Session(sessionName, GRID_SIZE);
      sessions[sessionName] = session;
      socket.join(sessionName);
      socketSessions[socket.id] = sessionName;

      const added = session.addPlayer(socket.id, playerName);
      const myPlayer = added ? session.getPlayerLabel(socket.id) : null;

      socket.emit("sessionCreated", sessionName);
      socket.emit("playerAssigned", myPlayer); // null = spectator
      socket.emit("initialGameState", {
        grid: session.getGame().board,
        currentTurn: session.getCurrentPlayerName(),
      });
      io.to(sessionName).emit("playerJoined", session.getPlayers());
      log.info(`Session created: ${sessionName}`, {
        by: socket.id,
        assigned: myPlayer ?? "spectator",
      });
    });

    // Join an existing room (e.g. from a shareable link).
    // Payload: { sessionId, playerName }.
    socket.on("joinSession", (payload = {}) => {
      if (socketSessions[socket.id]) {
        socket.emit(
          "error",
          "Leave your current session before joining another."
        );
        return;
      }

      const sessionName =
        typeof payload === "string" ? payload : payload && payload.sessionId;
      const playerName = cleanName(payload && payload.playerName);

      const session = sessions[sessionName];
      if (!session) {
        socket.emit("error", "Game not found — check the link or code.");
        return;
      }

      socket.join(sessionName);
      socketSessions[socket.id] = sessionName;

      const added = session.addPlayer(socket.id, playerName);
      const myPlayer = added ? session.getPlayerLabel(socket.id) : null;

      socket.emit("sessionJoined", sessionName);
      socket.emit("playerAssigned", myPlayer); // null = spectator (session full)
      socket.emit("initialGameState", {
        grid: session.getGame().board,
        currentTurn: session.getCurrentPlayerName(),
      });
      io.to(sessionName).emit("playerJoined", session.getPlayers());
      // Start the countdown when the second player arrives (game is now playable).
      if (session.getActivePlayerCount() === 2 && !session.getGame().gameOver) {
        startTurnTimer(sessionName);
      }
      log.info(`User ${socket.id} joined session ${sessionName}`, {
        assigned: myPlayer ?? "spectator",
        activePlayers: session.getActivePlayerCount(),
      });
    });

    socket.on("leaveSession", (sessionName) => {
      const session = sessions[sessionName];
      if (!session) return;

      session.removePlayer(socket.id);
      socket.leave(sessionName);
      delete socketSessions[socket.id];

      io.to(sessionName).emit("playerLeft", session.getPlayers());
      log.info(`User ${socket.id} left session ${sessionName}`);

      if (session.isEmpty()) {
        clearTurnTimer(sessionName);
        delete sessions[sessionName];
        log.info(`Session removed (empty): ${sessionName}`);
      } else if (session.getActivePlayerCount() < 2) {
        clearTurnTimer(sessionName);
        io.to(sessionName).emit("turnPaused");
      } else {
        // Remaining ≥2 players — restart with a fresh countdown for whoever is now current.
        startTurnTimer(sessionName);
      }
    });

    socket.on("disconnect", () => {
      log.info(`User disconnected: ${socket.id}`);

      const sessionName = socketSessions[socket.id];
      delete socketSessions[socket.id];
      if (!sessionName) return;

      const session = sessions[sessionName];
      if (!session) return;

      session.removePlayer(socket.id);
      io.to(sessionName).emit("playerLeft", session.getPlayers());

      if (session.isEmpty()) {
        clearTurnTimer(sessionName);
        delete sessions[sessionName];
        log.info(`Session removed (empty): ${sessionName}`);
      } else if (session.getActivePlayerCount() < 2) {
        clearTurnTimer(sessionName);
        io.to(sessionName).emit("turnPaused");
      } else {
        startTurnTimer(sessionName);
      }
    });
  });

  // Returned so callers (e.g. tests) can close the Socket.IO server cleanly.
  return io;
};

module.exports = { setupSocket };
