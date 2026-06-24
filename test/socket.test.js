// Must be set BEFORE requiring the server modules (read once at load time).
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "SILENT";
process.env.TURN_DURATION_MS = "1000"; // short turn so the skip test is quick
process.env.FRAME_DELAY_MS = "10"; // stream cascades fast

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { io: ioClient } = require("socket.io-client");
const { setupSocket } = require("../src/socket/socketHandler");

let server;
let io;
let url;

test.before(async () => {
  server = http.createServer();
  io = setupSocket(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (io) io.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

// Connect a fresh client and resolve once it's connected.
function connect() {
  return new Promise((resolve, reject) => {
    const c = ioClient(url, { forceNew: true, transports: ["websocket"] });
    c.on("connect", () => resolve(c));
    c.on("connect_error", reject);
  });
}

// Resolve with the first payload of `event`, or reject after `ms`.
function once(socket, event, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for "${event}"`)),
      ms
    );
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// Create a game; resolves with the connected host and the generated session id.
async function createGame(playerName) {
  const host = await connect();
  const created = once(host, "sessionCreated");
  host.emit("createSession", { playerName });
  const sessionId = await created;
  return { host, sessionId };
}

// Join an existing game; resolves with the client and its assigned label.
async function joinGame(sessionId, playerName) {
  const client = await connect();
  const assigned = once(client, "playerAssigned");
  client.emit("joinSession", { sessionId, playerName });
  const label = await assigned;
  return { client, label };
}

test("createSession generates an id, assigns P0, and returns initial state", async () => {
  const c = await connect();
  const created = once(c, "sessionCreated");
  const assigned = once(c, "playerAssigned");
  const initial = once(c, "initialGameState");
  const joined = once(c, "playerJoined");
  c.emit("createSession", { playerName: "Alice" });

  const sessionId = await created;
  assert.equal(typeof sessionId, "string");
  assert.ok(sessionId.length > 0, "a non-empty session id is generated");
  assert.equal(await assigned, "P0");
  const state = await initial;
  assert.ok(Array.isArray(state.grid));
  // The player list carries the chosen name alongside the label.
  assert.deepEqual(await joined, [{ label: "P0", name: "Alice" }]);
  c.disconnect();
});

test("a second player joins as P1 with their name and the timer starts", async () => {
  const { host, sessionId } = await createGame("Alice");
  const guest = await connect();
  const assigned = once(guest, "playerAssigned");
  const timer = once(guest, "turnTimer");
  const hostSeesJoin = once(host, "playerJoined");
  guest.emit("joinSession", { sessionId, playerName: "Bob" });

  assert.equal(await assigned, "P1");
  const players = await hostSeesJoin;
  assert.deepEqual(players, [
    { label: "P0", name: "Alice" },
    { label: "P1", name: "Bob" },
  ]);
  const t = await timer;
  assert.equal(t.currentTurn, "P0");
  assert.ok(t.duration > 0);
  host.disconnect();
  guest.disconnect();
});

test("joining a non-existent game returns an error", async () => {
  const c = await connect();
  const err = once(c, "error");
  c.emit("joinSession", { sessionId: "nope12", playerName: "X" });
  assert.match(await err, /not found/i);
  c.disconnect();
});

test("clicking out of turn returns an error", async () => {
  const { host, sessionId } = await createGame("Alice");
  const { client: guest } = await joinGame(sessionId, "Bob"); // P1

  const err = once(guest, "error");
  guest.emit("cellClicked", 0, 0); // not P1's turn
  assert.match(await err, /not your turn/i);
  host.disconnect();
  guest.disconnect();
});

test("a valid move updates the board and advances the turn", async () => {
  const { host, sessionId } = await createGame("Alice");
  const { client: guest } = await joinGame(sessionId, "Bob");

  const update = once(host, "gameUpdateByOther");
  host.emit("cellClicked", 2, 2); // P0's turn, simple placement
  const payload = await update;
  assert.ok(Array.isArray(payload.grid));
  assert.equal(payload.currentTurn, "P1", "turn advanced to P1");
  host.disconnect();
  guest.disconnect();
});

test("a turn that times out is auto-skipped", async () => {
  const { host, sessionId } = await createGame("Alice");
  const { client: guest } = await joinGame(sessionId, "Bob");

  // Nobody moves; the 1s turn should time out and skip P0.
  const skipped = once(host, "turnSkipped", 4000);
  const payload = await skipped;
  assert.equal(payload.skippedPlayer, "P0");
  assert.equal(payload.currentTurn, "P1");
  host.disconnect();
  guest.disconnect();
});

test("disconnecting a player notifies the room with the updated list", async () => {
  const { host, sessionId } = await createGame("Alice");
  const { client: guest } = await joinGame(sessionId, "Bob");

  const left = once(host, "playerLeft");
  guest.disconnect();
  const players = await left;
  assert.deepEqual(players, [{ label: "P0", name: "Alice" }]);
  host.disconnect();
});
