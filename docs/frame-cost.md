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

Typing the toggle shows or hides, for that player only, the medians, 95th
percentiles and maxima of the last 120 frames:

```text
frame cost, last 120 frames, median / p95 / max
Lua ms: 0.42 / 1.95 / 3.10 (clock step 0.98 ms)
natives: 312 / 470 / 498
catch-up frames: 1 / 1 / 4
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
client's frames; `runLuaPerfWith(map, bundle, declarations, play, options)`
measures a game's own driver instead, such as a match set up through its
menus with input helpers typing, and `measure.begin()` counts frames from the
one after it, such as a match's first:

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
- **Allocated KB**: what the map's code allocated. The collector stops while
  a client runs, so Lua time holds none of its work; between runs it collects
  once the heap has grown 16 MB, and the run reports those collections' time
  per kilobyte (`collector us=... kb=...`).
- **Typed characters**: text the driver says reached the client's edit box
  before the frame (`measure.typed(slot, characters)`).
- **Predicted native time** (`native-us`, `typing-us`): the frame's cost in
  Warcraft by the [model](#predicted-native-cost), the map's callbacks and the
  edit-box stall apart.

It prints a heading and, per client and value, the start (before the first
frame), the total, and the median, 95th percentile, mean and maximum per
frame, here one client of Smashcraft's native bot session's four-fighter
match (`bun wisp perf bot-four`, 1800 frames), counted from its first frame:

```text
frames 1800 step 100 problems 0
collector us=1132990 kb=183545
p0 instructions start=1220800 total=509878400 median=212600 p95=847100 mean=283266 max=2664800
p0 lua-us start=68161 total=9104176 median=3860 p95=15385 mean=5058 max=39151
p0 natives start=111 total=444483 median=156 p95=347 mean=247 max=2335
p0 alloc-kb start=14930 total=80789 median=15 p95=108 mean=45 max=721
p0 typed start=0 total=37561 median=0 p95=51 mean=21 max=60
p0 native-us start=56077 total=11907900 median=4890 p95=20167 mean=6616 max=57943
p0 typing-us start=0 total=802055 median=0 p95=1301 mean=446 max=1800
```

With `samples`, it also prints every client's every frame
(`frame F pSLOT instructions=... lua-us=... natives=... alloc-bytes=... typed=...`),
from which a model is fitted.

A game adds `perf` to its program with `makePerf`
(wisp:scripts/wisp/commands/perf.ts), naming the tsconfig and bundle of its
map, a Lua program that calls `runLuaPerf` or `runLuaPerfWith` with
`arg[1]` and `arg[2]`, the name of its default run and its other runs, each
with the map it measures. The program gets the run's name, the frames to
play and `samples` as its next arguments.

- `perf [RUN] [--frames N] [--samples] [--out FILE]` compiles the run's map
  and the program, runs it with the 32-bit Lua that `LUA` names, prints the
  run and each client's predicted native cost per frame, and writes the run
  to FILE; for the run above:

  ```text
  p0 predicted native per frame: 4.89 ms p50, 20.17 ms p95, 57.94 ms worst; typing stall 1.80 ms worst
  ```

- `perf compare A B [--threshold SHARE]` compares two runs per client and
  fails when, beyond the threshold (5% by default), B's instructions rise at
  their mean or maximum, its native calls at their mean, its allocation at
  its mean or 95th percentile, its predicted native time at its median or
  95th percentile, or its worst typing stall; or when B's run found a
  problem. Each of these is made from counts, so the same code compares
  alike on any machine; Lua time is printed, not held to it.

For CI, run `perf --out` on both versions and `perf compare` the two files.
Smashcraft's 0.0.48 four-fighter match against 0.0.49's fails it on
allocation, its mean up 273% and its 95th percentile 501%: 0.0.48's binary32
arithmetic still allocated.

`wisp headless --cost` (wisp:scripts/wisp/commands/headless.ts) plays the
journey in Bun as usual, then the perf program's run of the same name, and
prints the predicted native cost per frame too.

The headless count differs from the game's in one way: an emulated native is
a stub, so a Blizzard.j function counts once, without the natives it would
call.

## Predicted native cost

[nativeFrameCost](../src/headless/nativeCost.ts) (wisp:src/headless/nativeCost.ts)
turns what a headless frame did into what it would cost in Warcraft:

- the map's callbacks: its Lua instructions at the development host's 32-bit
  Lua rate times Warcraft's Lua speed factor, plus a cost per native call and
  a collector cost per kilobyte allocated: what the frame meter's Lua time
  measures natively;
- the edit-box stall: Warcraft takes typed text at a cost that grows with the
  square of the characters it takes at once, outside the callbacks.

The Lua term counts instructions, not time, so a prediction is the same on
every run and every machine. `WARCRAFT_COST` holds the measured constants:

| Term | Value | From |
| --- | --- | --- |
| Host 32-bit Lua | 18.2 µs per 1000 instructions | Smashcraft's four-fighter bot match on the development host (6 October 2026) |
| Lua speed factor | 1.17 | Smashcraft's 4096-frame workload, Warcraft against the same host's Lua32 (smashcraft:evidence/native-frame-cost-20261005) |
| Native call | 2 µs | fitted to Smashcraft 0.0.49's four-fighter overlay |
| Collector | 2 µs per KB | fitted to the same; the host's own full collections cost 7 µs per KB |
| Typing | 0.5 µs per character squared | 608 characters held a client about 180 ms (smashcraft#48) |

Checked against the frame meter's overlay in the native bot session's
four-fighter rematch (median and maximum of every 120 frames), with the
headless frames replayed through the same windows, its 1 ms clock steps
included:

| Build | Native median frame | Predicted | Native worst frame, median window | Predicted |
| --- | --- | --- | --- | --- |
| 0.0.49 (fitted) | 5.0 ms (windows 3.5–6.0) | 4.9 ms | 48 ms (30–105) | 52 ms |
| 0.0.48 | 4.0 ms (windows 3.1–4.9) | 4.6 ms | 35 ms (18–66) | 50 ms |

Each frame's median is within 20% on both builds; 0.0.48's worst frames are
predicted 40% high. Those overlays showed no 95th percentile, so the
overlay shows it now. The meter's native clock is likely wall time (Windows'
`clock()`), so a reading taken while the machine runs other work is
inflated; calibrate on a quiet machine.

### Checking against Warcraft

[nativeFit](../scripts/wisp/nativeFit.ts) (wisp:scripts/wisp/nativeFit.ts)
compares a prediction with the overlay of a native run of the same build.
It replays the headless run's frames (`perf --samples`) through the
overlay's windows (120 frames, read every 30) and reads each frame's
predicted time as a whole number of the native clock's steps. A time
between two steps reads as either one, in proportion to where it falls,
with a fixed seed. It then compares the median across windows of each
window's median, 95th percentile and maximum:

- `perf native READINGS [RUN] [--samples FILE] [--slot N]` plays RUN, or
  reads `--samples`, and prints native against predicted per frame. It fails
  unless the median and the 95th percentile are both within 20%, so
  readings without a 95th percentile can't pass. READINGS is JSON:
  `{clockStepMs?, windows: [{median, p95?, max}]}` in ms, or a game's
  session result holding `frame_cost_overlay.windows[].lua_ms`, such as
  Smashcraft's `bot-result.json`. The clock step defaults to Warcraft's
  0.977 ms. Run it from the source the native build was made from: the
  prediction comes from that source's frames.
- `perf fit SAMPLES=READINGS ...` fits the native call and collector costs
  to every case: a 0.25 µs grid, minimizing squared log ratios of the median
  and the 95th percentile, plus a quarter weight on the maximum, because a
  window's maximum is one frame. The Lua speed factor, the host rate and
  typing keep their separate measurements. With two or more cases it also
  fits each case's costs to the others and reports that case held out.

Three summaries don't pin both costs on a 1 ms clock when a frame's native
calls rise with its Lua work, as they do in a match. A fit is judged by
what it predicts on readings it wasn't fitted to.

The four-fighter overlays of Smashcraft 0.0.48 and 0.0.49 show only medians
and maxima (smashcraft:evidence/cost-model-20261007). On the 1 ms clock,
their medians don't move with either cost, so the fit follows the maxima and
drives both costs to 0. `WARCRAFT_COST` keeps 2 and 2 until readings with a
95th percentile exist. Predicted median, native → predicted: 0.0.49 5.00 →
5.00 ms, and 0.0.48 3.97 → 4.40 ms (+11%) held out. Predicted maximum:
0.0.49 +6%, 0.0.48 +60%.

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
