# Soak: automatic playtesters

`wisp soak` plays many matches of a map in [headless clients](headless.md),
faster than real time, with the game's computers and a fuzzed controller as
the players, and reports what a playtest would find: a match that stops, a
desync, an error report, something wrong in what a player sees, a fighter
drawn with nothing, and frames that cost more than real time allows or a
catch-up that never ends. Every match repeats from its seed, and every
finding keeps a repro file that plays its match again.

It runs in worker processes, at most four, and stops starting matches after
a time limit, ten minutes unless told otherwise and thirty at most, so a run
can't take the machine by accident. Run it inside your machine's capacity
scope; without `--workers` it uses the CPUs that scope allows, up to four.

## A game's soak

A project declares its soak in a module whose default export `defineSoak()`
makes (wisp:scripts/wisp/soak.ts), and adds the command with `makeSoak`
(wisp:scripts/wisp/commands/soak.ts):

```ts
export default defineSoak({
  name: "mygame",
  map: MY_HEADLESS_MAP,
  // Loaded only by the worker processes: the map entry and how a match is set up.
  game: join(import.meta.dir, "../test/soak/game.ts"),
  scene: MY_SCENE,
  roster: { fighters: ["knight", "archer"], stages: ["field"], policies: [["fuzz", "cpu"], ["cpu", "cpu"]] },
  controller: { buttons: ["jump", "attack"], axes: ["x"], axisLimit: 127, deadZone: 30 },
  frames: 4800,
  matches: 200,
});
```

A run plans its matches from the roster: every ordered pair of fighters on
every stage, then all of them again with the next pair of policies, each
match with its own seed. `--fighter`, `--stage` and `--policy` keep only
matches with that fighter, stage or policy.

The game module's default export, made with `defineSoakGame()`, names the
map entry the clients start (the build players run, with the scene recorder
when the soak checks scenes) and `begin(clients, match)`, which takes the
started clients through the game's menus to the match and returns its
driver. It loads only in the worker processes, so map code stays out of the
project's host type check. The driver:

- `input(step)`: before each frame, what each player's input source sends:
  the fuzzed slots' controller edges, the slots that send nothing now, and
  the wall clock in milliseconds;
- `observe(client)`: after each frame, in each client: the confirmed frame
  while the match should advance (undefined in menus, at the result or in a
  pause), what tells the player why it waits, the frames of input not yet
  played, and whether the match is over;
- `confirmed(client)`, optional: the confirmed state's frame and hash;
- `bodies(client)`, optional: what the player must see now, such as each
  fighter in play with the models it may be drawn with;
