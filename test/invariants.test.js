process.env.LOG_LEVEL = process.env.LOG_LEVEL || "SILENT";

const test = require("node:test");
const assert = require("node:assert/strict");
const Game = require("../src/services/Game");

const totalOrbs = (board) =>
  board.flat().reduce((sum, cell) => sum + cell.count, 0);
const distinctOwners = (board) =>
  new Set(board.flat().filter((c) => c.player !== null).map((c) => c.player));
const overCapacityCells = (board) =>
  board.flat().filter((c) => c.count >= c.capacity).length;

// Plays one random 2-player game to completion, asserting per-move invariants.
// Returns a summary so callers can assert end-state properties too.
function playRandomGame(seedTag) {
  const g = new Game(6, seedTag);
  const players = ["P0", "P1"];
  let turn = 0;
  let placed = 0;
  let winner = null;

  for (let move = 0; move < 1000 && !g.gameOver; move++) {
    const player = players[turn % 2];
    const legal = [];
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < 6; c++)
        if (g.isValidMove(r, c, player)) legal.push([r, c]);
    assert.ok(legal.length > 0, "a player always has at least one legal move");

    const [r, c] = legal[Math.floor(Math.random() * legal.length)];
    const res = g.resolveMove(r, c, player);

    assert.equal(res.applied, true, "a legal move must apply");
    assert.equal(res.truncated, false, "a legal move must never be voided");

    placed++;
    // Invariant: orbs are conserved — board total equals orbs placed.
    assert.equal(totalOrbs(g.board), placed, "orb conservation");

    winner = g.checkWinner(2);
    if (winner) g.gameOver = true;
    turn++;
  }
  return { game: g, placed, winner };
}

test("fuzz: random games conserve orbs and always reach a single winner", () => {
  const GAMES = 120;
  for (let i = 0; i < GAMES; i++) {
    const { game, winner } = playRandomGame(`fuzz-${i}`);
    assert.ok(winner !== null, `game ${i} must terminate with a winner`);
    assert.equal(
      distinctOwners(game.board).size,
      1,
      `game ${i} ends with exactly one owner`
    );
    assert.equal(distinctOwners(game.board).has(winner), true);
  }
});

test("the winning move is recognised, never voided", () => {
  const g = new Game(6, "win");
  // Board almost entirely P0; P1 holds a single orb that P0 is about to capture.
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 6; c++) {
      g.board[r][c].count = g.board[r][c].capacity - 1;
      g.board[r][c].player = "P0";
    }
  g.board[2][2] = { count: 3, player: "P1", capacity: 4 };
  g.moveCount = 20;

  const res = g.resolveMove(2, 1, "P0");
  assert.equal(res.applied, true);
  assert.equal(res.truncated, false, "winning move must not be voided");
  assert.equal(res.gameWon, true, "win detected mid-cascade");
  assert.equal(distinctOwners(g.board).size, 1, "only the winner remains");
});

test("a low-orb winning board settles fully clean (no over-capacity cells)", () => {
  const g = new Game(6, "cleanwin");
  // Few orbs: P1 has one lone orb in a corner P0 is about to take.
  g.board[0][0] = { count: 1, player: "P0", capacity: 2 };
  g.board[0][1] = { count: 1, player: "P1", capacity: 3 };
  g.moveCount = 6;

  const res = g.resolveMove(0, 0, "P0");
  assert.equal(res.gameWon, true);
  assert.equal(distinctOwners(g.board).size, 1);
  assert.equal(
    overCapacityCells(g.board),
    0,
    "low-orb win settles to a stable board"
  );
});

test("checkWinner does not declare a winner before each player has moved", () => {
  const g = new Game(6, "early");
  g.resolveMove(0, 0, "P0"); // only P0 owns orbs, but P1 hasn't played
  assert.equal(g.moveCount, 1);
  assert.equal(g.checkWinner(2), null, "no winner before activePlayerCount moves");
});

test("no cascade runs unbounded — explosions stay within the chip-firing bound", () => {
  // A dense board's cascade must complete in a sane number of explosions, not
  // spin forever. 84 orbs (the max-stable total) gives the worst realistic case.
  const g = new Game(6, "bounded");
  for (let r = 0; r < 6; r++)
    for (let c = 0; c < 6; c++) {
      g.board[r][c].count = g.board[r][c].capacity - 1;
      g.board[r][c].player = "P0";
    }
  g.board[5][5] = { count: 1, player: "P1", capacity: 2 };
  g.board[0][0] = { count: 0, player: null, capacity: 2 };
  g.moveCount = 10;

  const res = g.resolveMove(0, 0, "P0");
  assert.equal(res.applied, true);
  assert.ok(res.explosions < 100000, "cascade is bounded, not infinite");
});
