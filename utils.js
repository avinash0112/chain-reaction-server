function handleGameStateUpdate(prevGrid, row, col) {
  const newGrid = prevGrid.map((row) => row.map((cell) => ({ ...cell })));
  newGrid[row][col].count += 1;
  newGrid[row][col].player = "P1"; // Hardcoded for now (could be toggled)

  return newGrid;
}
module.exports = { handleGameStateUpdate };
