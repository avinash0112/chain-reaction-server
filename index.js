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

const connectedUsers = new Set();
const GRID_SIZE = 6;
const PLAYER_ORDER = ["P1", "P2"];

const sessions = {}; // sessionName -> session state (see createSessionState)
const socketSessions = {}; // socket.id -> sessionName, so we know which board a click belongs to

function createEmptyGrid(size) {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ count: 0, player: null }))
  );
}

function createSessionState() {
  return {
    players: {}, // socket.id -> "P1" | "P2"
    gameState: createEmptyGrid(GRID_SIZE),
    currentTurn: "P1",
    moveCount: 0,
    gameOver: false,
  };
}

function assignPlayerSlot(session, socketId) {
  const taken = Object.values(session.players);
  const freeSlot = PLAYER_ORDER.find((p) => !taken.includes(p));
  if (freeSlot) {
    session.players[socketId] = freeSlot;
  }
  return freeSlot || null; // null means this socket is a spectator
}

function broadcastSessionState(sessionName, session) {
  io.to(sessionName).emit("gameUpdateByOther", {
    grid: session.gameState,
    currentTurn: session.currentTurn,
  });
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  connectedUsers.add(socket.id);
  io.emit("userCount", connectedUsers.size);

  socket.on("cellClicked", (r, c) => {
    const sessionName = socketSessions[socket.id];
    const session = sessions[sessionName];

    if (!session) {
      socket.emit("error", "Join or create a session before playing.");
      return;
    }
    if (session.gameOver) {
      socket.emit("error", "The game has already ended.");
      return;
    }

    const player = session.players[socket.id];
    if (!player) {
      socket.emit("error", "Spectators cannot make moves.");
      return;
    }
    if (player !== session.currentTurn) {
      socket.emit("error", "It's not your turn.");
      return;
    }
    if (!isValidMove(session.gameState, r, c, player, GRID_SIZE)) {
      socket.emit("error", "Invalid move.");
      return;
    }

    session.gameState = handleGameStateUpdate(
      session.gameState,
      r,
      c,
      player,
      GRID_SIZE
    );
    session.moveCount += 1;

    const winner = checkWinner(session.gameState, session.moveCount);
    if (winner) {
      session.gameOver = true;
      broadcastSessionState(sessionName, session);
      io.to(sessionName).emit("gameOver", { winner });
      return;
    }

    session.currentTurn = session.currentTurn === "P1" ? "P2" : "P1";
    broadcastSessionState(sessionName, session);
  });

  // Handle restarting the game (fresh board, same players/slots, new game)
  socket.on("restartGame", () => {
    const sessionName = socketSessions[socket.id];
    const session = sessions[sessionName];

    if (!session) {
      socket.emit("error", "Join or create a session first.");
      return;
    }

    const player = session.players[socket.id];
    if (!player) {
      socket.emit("error", "Spectators cannot restart the game.");
      return;
    }

    session.gameState = createEmptyGrid(GRID_SIZE);
    session.currentTurn = "P1";
    session.moveCount = 0;
    session.gameOver = false;

    io.to(sessionName).emit("gameRestarted", {
      grid: session.gameState,
      currentTurn: session.currentTurn,
    });
    console.log(`Session ${sessionName} restarted by ${socket.id}`);
  });

  // Handle creating a new session
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

    const session = createSessionState();
    sessions[sessionName] = session;
    socket.join(sessionName);
    socketSessions[socket.id] = sessionName;

    const myPlayer = assignPlayerSlot(session, socket.id);
    socket.emit("sessionCreated", sessionName);
    socket.emit("playerAssigned", myPlayer);
    socket.emit("initialGameState", {
      grid: session.gameState,
      currentTurn: session.currentTurn,
    });
    console.log(`Session created: ${sessionName}`);
  });

  // Handle joining a session
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

    const myPlayer = assignPlayerSlot(session, socket.id);
    socket.emit("playerAssigned", myPlayer); // null = spectator (P1 and P2 already taken)
    socket.emit("initialGameState", {
      grid: session.gameState,
      currentTurn: session.currentTurn,
    });
    io.to(sessionName).emit("playerJoined", Object.keys(session.players));
    console.log(`User ${socket.id} joined session ${sessionName}`);
  });

  // Handle leaving a session
  socket.on("leaveSession", (sessionName) => {
    const session = sessions[sessionName];
    if (!session) return;

    delete session.players[socket.id];
    socket.leave(sessionName);
    delete socketSessions[socket.id];

    io.to(sessionName).emit("playerLeft", Object.keys(session.players));
    console.log(`User ${socket.id} left session ${sessionName}`);

    if (Object.keys(session.players).length === 0) {
      delete sessions[sessionName];
      console.log(`Session removed (empty): ${sessionName}`);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    io.emit("userCount", connectedUsers.size);
    console.log(`User disconnected: ${socket.id}`);

    const sessionName = socketSessions[socket.id];
    delete socketSessions[socket.id];
    if (!sessionName) return;

    const session = sessions[sessionName];
    if (!session) return;

    delete session.players[socket.id];
    io.to(sessionName).emit("playerLeft", Object.keys(session.players));

    if (Object.keys(session.players).length === 0) {
      delete sessions[sessionName];
      console.log(`Session removed (empty): ${sessionName}`);
    }
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
