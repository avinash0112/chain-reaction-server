const Game = require("./Game");

class Session {
  constructor(sessionName, gridSize) {
    this.sessionName = sessionName;
    // Maps socket.id -> stable label ("P0", "P1", ...).
    // Using a Map instead of an array means labels are assigned once and
    // never change when another player leaves — the old array approach
    // shifted everyone down one slot on removal, desyncing their label
    // from the orbs they already placed on the board.
    this.playerMap = new Map();
    // Ordered list of socket IDs — controls turn rotation independently
    // of the label map so we can safely drop a player from turn order
    // without renaming everyone else.
    this.turnOrder = [];
    this.currentPlayerTurn = 0;
    this.game = new Game(gridSize || 6, sessionName);
  }

  addPlayer(socketId) {
    if (this.playerMap.size >= Game.MAX_PLAYERS) {
      return false; // full — caller should treat this socket as a spectator
    }
    // Assign the lowest free slot label so slots stay compact (P0, P1, …)
    // even when earlier players have left and their slot is now open.
    const taken = new Set(this.playerMap.values());
    let slot = 0;
    while (taken.has(`P${slot}`)) slot++;
    const label = `P${slot}`;
    this.playerMap.set(socketId, label);
    this.turnOrder.push(socketId);
    return true;
  }

  removePlayer(socketId) {
    if (!this.playerMap.has(socketId)) return;
    this.playerMap.delete(socketId);
    const idx = this.turnOrder.indexOf(socketId);
    if (idx !== -1) {
      this.turnOrder.splice(idx, 1);
      // Keep the turn pointer valid after the removal. If we removed the
      // player whose turn it was (or one before them), clamp so the index
      // still points at a real player.
      if (this.turnOrder.length > 0) {
        this.currentPlayerTurn =
          this.currentPlayerTurn % this.turnOrder.length;
      } else {
        this.currentPlayerTurn = 0;
      }
    }
  }

  isEmpty() {
    return this.playerMap.size === 0;
  }

  getGame() {
    return this.game;
  }

  getActivePlayerCount() {
    return this.turnOrder.length;
  }

  getPlayerLabel(socketId) {
    return this.playerMap.get(socketId) ?? null;
  }

  getPlayerLabels() {
    return this.turnOrder.map((id) => this.playerMap.get(id));
  }

  updatePlayerTurn() {
    if (this.turnOrder.length > 0) {
      this.currentPlayerTurn =
        (this.currentPlayerTurn + 1) % this.turnOrder.length;
    }
  }

  isCurrentPlayerTurn(socketId) {
    return this.turnOrder[this.currentPlayerTurn] === socketId;
  }

  getCurrentPlayer() {
    return this.turnOrder[this.currentPlayerTurn];
  }

  getCurrentPlayerName() {
    const id = this.getCurrentPlayer();
    return id ? this.playerMap.get(id) : null;
  }

  isPlayerInSession(socketId) {
    return this.playerMap.has(socketId);
  }

  reset() {
    this.game = new Game(this.game.gridSize, this.sessionName);
    this.currentPlayerTurn = 0;
  }
}

module.exports = Session;
