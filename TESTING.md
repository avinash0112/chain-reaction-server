# Testing

The backend has an automated test suite that guards the game engine's
correctness — that the board always stays consistent and every game ends
correctly. It uses **Node's built-in test runner** (`node:test` + `node:assert`),
so there are **no extra dependencies** to install.

## Running the tests

```bash
npm test            # run the whole suite once (~2s)
npm run test:watch  # re-run automatically on file changes (use while developing)
npm run test:coverage  # run with a built-in coverage report
```

`npm test` runs `node --test`, which auto-discovers every file under `test/`
named `*.test.js`. Each test file runs in its own process.

## What runs before every commit

A **pre-commit hook** runs the full suite and **blocks the commit if anything
fails**. It is version-controlled at [`.githooks/pre-commit`](.githooks/pre-commit)
and enabled via `git config core.hooksPath .githooks`.

- The `prepare` npm script wires this up automatically on `npm install`.
- To enable it manually: `git config core.hooksPath .githooks`
- To bypass it for a single commit (use sparingly): `git commit --no-verify`

## The test layers

| File | What it covers |
| --- | --- |
| [`test/game.test.js`](test/game.test.js) | **Engine unit tests** — cell capacities (corner 2 / edge 3 / interior 4), valid vs. invalid moves, single corner/edge explosions, opponent **capture**, simultaneous multi-cell waves, and single-move orb conservation. |
| [`test/invariants.test.js`](test/invariants.test.js) | **Property-based / fuzz tests** — plays many random games and asserts the core invariants on every move (see below). |
| [`test/session.test.js`](test/session.test.js) | **Session unit tests** — label assignment (P0–P3), spectator past 4 players, label stability when a player leaves, turn rotation, turn-pointer clamping, and reset. |
| [`test/socket.test.js`](test/socket.test.js) | **Socket integration tests** — a real Socket.IO server on an ephemeral port driven by `socket.io-client`: create/join, out-of-turn rejection, a move advancing the turn, turn-timeout auto-skip, and disconnect cleanup. |

## The invariants we guarantee

These are the properties the fuzz suite asserts across random games — they are
the heart of "the game stays consistent and ends correctly":

- **Orb conservation** — the total number of orbs on the board always equals the
  number of orbs placed. Orbs are never created or destroyed by an explosion.
- **Termination** — no cascade runs forever; every random game reaches a single
  winner within a bounded number of moves.
- **A legal move is never voided** — in particular, the *winning* move (which
  leaves a super-critical board) is recognised as a win instead of being
  discarded.
- **Single-winner end state** — a finished game has exactly one owner with orbs,
  and that owner is the reported winner.
- **Clean settling when possible** — a win reached at a low orb count settles to
  a stable board with no cell left at/over capacity. (At high orb counts the
  winning board is mathematically super-critical and cannot settle — this is
  expected and explained in the README.)
- **Opening guard** — no winner is declared before every player has made a move.

## How the engine is made testable

`Game.handleMove()` streams animation frames to clients over time (via
`setTimeout`) and needs a Socket.IO `io` object — awkward to unit-test. So the
pure logic is split out:

- **`Game.resolveMove(row, col, player)`** — synchronous, no sockets, no timers.
  It places the orb, runs the entire wave-based cascade, mutates the board, and
  returns `{ applied, truncated, gameWon, frames, explosions }`. The engine and
  invariant tests call this directly.
- **`Game.handleMove(...)`** — the live-play wrapper that calls `resolveMove()`
  and then streams the resulting frames to the room.

Timing is environment-configurable so socket tests run fast instead of waiting
real-world delays:

| Env var | Default | Tests use |
| --- | --- | --- |
| `TURN_DURATION_MS` | `30000` | `1000` (so the timeout/skip test is quick) |
| `FRAME_DELAY_MS` | `400` | `10` (stream cascades fast) |
| `LOG_LEVEL` | `INFO` | `SILENT` (keep test output clean) |

The socket test sets these at the top of the file **before** requiring the
server modules (they are read once at load time).

## Adding a new test

1. Create `test/<name>.test.js`.
2. Set a quiet log level at the very top, before any `require`:
   ```js
   process.env.LOG_LEVEL = process.env.LOG_LEVEL || "SILENT";
   const test = require("node:test");
   const assert = require("node:assert/strict");
   ```
3. Prefer `Game.resolveMove()` for engine assertions — it's synchronous and
   needs no fakes. Reserve socket tests for end-to-end event flows.
4. Run `npm run test:watch` while writing.

## Troubleshooting

- **A socket test times out** — a helper is probably waiting for an event that
  fires before its listener is attached. Register the `once(...)` promise
  *before* emitting the triggering event (the existing tests follow this order).
- **Logs clutter the output** — make sure `LOG_LEVEL=SILENT` is set before the
  first `require` in that test file.
- **The hook didn't run on commit** — confirm `git config core.hooksPath`
  returns `.githooks` (run `npm install` or set it manually).