- `repro(client)`, optional: the game's repro of the moments before a
  finding ([repro files](#repro-files));
- `typed(slot)`, optional: the characters the player's input helper typed
  into their client's edit box before this frame, which Warcraft takes at a
  cost that grows with their square;
- `findings(client)`, optional: after each frame, what the game's own
  detectors found, each with its detector's name, such as a fighter caught
  in a loop it can't escape.

A policy is a name the game interprets, such as its computer or a human
whose input never arrives; `fuzz` is Wisp's input fuzzer.

## The fuzzer and the clock

The fuzzer is seeded per match and slot. It plays patterns that probe a
controller's edges: a press and release within one frame, holds from one
frame to a second and a half, chords of two or three buttons, mashing, the
stick flicked to the rim and back, swept across its range and jittered in
and out of the dead zone, a direction and a button on the same frame,
everything let go at once, and each `toggles` button (such as a pause)
pressed twice a moment apart. Now and then a player's input source goes
quiet for a quarter second to three seconds, and the whole game stops for
up to two seconds, as in a lag spike.

The game's wall clock gains 1/60 s per frame, more when a client's frame
cost more than that, and the length of each lag spike. A client frame's
cost is Warcraft's as the [model](frame-cost.md#predicted-native-cost)
predicts what Bun can measure: its thread's CPU time times the soak's
`costScale`, each native call, and the edit-box stall of the text typed
before it (the driver's `typed`, or what a typed match's helpers typed). A
burst of hundreds of characters stops the game as long as Warcraft would. The
players' input sources, such as a journal helper's stand-in, live on that
clock, so a frame that costs too much leaves input waiting, as it does in the
game. The clients still run as fast as the process can run them:
Smashcraft's 200-match soak played 57 game minutes in 46 s with four workers
and 241 s of CPU (6 October 2026).

A match repeats exactly from its seed while every frame stays within its
1/60 s. Its repro file also keeps how much each costlier frame took, so a
replay runs on the same clock whatever the replaying machine measures.

## Detectors

| Finding | Reported when |
| --- | --- |
| `stall` | No client's confirmed frame advances for 3 s while the match should run, and no player is told why; or it stays stopped 3 s after every player's input arrives again, whatever the players are told. |
| `desync` | The clients' native calls differ (the headless desync guard), or their confirmed states differ at the same confirmed frame. |
| `error` | A client writes an error report, with the TypeScript stack the host kept. |
| `scene` | A client's scene report shows a [player view](player-view.md) problem: no stage, an effect without a model, one lingering past its lifetime, hidden effects still showing particles or parked where a camera sees them. |
| `invisible` | Two scene reports in a row show nothing drawn with geometry for a body the game says is in play (`bodyProblems`, wisp:scripts/wisp/scene.ts): no effect of its models drawn, or only models whose facts have no triangles. |
| `cost` | A client frame's own work costs more than 1/60 s, as predicted natively (CPU time times `costScale` and native calls), and costs that much again at the same frame when the soak replays the match on the same clock: a collection or a compile that lands on a frame doesn't count. A worker's first 1200 frames, which compile the map's code, don't count either. |
| `typing` | A recovery typing stall, a client frame that stops longer than 1/60 s taking typed text (by the model's edit-box stall for the characters typed before it), is over its budget, `typingMs`: 1/60 s unless the game declares the bound its input helper types within. |
| `catch-up` | The wall clock runs more than 1 s ahead of the game and the gap grows for 3 s in a row; or, while no input source is quiet, input not yet played grows for 3 s while past 60 frames, or stays past 60 frames for 3 s. |
| `unfinished` | The match isn't over within its frames. |
| `crash` | The game's setup or driver throws, or a worker process stops. |
| `game` | The driver's `findings(client)` names something one of the game's own detectors found; each detector reports once per match and client. |

Each kind of problem is reported once per match and client, with the frame
after the match began. `limits` in the declaration change the thresholds
(`SOAK_LIMITS`).

## Repro files

A match with findings writes `OUT/match-N.json` (`SoakRepro`): the match
(fighters, stage, policies, seed, frames), its findings, each client's native
call checksum and its inputs: every fuzzed edge, quiet spell, lag spike and
costlier frame by frame. `soak --repro FILE` plays it again in this process
and prints its findings and whether the native call checksums equal the
recorded ones.

A game that saves [repros](repro.md) gives its driver `repro(client)`: at a
match's first finding the soak asks each client for the lines its repro key
would save, the moments before the finding, and keeps them as
`OUT/match-N-pSLOT.txt`, a file `wisp repro` replays and turns into a test.

## Through a game's own input helper

`SoakMonitor` is the soak's detectors without its clock: a game that drives
headless clients in real time through its real input helper
([input from another program](headless.md#input-from-another-program)) calls
`afterFrame` from `RealtimeClients`' frame hook and `finish()` at the end,
and turns the fuzzer's edges (`fuzzedInputs`) into its helper's device
input, at a rate real time allows.

The fuzzer's edges reach such a match's clients only through the helpers, in
the helpers' own units, so they can't replay it. `helperRecorder` wraps each
player's typed text and CustomMapData and records what the helpers typed and
which of their files the map read, by frame (0 before the match began);
the match is marked `typed`.
`soak --repro` plays a typed match without the helpers or their devices: it
types the recorded text and publishes the recorded files before their
frames, as `RealtimeClients` delivered them, and gives the game's driver no
edges. A game's `begin` keeps its own input sources quiet in a typed match.

## Output and cost

Each finding prints with its match and repro file as it arrives. The run
ends with the matches and frames played, the game minutes they were, the
wall time and the real-time factor, the CPU every process used, and the
costliest client frame, and its recovery typing stalls: how many client
frames stopped longer than 1/60 s taking typed text, the worst, the 95th
percentile and how many went over the `typingMs` budget, each of which is
also a `typing` finding. `soak --repro` prints the same for its match. It
exits 1 on any finding or when its time limit
stopped it before every match played.

## Boundaries

A soak runs the headless runtime, so its findings and its limits are that
runtime's: no engine timing, rendering or real devices. Per-frame cost is
the TypeScript's in Bun scaled, not Warcraft's Lua and engine; a game sets
`costScale` from its own measurements to judge it in native terms, and
`wisp perf` predicts Warcraft's cost from 32-bit Lua, allocation included. The
fuzzer finds what random edges reach; it makes no balance or feel judgments.

## JSON results

Add `--json` to a soak run or `soak --repro FILE` to write JSON Lines to
stdout. Step timings and the final error message stay on stderr. Without
`--json`, the usual output stays unchanged.

Each completed match writes one `type: "result"` record with `ok`, `match`
(including its seed), `frames`, `wallMs`, `costMs`, `worstFrameMs`, and
`checksums`. Each finding writes a `type: "failure"` record with `kind`,
`frame`, `client`, `message`, and `match`; `repro` names its saved repro when
available. Missing frame or client values are `null`.

Failure kinds are `desync`, `error` (including crashes), `scene` (including
invisible fighters), `budget` (frame cost, typing, catch-up, or the run's time
limit), and `check-fail` (stalls, unfinished matches, or game checks).
The last line is always a `type: "summary"` record with `ok`,
`counts: { results, failures }`, and monotonic `elapsedMs`. All records have
`schema: 1` and `command: "soak"`. Findings and load errors keep the existing
nonzero exit code.
