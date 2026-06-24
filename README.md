# Chain Reaction — Server

Real-time multiplayer backend for **Chain Reaction**, a turn-based strategy game
played on a 6×6 grid. Built with **Node.js**, **Express**, and **Socket.IO**.

This repo holds the game engine, session/room management, and the WebSocket API.
The browser client lives in a separate repo: **chain-reaction-web-app**.

---

## How the game works

Each cell has a **critical mass** equal to its number of orthogonal neighbours:

| Cell position | Critical mass |
| --- | --- |
| Corner | 2 |
| Edge | 3 |
| Interior | 4 |

- A player places an orb in an **empty cell or a cell they already own**.
- When a cell reaches its critical mass it **explodes**: it sends one orb to each
  neighbour and is reduced by its critical mass.
- An orb landing in a cell **captures** it — the whole cell takes the attacker's
  colour.
- Explosions happen in **synchronised waves**: every cell at/over critical mass
  explodes at once, then the cells that newly hit critical mass explode in the
  next wave, until the board stabilises.
- A player **wins** when they own all the orbs on the board (checked once every
  player has made at least one move).

**Consistency guarantees** (enforced by the test suite): orbs are conserved
(never created or destroyed), cascades always terminate, and the winning move is
never discarded. Note that a winning board is often *super-critical* — when one
player owns 60–84+ orbs, no stable arrangement exists, so some cells may remain
at/over capacity on the final board. This is an inherent property of the game,
not a bug; the engine detects the win and stops rather than looping forever.

---

## Architecture

```
src/
├── server.js              # entry point — creates the HTTP server, binds 0.0.0.0,
│                          #   prints LAN URLs, wires up Socket.IO
├── app.js                 # Express app (CORS + JSON + /api routes)
├── routes/index.js        # GET /api — simple welcome/health response
├── socket/socketHandler.js# Socket.IO: rooms, turn timer, all game events
├── services/
│   ├── Game.js            # the engine: board, explosion cascade, win detection
│   └── Session.js         # a room: players, labels, turn order
└── utils/logger.js        # leveled logger (LOG_LEVEL), board summaries
test/                      # automated test suite (see TESTING.md)
```

Request flow: `server.js` → `setupSocket()` in `socket/socketHandler.js`, which
owns a map of `Session` instances; each `Session` owns one `Game`.

> Note: `index.js` (repo root), `utils.js`, `src/services/gameService.js`, and
> `src/socket/socketHandlerClass.js` / `testSessionHandler.js` are **legacy/unused**
> and are not part of the running server (`src/server.js`).

---

## Getting started

Requires Node.js 18+ (developed on Node 22).

```bash
npm install
npm run dev      # start with auto-reload (nodemon)
# or
npm start        # start once
```

On startup the server prints the URLs to use, e.g.:

```
Server listening on port 3000
Local:   http://localhost:3000
Network: http://192.168.1.8:3000  <- share this on your LAN
```

---

## Configuration (environment variables)

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `LOG_LEVEL` | `INFO` | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` \| `SILENT`. `DEBUG` logs every explosion wave. |
| `TURN_DURATION_MS` | `30000` | Per-turn countdown before a turn is auto-skipped. |
| `FRAME_DELAY_MS` | `400` | Delay between streamed explosion-animation frames. |

CORS is open (`origin: "*"`) so the client can connect from any device on your
network.

---

## Scripts

| Script | Description |
| --- | --- |
| `npm start` | Run the server. |
| `npm run dev` | Run with nodemon (auto-reload). |
| `npm test` | Run the full test suite (`node --test`). |
| `npm run test:watch` | Re-run tests on change. |
| `npm run test:coverage` | Run tests with coverage. |

See **[TESTING.md](TESTING.md)** for the full testing guide.

---

## Socket.IO API

**Client → server**

| Event | Payload | Effect |
| --- | --- | --- |
| `createSession` | `{ playerName }` | Create a room with an **auto-generated id** and join as the first player. The id comes back via `sessionCreated` and is used to build a shareable link. |
| `joinSession` | `{ sessionId, playerName }` | Join a room by id (e.g. from a shared link), as a player or spectator if full. |
| `leaveSession` | `sessionId` | Leave the current room. |
| `cellClicked` | `row, col` | Make a move (only on your turn). |
| `restartGame` | — | Reset the current room's game. |

**Server → client**

| Event | Payload | Meaning |
| --- | --- | --- |
| `sessionCreated` / `sessionJoined` | `sessionId` | Room create/join confirmed (the id used in the share link). |
| `playerAssigned` | `"P0"…"P3"` or `null` | Your label (`null` = spectator). |
| `playerJoined` / `playerLeft` | `[{ label, name }]` | Current players in the room — engine label + chosen display name. |
| `initialGameState` | `{ grid, currentTurn }` | Board state on join. |
| `gameUpdateByOther` | `{ grid, currentTurn?, explodedAt? }` | A board update / one explosion wave. `explodedAt` is the list of cells `[row, col, owner]` that burst this wave. |
| `turnTimer` | `{ currentTurn, duration }` | Start of a turn's countdown. |
| `turnPaused` | — | Freeze the countdown (a move is being processed/animated). |
| `turnSkipped` | `{ skippedPlayer, currentTurn }` | A turn timed out and was skipped. |
| `gameOver` | `{ winner }` | The game has ended. |
| `gameRestarted` | `{ grid, currentTurn }` | The game was reset. |
| `error` | `message` | An invalid action (e.g. not your turn). |

---

## Play over a LAN / WiFi

The server already binds to `0.0.0.0`, so other devices on the same network can
reach it at `http://<your-PC-IP>:3000` (printed on startup). Pair it with the
web app's dev server; see the **chain-reaction-web-app** README for the client
side.

> **Windows:** the first time you run it, allow Node.js through Windows Firewall
> for **private networks** when prompted, or other devices can't connect.

---

## Notes & limitations

- **State is in-memory** (`sessions = {}`): run a **single instance** (horizontal
  scaling would need a shared store / Socket.IO Redis adapter), and all active
  games are lost on restart/redeploy. This is fine for casual/LAN play.
