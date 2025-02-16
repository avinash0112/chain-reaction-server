const Game = require("./Game");

class Session {
  constructor(sessionName, gameSize) {
    this.sessionName = sessionName;
    this.players = [];
    this.currentPlayerTurn = 0;
    this.game = new Game(gameSize); // Default grid size
  }

  addPlayer(socketId) {
    this.players.push(socketId);
  }

  removePlayer(socketId) {
    this.players = this.players.filter((id) => id !== socketId);
  }

  isEmpty() {
    return this.players.length === 0;
  }

  getGame() {
    return this.game;
  }

  updatePlayerTurn() {
    if (this.players?.length) {
      this.currentPlayerTurn =
        (this.currentPlayerTurn + 1) % this.players.length;
    }
  }
}

module.exports = Session;
