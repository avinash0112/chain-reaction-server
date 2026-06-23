// require("dotenv").config();
const http = require("http");
const app = require("./app.js"); // Import Express app
const { setupSocket } = require("./socket/socketHandler.js");
const { logger, currentLevelName } = require("./utils/logger");

const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
setupSocket(server);

server.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`, {
    logLevel: currentLevelName,
  });
});
