const handleGameStateUpdate = (gameState, io, row, col) => {
  const newState = gameState.map((row) => row.map((cell) => ({ ...cell }))); // Deep copy
  const explosionQueue = []; // Queue to store explosions

  const addToQueue = (r, c) => {
    explosionQueue.push([r, c]); // Add cell to the explosion queue
  };

  const explodeCell = (r, c) => {
    const { player, capacity } = newState[r][c];

    if (newState[r][c].count >= capacity) {
      newState[r][c] = { count: 0, player: null, capacity: capacity }; // Reset exploding cell

      // Define possible adjacent cells (top, bottom, left, right)
      const directions = [
        [r - 1, c], // Up
        [r + 1, c], // Down
        [r, c - 1], // Left
        [r, c + 1], // Right
      ];

      for (const [nr, nc] of directions) {
        if (
          nr >= 0 &&
          nr < newState.length &&
          nc >= 0 &&
          nc < newState[0].length
        ) {
          newState[nr][nc] = {
            ...newState[nr][nc],
            count: newState[nr][nc].count + 1,
            player: player, // Maintain the same player's ownership
          };

          if (newState[nr][nc].count >= newState[nr][nc].capacity) {
            addToQueue(nr, nc); // Add to queue for sequential explosion
          }
        }
      }
    }
  };

  // Step 1: Increment clicked cell
  if (!newState[row][col].player) {
    newState[row][col] = { ...newState[row][col], count: 1, player: "P1" };
  } else {
    newState[row][col].count++;
  }

  // Step 2: If the clicked cell reaches capacity, start explosion sequence
  if (newState[row][col].count >= newState[row][col].capacity) {
    addToQueue(row, col);
  }

  // Step 3: Process explosions sequentially with a delay
  const processExplosions = () => {
    if (explosionQueue.length > 0) {
      const [r, c] = explosionQueue.shift(); // Get the next cell to explode
      explodeCell(r, c); // Explode it

      // Emit the updated game state after each explosion
      io.emit("gameUpdateByOther", newState);

      // Call the function again after a delay (e.g., 500ms)
      setTimeout(processExplosions, 500);
    }
  };

  processExplosions(); // Start the explosion sequence

  return newState;
};

function getInitialGameBoardState(gameSize) {
  return Array.from({ length: gameSize }, (_, row) =>
    Array.from({ length: gameSize }, (_, col) => ({
      count: 0,
      player: null,
      capacity: getCellCapacity(row, col, gameSize),
    }))
  );
}

// Function to determine the capacity of a cell based on its position
function getCellCapacity(row, col, gameSize) {
  const isCorner =
    (row === 0 || row === gameSize - 1) && (col === 0 || col === gameSize - 1);
  const isEdge =
    row === 0 || row === gameSize - 1 || col === 0 || col === gameSize - 1;

  if (isCorner) return 2; // Corners have 2 adjacent cells
  if (isEdge) return 3; // Edges (but not corners) have 3 adjacent cells
  return 4; // Inner cells have 4 adjacent cells
}

module.exports = { handleGameStateUpdate, getInitialGameBoardState };
