// require("dotenv").config();
const http = require("http");
const app = require("./app.js"); // Import Express app
const { setupSocket } = require("./socket/socketHandler.js");

const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
setupSocket(server);

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
