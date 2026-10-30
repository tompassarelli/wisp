# Rollback netcode

`wisp/src/netcode/*` is the game-agnostic rollback netcode that Battlecraft
proved on two native LAN clients (battlecraft#3: both confirmed the same hit
frame and checksum). A game supplies its input row, a `RowCodec` for it and a
deterministic simulation; Wisp supplies everything between them. It names no
game and runs as plain TypeScript in Bun and in Warcraft's 32-bit Lua.

| Module | What it holds |
| --- | --- |
| `codec` | `RowCodec<Row>`: how a game's input row is made, copied, compared, held, flagged urgent, written to and read from the wire. |
| `frameRing` | A fixed ring of rows keyed by frame; a slot answers only for the frame it holds. |
| `ledger` | `InputLedger`: each player's accepted rows, how far each is known, who left and after which frame, and the receipt for every refusal. |
| `delay` | The ping-based input delay: an integer round trip EWMA, `oneWayFrames`, `autoDelay`, `nextDelay` with its 34 ms lowering hysteresis, `agreedDelay` and the host's manual override, `correctDelay` and `timeSyncWait`. All integers, so Bun and Lua32 decide alike. |
| `message` | `encodeMessage` and `decodeMessage`: a batch of consecutive frames as one text message of at most 200 bytes and 64 frames, each row written as a delta from the one before and runs of unchanged rows as a skip count. |
| `rate` | Slow-machine detection: a machine under 55 fps with 750 ms busy for 2 seconds is slow until 2 seconds are not. A game words its own warning. |
| `wire` | The 64-character alphabet, varints, signed varints and `WireReader`; a reader refuses non-minimal and over-limit values. |
| `session` | `createSession`, `tick`, `receive`, `leave`: prediction, rollback and confirmation. |

## What a game writes

A `RowCodec<Row>` with seven functions:

- `neutral()` makes an idle row; `copy(target, source)` and `same(a, b)` move
  and compare rows without allocating.
- `hold(target, previous)` makes the row a player is predicted to send after
  `previous`: a held key stays held, a one-frame press does not repeat.
- `urgent(row)` says a row must be sent now rather than at the next send
  interval, such as a button press.
- `write(row, previous)` and `read(reader, previous, target)` write and read a
  row as a delta from `previous`. `read` returns false for any text `write`
  would never produce, so every client takes or refuses a message alike.

A `Simulation<Row, State>` with the codec, `step(state, rows)` returning the
next state from one row per player (it must not change `state`: the session
keeps old states to roll back to), and `predicted(state)` and
`confirmed(state)` callbacks that receive each state the session computes.

## How it behaves

`tick(session, sim, settings, sample)` runs once per callback with the local
player's current row. It rolls back if a late row differed from the one
predicted, predicts up to `catchUp` frames ahead of the callbacks (holding
back when more than `window` frames past the slowest remote player), confirms
every frame all playing players' rows have reached, and returns a wire message
when one is due (`sendEvery` callbacks, or at once for an urgent row). The
caller sends that text, such as with `BlzSendSyncData`, and calls
`receive(session, sim, sender, wire)` with each message that arrives; the
returned `Receipt` says whether it was accepted or why it was refused.

Every client takes or refuses a row by the common confirmed frame alone, so
all ledgers hold the same rows and the confirmed states agree. `leave`
marks a player gone after their last accepted row; their later frames are
idle, and a prediction that held their last key rolls back.

`NET_SETTINGS` is `{ delay: 2, window: 24, sendEvery: 6, catchUp: 6 }`, the
values Battlecraft's native check ran with.

## How it is checked

`src/netcode/rowCodec.tests.ts` and `src/netcode/session.tests.ts` use a toy
move, fire and aim row. They check wire varints at their limits, that random
rows survive a message round trip within 200 bytes, that two sessions trading
rows over a late, bursty channel end with the confirmed state of the rows each
player really captured and a rolled-back prediction equal to it, and that a
player who leaves while holding a key is idle after their last accepted row.
`src/netcode/delay.tests.ts` checks the delay and rate rules against settled round trips, the lowering hysteresis, the host override and the second-by-second correction.
`test/netcode.test.ts` runs them in Bun, and `test/lua/index.ts` in 32-bit Lua
(`test/runtime.test.ts`, a farm test).

Battlecraft keeps its `InputRow`, its codec and its simulation. Smashcraft
keeps its own netcode until the migration planned in [online-plan.md](online-plan.md) lands.
