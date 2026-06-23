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
    // Iterative DFS via an explicit stack instead of recursive calls.
    // The recursive approach hit JavaScript's call-stack limit on boards
    // with many orbs (late-game cascades can require tens of thousands of
    // firing events — well within the chip-firing bound of O(chips × n²)
    // for a 6×6 grid — yet far beyond the ~10k default JS stack depth).
    // With an explicit stack there is no call-stack limit; the cap below
    // is a true last-resort backstop against pathological data corruption.
    const MAX_EXPLOSIONS = 1_000_000;
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

    // Place the initial orb.
    this.board[row][col].count++;
    this.board[row][col].player = player;

    // Seed the stack if the placed orb already hits capacity.
    const explodeStack = [];
    if (this.board[row][col].count >= this.board[row][col].capacity) {
      explodeStack.push([row, col]);
    }

    while (explodeStack.length > 0) {
      const [r, c] = explodeStack.pop();

      // A cell may have been pushed more than once (two different
      // neighbors firing into it) but then reduced below capacity by
      // an intermediate explosion — skip it.
      if (this.board[r][c].count < this.board[r][c].capacity) continue;

      if (++explosions > MAX_EXPLOSIONS) {
        console.error(
          `Session "${this.sessionName}": cascade exceeded ${MAX_EXPLOSIONS} explosions.`
        );
        truncated = true;
        break;
      }

      const ep = this.board[r][c].player;
      this.board[r][c] = { ...this.board[r][c], count: 0, player: null };

      for (const [nr, nc] of neighbors(r, c)) {
        this.board[nr][nc].count++;
        this.board[nr][nc].player = ep;
        if (this.board[nr][nc].count >= this.board[nr][nc].capacity) {
          explodeStack.push([nr, nc]);
        }
      }

      frames.push({
        board: this.board.map((row) => row.map((cell) => ({ ...cell }))),
        explodedAt: [r, c, ep],
      });
    }

    if (truncated) {
      this.board = boardSnapshot;
      this.moveCount = moveCountSnapshot;
      if (onSettled) onSettled({ truncated: true });
      return true;
    }

    // Phase 2: stream a capped selection of frames so that even a cascade
    // of thousands of explosions doesn't make the next player wait forever.
    // We always include the very last frame so clients see the stable board.
    const MAX_ANIM_FRAMES = 30;
    let animFrames;
    if (frames.length <= MAX_ANIM_FRAMES) {
      animFrames = frames;
    } else {
      // Pick indices evenly spread across the cascade, always ending on
      // the last frame (the stable board).
      const step = Math.floor(frames.length / (MAX_ANIM_FRAMES - 1));
      animFrames = [];
      for (let i = 0; i < frames.length - 1; i += step) {
        if (animFrames.length >= MAX_ANIM_FRAMES - 1) break;
        animFrames.push(frames[i]);
      }
      animFrames.push(frames[frames.length - 1]);
    }

    const FRAME_DELAY_MS = 400;
    const streamFrames = (index) => {
      if (index >= animFrames.length) {
        if (onSettled) onSettled({ truncated: false });
        return;
      }
      io.to(this.sessionName).emit("gameUpdateByOther", {
        grid: animFrames[index].board,
        explodedAt: animFrames[index].explodedAt,
        ...(getExtraPayload ? getExtraPayload() : {}),
      });
      setTimeout(() => streamFrames(index + 1), FRAME_DELAY_MS);
    };

    if (animFrames.length === 0) {
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
