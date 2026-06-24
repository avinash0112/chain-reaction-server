process.env.LOG_LEVEL = process.env.LOG_LEVEL || "SILENT";

const test = require("node:test");
const assert = require("node:assert/strict");
const Session = require("../src/services/Session");

test("assigns compact labels P0, P1, ... and caps at 4 players", () => {
  const s = new Session("labels", 6);
  assert.equal(s.addPlayer("a"), true);
  assert.equal(s.addPlayer("b"), true);
  assert.equal(s.addPlayer("c"), true);
  assert.equal(s.addPlayer("d"), true);
  assert.equal(s.getPlayerLabel("a"), "P0");
  assert.equal(s.getPlayerLabel("d"), "P3");
  // Fifth player is a spectator.
  assert.equal(s.addPlayer("e"), false);
  assert.equal(s.getPlayerLabel("e"), null);
  assert.equal(s.getActivePlayerCount(), 4);
});

test("getPlayers returns labels with display names; missing name falls back to label", () => {
  const s = new Session("names", 6);
  s.addPlayer("a", "Alice");
  s.addPlayer("b", "  Bob  "); // trimmed
  s.addPlayer("c"); // no name -> falls back to label
  assert.deepEqual(s.getPlayers(), [
    { label: "P0", name: "Alice" },
    { label: "P1", name: "Bob" },
    { label: "P2", name: "P2" },
  ]);
});

test("labels stay stable when a middle player leaves", () => {
  const s = new Session("stable", 6);
  s.addPlayer("a"); // P0
  s.addPlayer("b"); // P1
  s.addPlayer("c"); // P2
  s.removePlayer("b");
  assert.equal(s.getPlayerLabel("a"), "P0", "unchanged");
  assert.equal(s.getPlayerLabel("c"), "P2", "NOT shifted down");
  // The freed P1 slot is reused by the next joiner.
  s.addPlayer("d");
  assert.equal(s.getPlayerLabel("d"), "P1");
});

test("turn rotation cycles through active players", () => {
  const s = new Session("turns", 6);
  s.addPlayer("a"); // P0
  s.addPlayer("b"); // P1
  assert.equal(s.getCurrentPlayerName(), "P0");
  assert.equal(s.isCurrentPlayerTurn("a"), true);
  assert.equal(s.isCurrentPlayerTurn("b"), false);
  s.updatePlayerTurn();
  assert.equal(s.getCurrentPlayerName(), "P1");
  s.updatePlayerTurn();
  assert.equal(s.getCurrentPlayerName(), "P0", "wraps around");
});

test("removing the current player keeps the turn pointer valid", () => {
  const s = new Session("ptr", 6);
  s.addPlayer("a"); // P0
  s.addPlayer("b"); // P1
  s.updatePlayerTurn(); // now P1's turn
  s.removePlayer("b"); // remove current player
  assert.equal(s.getActivePlayerCount(), 1);
  assert.equal(s.getCurrentPlayerName(), "P0", "pointer clamped to a real player");
});

test("isPlayerInSession distinguishes players from spectators", () => {
  const s = new Session("members", 6);
  s.addPlayer("a");
  assert.equal(s.isPlayerInSession("a"), true);
  assert.equal(s.isPlayerInSession("ghost"), false);
});

test("reset starts a fresh game and resets the turn pointer", () => {
  const s = new Session("reset", 6);
  s.addPlayer("a");
  s.addPlayer("b");
  s.updatePlayerTurn();
  s.getGame().resolveMove(0, 0, "P0");
  s.reset();
  assert.equal(s.getGame().moveCount, 0);
  assert.equal(s.getGame().gameOver, false);
  assert.equal(s.getCurrentPlayerName(), "P0");
  assert.equal(s.getGame().board[0][0].count, 0, "new empty board");
});
