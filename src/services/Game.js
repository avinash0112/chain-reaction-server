const { createLogger, summarizeBoard } = require("../utils/logger");

// Delay between streamed animation frames. Configurable via env so tests can
// stream cascades quickly instead of waiting the full per-frame delay.
const FRAME_DELAY_MS = Number(process.env.FRAME_DELAY_MS) || 400;

class Game {
  static MAX_PLAYERS = 4;

  constructor(gridSize, sessionName) {
    this.gridSize = gridSize;
    this.sessionName = sessionName;
    this.board = this.getInitialGameBoardState();
    this.moveCount = 0;
    this.gameOver = false;
    this.log = createLogger(sessionName ? `game:${sessionName}` : "game");
    this.log.info(`Game created (gridSize=${gridSize})`);
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

  /**
   * Pure, synchronous resolution of a move: places the orb, runs the entire
   * wave-based cascade, mutates the board/moveCount, and returns metadata.
   * No sockets, no timers — so it can be unit-tested directly. handleMove()
   * wraps this with the async frame streaming for live play.
   *
   * @returns {{applied: boolean, truncated?: boolean, gameWon?: boolean,
   *            frames?: Array, explosions?: number}}
   */
  resolveMove(row, col, player) {
    if (this.gameOver || !this.isValidMove(row, col, player)) {
      this.log.warn(
        `Rejected move by ${player} at (${row},${col})`,
        { gameOver: this.gameOver, validMove: this.isValidMove(row, col, player) }
      );
      return { applied: false };
    }

    const boardSnapshot = this.board.map((r) => r.map((cell) => ({ ...cell })));
    const moveCountSnapshot = this.moveCount;
    this.moveCount++;

    // Per-move scoped logger so every line for this iteration is tagged
    // "...:move#N", making it trivial to follow one turn in the console.
    const mlog = this.log.child(`move#${this.moveCount}`);
    mlog.info(`${player} places at (${row},${col})`, {
      before: summarizeBoard(this.board),
    });

    const frames = [];
    // Wave-based (generation) explosion model, matching the reference game:
    // every cell that is at or above its critical mass explodes SIMULTANEOUSLY
    // in a single wave; the over-critical cells that result then explode in the
    // next wave, and so on until the board stabilises. This produces the
    // synchronised "everything bursts together" look — not one cell at a time.
    //
    // The number of waves for a stabilising cascade is tiny (tens at most), so
    // there is no call-stack concern; the generation cap below is just a
    // last-resort backstop against pathological data corruption.
    const MAX_GENERATIONS = 10_000;
    // Once the game is decided we keep firing only to tidy the board (no cell
    // left at/over capacity). That cleanup is strictly bounded and NEVER voids
    // the move: a chip-firing board can hold so many orbs that no stable state
    // exists, so we cannot always reach a clean board — we just try for a few
    // waves and accept whatever remains.
    const MAX_POSTWIN_WAVES = 40;
    let postWinWaves = 0;
    let generation = 0;
    let explosions = 0;
    let truncated = false;
    let gameWon = false;

    // Owners present before this move. If the opponent had orbs here and the
    // cascade wipes them out, that's a win — and crucially the all-one-colour
    // board left behind is super-critical and would explode forever (a 6×6
    // board has no stable configuration above 84 orbs). So we must detect the
    // win *inside* the cascade and stop, instead of looping to the cap and
    // wrongly voiding the winning move.
    const ownersBeforeMove = new Set();
    for (const r of boardSnapshot) {
      for (const cell of r) {
        if (cell.player !== null) ownersBeforeMove.add(cell.player);
      }
    }

    // The largest total number of orbs the board can hold while still having a
    // stable configuration: sum of (capacity - 1) over every cell (84 on 6×6).
    // Above this, NO arrangement is stable, so a winning cascade can never
    // settle and must be halted unsettled; at or below it, the cascade will
    // always reach a clean stable board.
    const maxStableTotal = this.board.reduce(
      (sum, r) => sum + r.reduce((s, cell) => s + (cell.capacity - 1), 0),
      0
    );

    // True only when exactly one player still owns orbs on the board.
    const hasSingleOwner = () => {
      let owner;
      for (const r of this.board) {
        for (const cell of r) {
          if (cell.player !== null) {
            if (owner === undefined) owner = cell.player;
            else if (cell.player !== owner) return false;
          }
        }
      }
      return owner !== undefined;
    };

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

    // Process the board in synchronised waves until it stabilises.
    while (true) {
      // 1) Snapshot every cell currently at/above critical mass. They all
      //    explode together this wave; capture each owner now so distribution
      //    uses the pre-wave ownership.
      const exploding = [];
      for (let r = 0; r < this.gridSize; r++) {
        for (let c = 0; c < this.gridSize; c++) {
          if (this.board[r][c].count >= this.board[r][c].capacity) {
            exploding.push([r, c, this.board[r][c].player]);
          }
        }
      }
      if (exploding.length === 0) break; // board is stable

      if (gameWon) {
        // Post-win cleanup only: bounded, and it must never void the result.
        if (postWinWaves >= MAX_POSTWIN_WAVES) {
          mlog.info(
            `Stopped post-win cleanup after ${postWinWaves} wave(s); board left unsettled`
          );
          break;
        }
        postWinWaves++;
      } else if (++generation > MAX_GENERATIONS) {
        mlog.error(
          `Cascade exceeded ${MAX_GENERATIONS} waves — voiding move`,
          { explosions }
        );
        truncated = true;
        break;
      }

      // 2) Drain each exploding cell by its critical mass (not to zero — a
      //    cell may briefly hold more than critical mass). Keep the remainder
      //    and its owner; only a fully emptied cell becomes unowned.
      for (const [r, c] of exploding) {
        this.board[r][c].count -= this.board[r][c].capacity;
        if (this.board[r][c].count === 0) this.board[r][c].player = null;
      }

      // 3) Distribute one orb to each neighbour of every exploding cell.
      //    Receiving an orb captures the cell for that neighbour's owner
      //    (a cell's orbs are always a single colour). Done after step 2 so
      //    captures correctly win over the drained owner.
      for (const [r, c, owner] of exploding) {
        for (const [nr, nc] of neighbors(r, c)) {
          this.board[nr][nc].count++;
          this.board[nr][nc].player = owner;
        }
      }

      explosions += exploding.length;

      // One animation frame per wave: the post-wave board plus EVERY cell that
      // exploded this wave, so the client can burst them all simultaneously.
      frames.push({
        board: this.board.map((row) => row.map((cell) => ({ ...cell }))),
        explodedAt: exploding.map(([r, c, owner]) => [r, c, owner]),
      });

      mlog.debug(
        `Wave ${generation}: ${exploding.length} cell(s) exploded`,
        { cells: exploding.map(([r, c]) => `(${r},${c})`).join(", ") }
      );

      // If this move started with an opponent on the board and the cascade has
      // now reduced it to a single owner, the game is won. We still want to
      // leave a CLEAN board (no cell left at/over capacity), so we keep firing
      // the remaining waves until it stabilises — which is guaranteed as long
      // as the total is within the stable bound. Only a genuinely super-critical
      // board (above the bound) can never settle; there we stop immediately and
      // accept the unsettled board, since continuing would loop forever.
      if (!gameWon && ownersBeforeMove.size >= 2 && hasSingleOwner()) {
        gameWon = true;
        let totalOrbs = 0;
        for (const r of this.board) for (const cell of r) totalOrbs += cell.count;
        if (totalOrbs > maxStableTotal) {
          // No stable board can exist above the bound — don't even try to settle.
          mlog.info(
            `Win after wave ${generation}; board super-critical (${totalOrbs} orbs) — halting unsettled`
          );
          break;
        }
        mlog.info(
          `Win after wave ${generation}; cleaning up for up to ${MAX_POSTWIN_WAVES} more wave(s)`
        );
        // fall through: keep firing (bounded) until the board settles or the
        // post-win wave budget is spent.
      }
    }

    if (truncated) {
      this.board = boardSnapshot;
      this.moveCount = moveCountSnapshot;
      mlog.warn("Move voided; board rolled back to pre-move snapshot");
      return { applied: true, truncated: true, gameWon: false, frames: [], explosions };
    }

    mlog.info(
      `${gameWon ? "Won" : "Settled"} after ${frames.length} wave(s), ${explosions} explosion(s)`,
      { after: summarizeBoard(this.board) }
    );

    return { applied: true, truncated: false, gameWon, frames, explosions };
  }

  /**
   * Live-play entry point: resolves the move, then streams the cascade frames
   * to the room one wave at a time. Returns false only when the move is
   * rejected (so the caller can surface "Invalid move"), true otherwise.
   */
  handleMove(row, col, player, io, getExtraPayload, onSettled) {
    const result = this.resolveMove(row, col, player);
    if (!result.applied) return false;

    if (result.truncated) {
      if (onSettled) onSettled({ truncated: true });
      return true;
    }

    const { frames } = result;

    // Stream a capped selection of frames so that even a cascade of thousands
    // of explosions doesn't make the next player wait forever. We always
    // include the very last frame so clients see the stable board.
    const MAX_ANIM_FRAMES = 30;
    let animFrames;
    if (frames.length <= MAX_ANIM_FRAMES) {
      animFrames = frames;
    } else {
      const step = Math.floor(frames.length / (MAX_ANIM_FRAMES - 1));
      animFrames = [];
      for (let i = 0; i < frames.length - 1; i += step) {
        if (animFrames.length >= MAX_ANIM_FRAMES - 1) break;
        animFrames.push(frames[i]);
      }
      animFrames.push(frames[frames.length - 1]);
    }

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

    const winner = ownersInPlay.size === 1 ? [...ownersInPlay][0] : null;
    if (winner) {
      this.log.info(`Winner detected: ${winner} (after move #${this.moveCount})`);
    }
    return winner;
  }
}

module.exports = Game;
