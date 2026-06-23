// A cell's critical mass = its number of orthogonal neighbors
// (2 for corners, 3 for edges, 4 for interior cells).
function getCriticalMass(row, col, gridSize) {
  let neighborCount = 0;
  if (row > 0) neighborCount++;
  if (row < gridSize - 1) neighborCount++;
  if (col > 0) neighborCount++;
  if (col < gridSize - 1) neighborCount++;
  return neighborCount;
}

function getNeighbors(row, col, gridSize) {
  const neighbors = [];
  if (row > 0) neighbors.push([row - 1, col]);
  if (row < gridSize - 1) neighbors.push([row + 1, col]);
  if (col > 0) neighbors.push([row, col - 1]);
  if (col < gridSize - 1) neighbors.push([row, col + 1]);
  return neighbors;
}

// Mutates `grid` in place: starting from the just-played cell, explodes any
// cell that has reached its critical mass, distributing one orb to each
// neighbor (capturing it for the exploding player), which can trigger
// further explosions. Processed breadth-first via a queue so it never
// recurses.
//
// SAFETY NOTE: explosions never destroy orbs, only redistribute them, and
// the board has no "sink" cell that absorbs orbs permanently. This is the
// classic chip-firing / abelian sandpile model, and termination is only
// *guaranteed* while total orbs on the board stay below the number of
// adjacency edges in the grid (60 for this 6x6 board). In real two-player
// games that threshold is never approached before someone is eliminated,
// but the cap below exists as a defensive backstop against a pathological
// or adversarially-constructed sequence reaching it.
function resolveExplosions(grid, startRow, startCol, gridSize) {
  const queue = [[startRow, startCol]];
  const maxIterations = gridSize * gridSize * 100;
  let iterations = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (++iterations > maxIterations) {
      console.error("Explosion chain exceeded safety limit — aborting early.");
      truncated = true;
      break;
    }

    const [row, col] = queue.shift();
    const cell = grid[row][col];
    const criticalMass = getCriticalMass(row, col, gridSize);

    if (cell.count < criticalMass) continue;

    const explodingPlayer = cell.player;
    cell.count = 0;
    cell.player = null;

    for (const [nRow, nCol] of getNeighbors(row, col, gridSize)) {
      const neighbor = grid[nRow][nCol];
      neighbor.count += 1;
      neighbor.player = explodingPlayer;
      queue.push([nRow, nCol]);
    }
  }

  return { grid, truncated };
}

// Returns { grid, truncated }. `truncated: true` means the cascade hit the
// safety cap and the returned grid is NOT a reliable stable state — the
// caller should treat the move as failed/voided rather than act on it
// (e.g. don't run a win-check against it), rather than trusting a board
// that may have a cell still sitting above its own critical mass.
function handleGameStateUpdate(prevGrid, row, col, player, gridSize) {
  const newGrid = prevGrid.map((r) => r.map((cell) => ({ ...cell })));
  newGrid[row][col].count += 1;
  newGrid[row][col].player = player;

  return resolveExplosions(newGrid, row, col, gridSize);
}

// A move is valid only on the board, and only on a cell that's empty
// or already owned by the player making the move.
function isValidMove(grid, row, col, player, gridSize) {
  if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
    return false;
  }
  const cell = grid[row][col];
  return cell.player === null || cell.player === player;
}

// Returns the winning player's label once only one player has any orbs
// left on the board — but never before both players have had a turn,
// since an empty/near-empty board would otherwise falsely look "won".
function checkWinner(grid, totalMovesMade) {
  if (totalMovesMade < 2) return null;

  const ownersInPlay = new Set();
  for (const row of grid) {
    for (const cell of row) {
      if (cell.player !== null) {
        ownersInPlay.add(cell.player);
      }
    }
  }

  return ownersInPlay.size === 1 ? [...ownersInPlay][0] : null;
}

module.exports = {
  handleGameStateUpdate,
  isValidMove,
  checkWinner,
  getCriticalMass,
};
