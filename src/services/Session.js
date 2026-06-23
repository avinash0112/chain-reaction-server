const Game = require("./Game");

class Session {
  constructor(sessionName, gridSize) {
    this.sessionName = sessionName;
    this.players = []; // socket IDs; array index IS the positional label (P0, P1, ...)
    this.currentPlayerTurn = 0;
    this.playerName = "P0";
    this.game = new Game(gridSize, sessionName);
  }

  // FIX (related to test-session hijack / spectators): previously this
  // pushed every socket unconditionally, so turn rotation's modulo
  // (`% players.length`) included anyone who ever connected — not just
  // the intended players. Now capped at Game.MAX_PLAYERS; anyone beyond
  // that is a spectator and never enters turn rotation.
  addPlayer(socketId) {
    if (this.players.length >= Game.MAX_PLAYERS) {
      return false; // full — caller should treat this socket as a spectator
    }
    this.players.push(socketId);
    return true;
  }

  removePlayer(socketId) {
    // NOTE (known limitation, kept as-is per minimal-patch scope): this
    // shifts everyone after the removed player down one index, which
    // changes their "P" label mid-game. A player's existing board cells
    // still carry their OLD label, so leaving and rejoining mid-game can
    // desync a player from their own prior moves. Fixing this properly
    // would mean reworking the positional-label system itself, which is
    // out of scope for this patch — flagging it rather than leaving it
    // as a silent trap.
    this.players = this.players.filter((id) => id !== socketId);
  }

  isEmpty() {
    return this.players.length === 0;
  }

  getGame() {
    return this.game;
  }

  getActivePlayerCount() {
    return this.players.length;
  }

  getPlayerLabel(socketId) {
    const index = this.players.indexOf(socketId);
    return index === -1 ? null : `P${index}`;
  }

  getPlayerLabels() {
    return this.players.map((_, idx) => `P${idx}`);
  }

  updatePlayerTurn() {
    if (this.players?.length) {
      this.currentPlayerTurn =
        (this.currentPlayerTurn + 1) % this.players.length;
      this.playerName = `P${this.currentPlayerTurn}`;
    }
  }

  isCurrentPlayerTurn(socId) {
    return this.players[this.currentPlayerTurn] === socId;
  }

  getCurrentPlayer() {
    return this.players[this.currentPlayerTurn];
  }

  getCurrentPlayerName() {
    return this.playerName;
  }
}

module.exports = Session;
