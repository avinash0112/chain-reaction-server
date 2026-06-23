class Game {
  static MAX_PLAYERS = 4;

  constructor(gridSize, sessionName) {
    this.gridSize = gridSize;
    this.sessionName = sessionName;
    this.board = this.getInitialGameBoardState();
    this.moveCount = 0;
    this.gameOver = false;
  }

  getInitialGameBoardState() {
    return Array.from({ length: this.gridSize }, (_, row) =>
      Array.from({ length: this.gridSize }, (_, col) => ({
        count: 0,
        player: null,
        capacity: this.getCellCapacity(row, col),
      }))
    );
  }

  getCellCapacity(row, col) {
    const isCorner =
      (row === 0 || row === this.gridSize - 1) &&
      (col === 0 || col === this.gridSize - 1);
    const isEdge =
      row === 0 ||
      row === this.gridSize - 1 ||
      col === 0 ||
      col === this.gridSize - 1;
    return isCorner ? 2 : isEdge ? 3 : 4;
  }

  isValidMove(row, col, player) {
    if (row < 0 || row >= this.gridSize || col < 0 || col >= this.gridSize) {
      return false;
    }
    const cell = this.board[row][col];
    return cell.player === null || cell.player === player;
  }

  handleMove(row, col, player, io, getExtraPayload, onSettled) {
    if (this.gameOver || !this.isValidMove(row, col, player)) {
      return false;
    }

    const boardSnapshot = this.board.map((r) => r.map((cell) => ({ ...cell })));
    const moveCountSnapshot = this.moveCount;
    this.moveCount++;

    const frames = [];
    // Cap counts EXPLOSION EVENTS, not individual orb placements.
    // Each addOrb call is not a step — only an actual cell explosion is.
    // On a 6×6 board the chip-firing model guarantees termination while
    // total orbs stay below 60 (the edge count). Normal games end well
    // before that. This cap is a backstop for data corruption only —
    // it should never fire during real gameplay.
    const MAX_EXPLOSIONS = 10000;
    let explosions = 0;
    let truncated = false;

    const neighbors = (r, c) =>
      [
        [r - 1, c],
        [r + 1, c],
        [r, c - 1],
        [r, c + 1],
      ].filter(
        ([nr, nc]) =>
          nr >= 0 && nr < this.gridSize && nc >= 0 && nc < this.gridSize
      );

    // Places one orb on (r,c) for the given player, then immediately
    // explodes the cell if it hits capacity. "Immediately" is the key
    // word: the old BFS queue deferred explosions, which meant a cell
    // could receive orbs from multiple queued neighbours before being
    // processed — letting count climb above capacity and silently
    // discarding the extra orbs when the explosion finally ran.
    // Here the explosion is triggered synchronously inside this call,
    // before any other addOrb call for ANY cell can proceed, so a
    // cell's count is reset to 0 the instant it reaches capacity.
    // count can therefore never exceed capacity.
    const addOrb = (r, c, ep) => {
      if (truncated) return;
      this.board[r][c].count++;
      this.board[r][c].player = ep;
      if (this.board[r][c].count >= this.board[r][c].capacity) {
        explodeCell(r, c);
      }
    };

    // Resets the cell and distributes one orb to each neighbour via
    // addOrb. Because addOrb is recursive, each neighbour's own
    // explosion (if triggered) fully resolves before the next neighbour
    // receives its orb. A snapshot is captured after all of this cell's
    // recursive subtree has settled, so the frame shows a stable partial
    // board state that is always self-consistent (no cell above capacity).
    const explodeCell = (r, c) => {
      if (truncated) return;
      if (++explosions > MAX_EXPLOSIONS) {
        console.error(
          `Session "${this.sessionName}": cascade exceeded ${MAX_EXPLOSIONS} explosions — board data is corrupt.`
        );
        truncated = true;
        return;
      }
      const ep = this.board[r][c].player;
      this.board[r][c] = { ...this.board[r][c], count: 0, player: null };

      for (const [nr, nc] of neighbors(r, c)) {
        addOrb(nr, nc, ep);
      }

      frames.push({
        board: this.board.map((row) => row.map((cell) => ({ ...cell }))),
        explodedAt: [r, c],
      });
    };

    // Kick off the cascade. If the placed orb reaches capacity,
    // addOrb calls explodeCell which recurses until the board is stable.
    addOrb(row, col, player);

    if (truncated) {
      this.board = boardSnapshot;
      this.moveCount = moveCountSnapshot;
      if (onSettled) onSettled({ truncated: true });
      return true;
    }

    // Phase 2: stream the pre-computed frames to clients with an
    // animation delay so each explosion is visible.
    const FRAME_DELAY_MS = 500;
    const streamFrames = (index) => {
      if (index >= frames.length) {
        if (onSettled) onSettled({ truncated: false });
        return;
      }
      io.to(this.sessionName).emit("gameUpdateByOther", {
        grid: frames[index].board,
        ...(getExtraPayload ? getExtraPayload() : {}),
      });
      setTimeout(() => streamFrames(index + 1), FRAME_DELAY_MS);
    };

    if (frames.length === 0) {
      if (onSettled) onSettled({ truncated: false });
    } else {
      streamFrames(0);
    }

    return true;
  }

  checkWinner(activePlayerCount) {
    if (this.moveCount < activePlayerCount) return null;

    const ownersInPlay = new Set();
    for (const row of this.board) {
      for (const cell of row) {
        if (cell.player !== null) ownersInPlay.add(cell.player);
      }
    }

    return ownersInPlay.size === 1 ? [...ownersInPlay][0] : null;
  }
}

module.exports = Game;
