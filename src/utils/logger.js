/**
 * Lightweight, zero-dependency leveled logger.
 *
 * Why not winston/pino? The project has no logging dependency and the goal is
 * just to make each game iteration traceable on the server console. This keeps
 * install-free and gives us levels, timestamps, scoped tags, and structured
 * metadata — enough to debug a single move end to end.
 *
 * Control verbosity with the LOG_LEVEL env var:
 *   LOG_LEVEL=DEBUG node ./src/server.js   # see every explosion event
 *   LOG_LEVEL=INFO  (default)              # per-move + lifecycle summaries
 *   LOG_LEVEL=WARN / ERROR / SILENT        # progressively quieter
 */

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, SILENT: 100 };

const requestedLevel = (process.env.LOG_LEVEL || "INFO").toUpperCase();
const currentLevel = LEVELS[requestedLevel] ?? LEVELS.INFO;

function timestamp() {
  return new Date().toISOString();
}

function format(levelName, scope, message, meta) {
  const scopeStr = scope ? ` [${scope}]` : "";
  let line = `${timestamp()} ${levelName.padEnd(5)}${scopeStr} ${message}`;
  if (meta !== undefined) {
    let metaStr;
    try {
      metaStr = typeof meta === "string" ? meta : JSON.stringify(meta);
    } catch {
      metaStr = String(meta);
    }
    line += ` ${metaStr}`;
  }
  return line;
}

function emit(levelName, consoleFn, scope, message, meta) {
  if (LEVELS[levelName] < currentLevel) return;
  consoleFn(format(levelName, scope, message, meta));
}

/**
 * Create a logger bound to a scope tag (e.g. a session name or subsystem).
 * Use `.child("sub")` to append a nested scope, e.g. "myGame:move#7".
 */
function createLogger(scope) {
  return {
    scope,
    debug: (message, meta) => emit("DEBUG", console.debug, scope, message, meta),
    info: (message, meta) => emit("INFO", console.log, scope, message, meta),
    warn: (message, meta) => emit("WARN", console.warn, scope, message, meta),
    error: (message, meta) => emit("ERROR", console.error, scope, message, meta),
    child: (sub) => createLogger(scope ? `${scope}:${sub}` : sub),
  };
}

/**
 * Compact summary of a board for debug logging: total orbs and per-player
 * orb counts. Cheap enough to compute every move.
 */
function summarizeBoard(board) {
  const perPlayer = {};
  let totalOrbs = 0;
  let occupiedCells = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell.count > 0) {
        totalOrbs += cell.count;
        occupiedCells++;
        perPlayer[cell.player] = (perPlayer[cell.player] || 0) + cell.count;
      }
    }
  }
  return { totalOrbs, occupiedCells, perPlayer };
}

module.exports = {
  logger: createLogger(),
  createLogger,
  summarizeBoard,
  LEVELS,
  currentLevelName: requestedLevel in LEVELS ? requestedLevel : "INFO",
};
