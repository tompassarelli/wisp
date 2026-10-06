# Frame cost

What each game frame costs, while developing: development and diagnostic
builds can show it on screen, every hot reload reports it before and after
the new version, and a headless run measures it in 32-bit Lua so CI can compare
two versions. GPU and render time, which Warcraft doesn't expose, are not
measured.

## The frame meter

[The frame meter](../src/platform/frameMeter.ts) (wisp:src/platform/frameMeter.ts)
measures every frame of a running map:

- **Lua time**: Lua's `os.clock` around each callback that runs through
  [dispatch](../src/platform/dispatch.ts), summed per frame. It includes the
  natives a callback calls, so it is the time the game's frame spends in the
  map's code. Without `os.clock` the meter reports no time.
- **Natives**: calls of every global function whose name starts with a
  capital letter: Warcraft's natives and Blizzard.j's functions. A Blizzard.j
  function counts once for itself and once for each native it calls.
- **Catch-up frames**: how far the game's simulation frame advanced during
  the frame.

A frame ends with each run of the handler the game names as its frame
handler, such as its 60 Hz timer's, and holds every callback since the
previous one ended. The meter's own work, ending a frame, the overlay and the
report, is outside the frames it measures.

### Clock precision

The meter finds the clock's step at start: the smallest change two reads in
a row show. Each frame's time is a sum of whole steps, so a frame's value is
within about one step per callback, while a mean over a window is much
finer. The overlay names the step. Warcraft's `os.clock` exists in the
signed-in clients: Smashcraft's native frame-cost benchmarks of 5 October
2026 timed with it (smashcraft:evidence/native-frame-cost-20261005), and
their totals were whole multiples of 1/1024 s, the spacing of binary32
numbers between 8192 and 16384, so the step grows as the game's clock value
does. Warcraft has no `debug` library, so the game counts no instructions;
headless runs do.

### Use it

Only development and diagnostic entries import the meter, so a build players
run carries none of it:

```ts
import { installFrameMeter, startFrameMeter } from "wisp/src/platform/frameMeter";

export function install(this: void): void {
  installGame(); // configureRuntime, installDispatch, handlers, installHotReload
  installFrameMeter();
}

export function start(this: void): void {
  startGame();
  startFrameMeter({ frame: "game.tick", simulationFrame: () => globalThis.__gameState?.frame ?? 0, toggle: "-dev perf" });
}
```

`installFrameMeter()` runs in every `install()`, after `installDispatch()`: a
reloaded bundle installs its own dispatch, which the meter measures again.
`startFrameMeter()` runs once at match start, in every client. It wraps the
capitalized globals once, creates the overlay's frame, hidden, on every
client, and registers the toggle's chat text for the first four players.

## The overlay

Typing the toggle shows or hides, for that player only, the medians and
maxima of the last 120 frames:

```text
frame cost, last 120 frames, median / max
Lua ms: 0.42 / 3.10 (clock step 0.98 ms)
natives: 312 / 498
catch-up frames: 1 / 4
```

It updates every 30 frames, twice a second. Its frame text and visibility are local
(`WISP_LOCAL_NATIVES`, wisp:src/headless/client.ts).

## After each hot reload

Each client keeps the frames of the version it runs. When a hot reload
installs a version, the last 120 frames of the previous one are the
**before** window and the frame that installed it counts for neither; once
the new version has played 120 frames, the **after** window, the client
writes both to `<file prefix>-perf-p<slot>.txt`
([formats](../src/runtime/frameCost.ts), wisp:src/runtime/frameCost.ts):

```text
frame cost v3 after v2 clock=977
before frames=120 lua=420/436.5/3100 natives=312/320.4/498 catchup=1/1.02/4
after frames=120 lua=510/530.2/3400 natives=340/350.1/520 catchup=1/1/1
```

Lua values are microseconds; each value is median/mean/max per frame.
`wisp hot --watch` and `wisp dev --data` read the reports
([FrameCosts](../scripts/wisp/frameCosts.ts), wisp:scripts/wisp/frameCosts.ts)
and print one line per client about two seconds after the reload:

