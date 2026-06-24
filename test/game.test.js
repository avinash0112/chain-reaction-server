// Keep test output clean unless the runner explicitly asks for logs.
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "SILENT";

const test = require("node:test");
const assert = require("node:assert/strict");
const Game = require("../src/services/Game");

// --- helpers ---------------------------------------------------------------
const totalOrbs = (board) =>
  board.flat().reduce((sum, cell) => sum + cell.count, 0);
const distinctOwners = (board) =>
  new Set(board.flat().filter((c) => c.player !== null).map((c) => c.player));

test("cell capacities: corner 2, edge 3, interior 4", () => {
  const g = new Game(6, "caps");
  assert.equal(g.getCellCapacity(0, 0), 2, "corner");
  assert.equal(g.getCellCapacity(5, 5), 2, "corner");
  assert.equal(g.getCellCapacity(0, 3), 3, "top edge");
  assert.equal(g.getCellCapacity(3, 0), 3, "left edge");
  assert.equal(g.getCellCapacity(2, 2), 4, "interior");
});

test("initial board is empty and unowned", () => {
  const g = new Game(6, "init");
  assert.equal(totalOrbs(g.board), 0);
  assert.equal(distinctOwners(g.board).size, 0);
});

test("isValidMove: own/empty allowed, opponent and out-of-bounds rejected", () => {
  const g = new Game(6, "valid");
  assert.equal(g.isValidMove(0, 0, "P0"), true, "empty cell");
  g.board[0][0].player = "P0";
  g.board[0][0].count = 1;
  assert.equal(g.isValidMove(0, 0, "P0"), true, "own cell");
  assert.equal(g.isValidMove(0, 0, "P1"), false, "opponent cell");
  assert.equal(g.isValidMove(-1, 0, "P0"), false, "out of bounds");
  assert.equal(g.isValidMove(0, 6, "P0"), false, "out of bounds");
});

test("placement increments count and assigns owner", () => {
  const g = new Game(6, "place");
  const res = g.resolveMove(2, 2, "P0");
  assert.equal(res.applied, true);
  assert.equal(res.frames.length, 0, "no explosion");
  assert.equal(g.board[2][2].count, 1);
  assert.equal(g.board[2][2].player, "P0");
});

test("resolveMove rejects moves once the game is over", () => {
  const g = new Game(6, "over");
  g.gameOver = true;
  assert.equal(g.resolveMove(0, 0, "P0").applied, false);
});

test("corner explosion empties the cell and feeds both neighbours", () => {
  const g = new Game(6, "corner");
  g.resolveMove(0, 0, "P0"); // count 1
  const res = g.resolveMove(0, 0, "P0"); // count 2 -> explodes
  assert.equal(res.explosions, 1);
  assert.equal(g.board[0][0].count, 0);
  assert.equal(g.board[0][0].player, null);
  assert.equal(g.board[0][1].count, 1);
  assert.equal(g.board[0][1].player, "P0");
  assert.equal(g.board[1][0].count, 1);
  assert.equal(g.board[1][0].player, "P0");
});

test("edge cell explodes at capacity 3", () => {
  const g = new Game(6, "edge");
  g.resolveMove(0, 2, "P0");
  g.resolveMove(0, 2, "P0");
  const res = g.resolveMove(0, 2, "P0"); // 3 -> explode
  assert.equal(res.explosions, 1);
  assert.equal(g.board[0][2].count, 0);
  // three neighbours: (0,1),(0,3),(1,2)
  assert.equal(g.board[0][1].count, 1);
  assert.equal(g.board[0][3].count, 1);
  assert.equal(g.board[1][2].count, 1);
});

test("explosion captures an opponent's cell", () => {
  const g = new Game(6, "capture");
  g.board[0][1] = { count: 1, player: "P1", capacity: 3 };
  g.moveCount = 4;
  g.resolveMove(0, 0, "P0"); // corner -> 1
  g.resolveMove(0, 0, "P0"); // corner -> 2 -> explodes into (0,1)
  assert.equal(g.board[0][1].player, "P0", "captured");
  assert.equal(g.board[0][1].count, 2, "1 existing + 1 received");
});

test("a wave explodes multiple cells simultaneously", () => {
  const g = new Game(6, "wave");
  // Primed 2x2 corner cluster: one placement triggers multi-cell waves.
  g.board[0][0] = { count: 1, player: "P0", capacity: 2 };
  g.board[0][1] = { count: 2, player: "P0", capacity: 3 };
  g.board[1][0] = { count: 2, player: "P0", capacity: 3 };
  g.board[1][1] = { count: 3, player: "P0", capacity: 4 };
  g.moveCount = 5;
  const res = g.resolveMove(0, 0, "P0");
  const maxCellsInAWave = Math.max(...res.frames.map((f) => f.explodedAt.length));
  assert.ok(maxCellsInAWave >= 2, "at least one wave bursts >= 2 cells together");
});

test("orbs are conserved across a single cascading move", () => {
  const g = new Game(6, "conserve");
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 6; c++) {
      g.board[r][c].count = g.board[r][c].capacity - 1;
      g.board[r][c].player = "P0";
    }
  g.board[5][5] = { count: 1, player: "P1", capacity: 2 };
  g.board[0][0] = { count: 0, player: null, capacity: 2 };
  g.moveCount = 10;
  const before = totalOrbs(g.board);
  g.resolveMove(0, 0, "P0");
  assert.equal(totalOrbs(g.board), before + 1, "exactly one orb added, none lost");
});
