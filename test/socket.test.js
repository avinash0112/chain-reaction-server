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

// Create a session with one client; resolves once it's the host (P0).
async function hostSession(name) {
  const host = await connect();
  const created = once(host, "sessionCreated");
  host.emit("createSession", name);
  await created;
  return host;
}

// Join an existing session; resolves once assigned a label.
async function joinSession(name) {
  const client = await connect();
  const assigned = once(client, "playerAssigned");
  client.emit("joinSession", name);
  const label = await assigned;
  return { client, label };
}

test("createSession assigns P0 and returns the initial game state", async () => {
  const c = await connect();
  const created = once(c, "sessionCreated");
  const assigned = once(c, "playerAssigned");
  const initial = once(c, "initialGameState");
  c.emit("createSession", "room-create");

  assert.equal(await created, "room-create");
  assert.equal(await assigned, "P0");
  const state = await initial;
  assert.ok(Array.isArray(state.grid));
  assert.equal(state.currentTurn, "P0");
  c.disconnect();
});

test("second player joins as P1 and the turn timer starts", async () => {
  const host = await hostSession("room-join");
  const guest = await connect();
  const assigned = once(guest, "playerAssigned");
  const timer = once(guest, "turnTimer");
  guest.emit("joinSession", "room-join");

  assert.equal(await assigned, "P1");
  const t = await timer;
  assert.equal(t.currentTurn, "P0");
  assert.ok(t.duration > 0);
  host.disconnect();
  guest.disconnect();
});

test("clicking out of turn returns an error", async () => {
  const host = await hostSession("room-turn");
  const { client: guest } = await joinSession("room-turn"); // P1

  const err = once(guest, "error");
  guest.emit("cellClicked", 0, 0); // not P1's turn
  assert.match(await err, /not your turn/i);
  host.disconnect();
  guest.disconnect();
});

test("a valid move updates the board and advances the turn", async () => {
  const host = await hostSession("room-move");
  const { client: guest } = await joinSession("room-move");

  const update = once(host, "gameUpdateByOther");
  host.emit("cellClicked", 2, 2); // P0's turn, simple placement
  const payload = await update;
  assert.ok(Array.isArray(payload.grid));
  assert.equal(payload.currentTurn, "P1", "turn advanced to P1");
  host.disconnect();
  guest.disconnect();
});

test("a turn that times out is auto-skipped", async () => {
  const host = await hostSession("room-skip");
  const { client: guest } = await joinSession("room-skip");

  // Nobody moves; the 1s turn should time out and skip P0.
  const skipped = once(host, "turnSkipped", 4000);
  const payload = await skipped;
  assert.equal(payload.skippedPlayer, "P0");
  assert.equal(payload.currentTurn, "P1");
  host.disconnect();
  guest.disconnect();
});

test("disconnecting a player notifies the room", async () => {
  const host = await hostSession("room-dc");
  const { client: guest } = await joinSession("room-dc");

  const left = once(host, "playerLeft");
  guest.disconnect();
  const labels = await left;
  assert.deepEqual(labels, ["P0"]);
  host.disconnect();
});
