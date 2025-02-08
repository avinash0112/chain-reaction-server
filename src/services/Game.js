class Game {
  constructor(gridSize) {
    this.gridSize = gridSize;
    this.board = this.getInitialGameBoardState();
    this.explosionQueue = [];
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

  handleMove(row, col, player, io) {
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

    // Start explosion sequence if necessary
    this.processExplosions(io);
  }

  processExplosions(io) {
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

    const processQueue = () => {
      if (this.explosionQueue.length > 0) {
        const [r, c] = this.explosionQueue.shift();
        explodeCell(r, c);
        io.emit("gameUpdateByOther", this.board);
        setTimeout(processQueue, 500);
      }
    };

    processQueue();
  }
}

module.exports = Game;
