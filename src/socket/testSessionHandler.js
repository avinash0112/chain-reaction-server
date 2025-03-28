function addToTestSession(testSession, socket, io, allSessions, tSessionName) {
  testSession.addPlayer(socket.id);
  socket.join(tSessionName);
  socket.emit("sessionCreated", tSessionName);
  io.to(tSessionName).emit("playerJoined", allSessions[tSessionName].players);
}

module.exports = { addToTestSession };
