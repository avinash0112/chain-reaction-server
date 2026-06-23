class Game {
  // Matches the four player colors the frontend defines (P0–P3). Sessions
  // beyond this count are treated as spectators, never added to turn rotation.
  static MAX_PLAYERS = 4;

  constructor(gridSize, sessionName) {
    this.gridSize = gridSize;
    this.sessionName = sessionName;
    this.board = this.getInitialGameBoardState();
    this.explosionQueue = [];
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

  addToQueue(r, c) {
    this.explosionQueue.push([r, c]);
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

  // FIX (ownership check): a move is only legal on a cell that's empty or
  // already owned by the player making it. Previously handleMove only
  // checked `!player` to decide whether to assign ownership, so clicking
  // an opponent's cell silently incremented it for THEM — your click
  // helped your opponent instead of being rejected.
  isValidMove(row, col, player) {
    if (row < 0 || row >= this.gridSize || col < 0 || col >= this.gridSize) {
      return false;
    }
    const cell = this.board[row][col];
    return cell.player === null || cell.player === player;
  }

  // Returns true if the move was applied, false if it was rejected.
  // `getExtraPayload()` is called fresh on every intermediate broadcast
  // during a chain reaction (so e.g. currentTurn stays accurate even
  // while the cascade is still animating). `onSettled()` fires once the
  // entire cascade has finished — that's the only safe point to check
  // for a winner or advance the turn, since the board isn't final until
  // every queued explosion (each one delayed for animation) has resolved.
  handleMove(row, col, player, io, getExtraPayload, onSettled) {
    if (this.gameOver || !this.isValidMove(row, col, player)) {
      return false;
    }

    if (!this.board[row][col].player) {
      this.board[row][col] = { ...this.board[row][col], count: 1, player };
    } else {
      if (this.board[row][col].count + 1 < this.board[row][col].capacity) {
        this.board[row][col].count++;
      } else {
        this.board[row][col].count++;
        this.addToQueue(row, col);
      }
    }

    this.moveCount += 1;
    this.processExplosions(io, getExtraPayload, onSettled);
    return true;
  }

  // SAFETY NOTE: explosions only redistribute orbs, never destroy them,
  // and the board has no "sink" that removes them permanently. This is
  // the classic chip-firing / abelian sandpile model — a cascade is only
  // *guaranteed* to terminate while total orbs on the board stay below
  // the number of adjacency edges in the grid (60 for a 6x6 board). Real
  // games never approach that, but without a cap a pathological sequence
  // can schedule setTimeout after setTimeout forever — which would also
  // mean checkWinner() never runs (it only fires once the cascade
  // settles), so this cap is required for the win-condition fix above to
  // actually be reliable. Capped by *wall-clock time* rather than step
  // count: each step has a 500ms animation delay, so a step-count cap
  // would bound worst case to many minutes on a 6x6 board — a time cap
  // keeps the worst case to a few seconds regardless of chain length.
  processExplosions(io, getExtraPayload, onSettled) {
    const maxDurationMs = 8000;
    const startedAt = Date.now();

    const explodeCell = (r, c) => {
      const { count, player, capacity } = this.board[r][c];

      if (count >= capacity) {
        this.board[r][c] = { count: 0, player: null, capacity: capacity };

        const directions = [
          [r - 1, c],
          [r + 1, c],
          [r, c - 1],
          [r, c + 1],
        ];

        directions.forEach(([nr, nc]) => {
          if (nr >= 0 && nr < this.gridSize && nc >= 0 && nc < this.gridSize) {
            this.board[nr][nc] = {
              ...this.board[nr][nc],
              count: this.board[nr][nc].count + 1,
              player,
            };
            if (this.board[nr][nc].count >= this.board[nr][nc].capacity) {
              this.addToQueue(nr, nc);
            }
          }
        });
      }
    };

    // FIX (test-session hijack, part 2): this used to be a global
    // io.emit(...), broadcasting to every connected socket on the entire
    // server regardless of which session they were in. Now scoped to
    // this game's own session room.
    const processQueue = () => {
      if (Date.now() - startedAt > maxDurationMs) {
        console.error(
          `Explosion chain exceeded ${maxDurationMs}ms safety limit in session "${this.sessionName}" — aborting early.`
        );
        this.explosionQueue = [];
        if (onSettled) onSettled({ truncated: true });
        return;
      }

      if (this.explosionQueue.length > 0) {
        const [r, c] = this.explosionQueue.shift();
        explodeCell(r, c);
        io.to(this.sessionName).emit("gameUpdateByOther", {
          grid: this.board,
          ...(getExtraPayload ? getExtraPayload() : {}),
        });
        setTimeout(processQueue, 500);
      } else if (onSettled) {
        onSettled({ truncated: false });
      }
    };

    processQueue();
  }

  // FIX (win condition): didn't exist before — the game never ended.
  // Gated on `activePlayerCount` so it can't falsely fire before every
  // real player has had at least one turn.
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
