const handleGameStateUpdate = (gameState, row, col) => {
  const newState = [...gameState];
  if (!newState[row][col].player) {
    newState[row][col] = { count: 1, player: "P1" };
  } else {
    newState[row][col].count++;
  }
  return newState;
};

module.exports = { handleGameStateUpdate };
