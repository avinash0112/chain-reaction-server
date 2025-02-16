const Game = require("./Game");

class Session {
  constructor(sessionName) {
    this.sessionName = sessionName;
    this.players = [];
    this.game = new Game(6); // Default grid size
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
}

module.exports = Session;
