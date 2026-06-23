// require("dotenv").config();
const http = require("http");
const os = require("os");
const app = require("./app.js"); // Import Express app
const { setupSocket } = require("./socket/socketHandler.js");
const { logger, currentLevelName } = require("./utils/logger");

const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io
setupSocket(server);

// Non-internal IPv4 addresses, so we can print the URL to share over the LAN.
function lanAddresses() {
  const addrs = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === "IPv4" && !iface.internal) addrs.push(iface.address);
    }
  }
  return addrs;
}

// Bind to 0.0.0.0 so other devices on the same WiFi/LAN can reach the server.
server.listen(PORT, "0.0.0.0", () => {
  logger.info(`Server listening on port ${PORT}`, { logLevel: currentLevelName });
  logger.info(`Local:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    logger.info(`Network: http://${ip}:${PORT}  <- share this on your LAN`);
  }
});