```text
p0 frame cost v3 vs v2 (120 and 120 frames): Lua 0.44 -> 0.53 ms mean (+21%), max 3.10 -> 3.40 ms; natives 312 -> 340 median (+9%), max 498 -> 520; catch-up 1 -> 1 median, max 4 -> 1; REGRESSION over 20%: Lua time +21%
```

A version regresses when its mean Lua time rises by more than the threshold
and by more than a quarter of the clock's step, or its median native calls
rise by more than the threshold. The threshold is 20% unless the project's
`HotProject` sets `frameCostThreshold`. The windows are adjacent frames of the
same match, so a change in what the match is doing, such as a menu giving way
to a fight, moves them too.

## Headless

[runLuaPerf](../src/headless/luaPerf.ts) (wisp:src/headless/luaPerf.ts) plays
a journey with the map's compiled bundle in simulated clients in 32-bit Lua,
as [runLuaJourney](headless.md#in-32-bit-lua) does, and measures each
client's frames:

- **Lua instructions**: while a client runs a callback, a count hook counts
  every 100th instruction, restarted at each run, so a run counts its
  instructions rounded down to a multiple of 100. The emulated natives run on
  a coroutine of their own, without the hook, so only the map's instructions
  count. The same code and journey count the same on every run, unless the
  map's own work depends on the time, as the frame meter's does when it finds
  its clock's step or sorts times for a report.
- **Lua time**: `os.clock` while each client ran, less the time in natives,
  in microseconds. It includes the hook's cost and varies with the machine.
- **Natives**: every declared function's calls, local-only ones included.

It prints a heading and, per client and value, the start (before the first
frame), the total, and the median, mean and maximum per frame, here one
client of Smashcraft's development build in its 600-frame quick match, whose
maximum is the frame that loads a hot reload:

```text
frames 600 step 100 problems 0
p0 instructions start=1158900 total=51922600 median=47800 mean=86538 max=16184800
p0 lua-us start=57491 total=835408 median=831 mean=1392 max=184030
p0 natives start=111 total=104988 median=138 mean=175 max=7919
```

A game adds `perf` to its program with `makePerf`
(wisp:scripts/wisp/commands/perf.ts), naming the tsconfig and bundle of its
map and of a Lua program that calls `runLuaPerf(map, journey, arg[1], arg[2])`:

- `perf [--out FILE]` compiles both, runs the program with the 32-bit Lua
  that `LUA` names, prints the run and writes it to FILE.
- `perf compare A B [--threshold SHARE]` compares two runs per client and
  fails when B's mean or maximum instructions per frame, or its mean native
  calls per frame, exceed A's by more than the threshold, 5% by default, or
  when B's journey found a problem. Lua time is printed, not held to it.

For CI, run `perf --out` on both versions and `perf compare` the two files.

The headless count differs from the game's in one way: an emulated native is
a stub, so a Blizzard.j function counts once, without the natives it would
call.

## What it costs

Measured on Smashcraft's development build (smashcraft 2f29ab3 with the meter
started, Wisp 7bf4c5d) in its 600-frame headless quick match in 32-bit Lua,
three runs each, without other work on the machine. Instructions are each run's
own count; times are the runs' range.

| Player 0, per frame | Without the meter | Meter, overlay hidden | Overlay shown |
| --- | --- | --- | --- |
| Lua instructions, median | 46,800 | 47,800 | 47,800 |
| Lua instructions, mean | 84,866 | 86,538 (+2.0%) | 87,370 (+3.0%) |
| Lua µs, median | 798-814 | 831-849 | 830-843 |
| Lua µs, mean | 1,353-1,381 | 1,392-1,425 | 1,409-1,450 |
| Native calls, mean | 175 | 175 | 175 |

The meter adds about 1,700 instructions a frame; showing the overlay adds
about 830 more, one sort of its window every 30 frames. Starting the meter
costs about 89,500 instructions once. At these runs' Lua32 rate, 1,700
instructions are about 27 µs, 0.16% of a 60 Hz frame.
