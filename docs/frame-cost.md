# Frame cost

What each game frame costs, while developing: development and diagnostic
builds can show it on screen, every hot reload reports it before and after
the new version, and a headless run measures it in 32-bit Lua so CI can compare
two versions. GPU and render time, which Warcraft doesn't expose, are not
measured.

## The frame meter

[The frame meter](../src/map/frameMeter.ts) (wisp:src/map/frameMeter.ts)
measures every frame of a running map:

- **Lua time**: Lua's `os.clock` around each callback that runs through
  [dispatch](../src/map/dispatch.ts), summed per frame. It includes the
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
import { installFrameMeter, startFrameMeter } from "wisp/src/map/frameMeter";

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

### A bounded native capture

`startFrameCostCapture(frames)` records the next 1–18,000 frame callbacks using
the already-running meter. It skips the callback that requested it, so setup
does not enter its sample. It creates no Warcraft handles, and changes no game
state. Eighteen thousand callbacks cover five minutes at 60 Hz; the receipt
also records elapsed clock milliseconds, so callback count alone is not a claim
about elapsed time. Starting another capture while one runs is an error.

After the last measured callback, every client writes
`<prefix>-perf-capture-p<slot>-run<run>.txt` using the filename and line format in
wisp:src/runtime/frameCostCapture.ts. The receipt contains the clock step,
elapsed time, code version, the section names, and every callback's Lua
microseconds, native count, simulation catch-up, Lua heap change in KB
(`collectgarbage("count")` after minus before each measured callback, so
negative when the collector freed more than the frame allocated; `none`
without `collectgarbage`) and each section's microseconds. It retains the
complete sample in bounded arrays; there is no file output or sorting during
the sample. Report generation is
outside the sample and should not share a timing-sensitive subsequent trial.

The host's `parseFrameCostCapture(text)` and `captureDistribution(capture)`
(wisp:host/perf/frameCostCapture.ts) return full-run median, p95, p99 and worst
callback cost in microseconds. Percentiles use nearest rank; an even sample's
median is the mean of its two middle values. The parser rejects incomplete or
reordered samples, unavailable clocks and captures that crossed a hot reload.
Native session tooling must additionally reject crashes, desyncs, early results
and the wrong gameplay phase, as with any native measurement.

### Frame sections

`startFrameMeter({ ..., sections: ["reconcile", "step", "render"] })` names
the frame's sections (lowercase letters, digits and hyphens, unique).
Game code brackets each with `beginFrameSection(index)` and
`endFrameSection(index)` from wisp:src/map/frameSections.ts, where `index` is
the name's position. The calls add `os.clock` time to the section's total for
the frame; a section may run several times a frame and its times add up.
Sections are flat: don't nest one inside another, or the parent counts the
child too. Time outside every section is the table's `other` row.

The module has no imports, so a build without the meter can keep the calls:
with no meter, or no capture running, a call reads one module local and one
field and returns. It allocates nothing and builds no strings; only a
running capture reads the clock in them. Measure what they add with
`perf compare` on runs before and after the calls.

`wisp perf sections RECEIPT` prints, per section, the median, p95, p99 and
worst milliseconds, and its share of the Lua time of the worst 1% of frames
(ranked by total Lua time), followed by `other`, `total` and the heap change
in KB. RECEIPT is a native `<prefix>-perf-capture-p<slot>-run<run>.txt` or a
headless perf run's output whose lines read `p<slot> capture: <receipt line>`
(`--slot N`, default 0). `--json` prints the same table as one result. The
host functions are `sectionTable(capture)` and `sectionTableLines(table)`.

`perf native CAPTURE.txt RUN --samples HEADLESS.perf` accepts the raw receipt
directly. It constructs the same 120-frame windows, every 30 frames, from
**observed** costs; only predicted costs are resampled into whole clock steps.
This provides native p50/p95 readings without OCR. The native and headless
samples must still exercise the same candidate, workload and starting frame.
GPU/render times remain outside the script-cost meter's scope.

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
([FrameCosts](../host/perf/frameCosts.ts), wisp:host/perf/frameCosts.ts)
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
- **Instructions and allocated KB** count only the map's code: the count hook
  looks at the function it interrupted every 100 instructions and charges
  that step and the allocation since the last step to the map's bundle or to
  Wisp's headless runtime, which prints as its own rows (`runtime-instructions`,
  `runtime-alloc-kb`). The map's allocation is also split by bundle module
  (`pSLOT module-alloc-bytes MODULE total=... mean=...`, bytes per frame),
  and the hook's own allocation is left out of both: Wisp's Lua32 charges
  nothing while a hook runs, including the event name string Lua pushes
  before calling it, which counted 30 B per hook call (0.30 B per instruction
  at a step of 100) until Wisp 0.0.x of 20 October 2026. Allocation-free code
  requests 0 B under a hook every 1, 100 or 1000 instructions, in a coroutine
  too, and 1000 new tables request 1000 times one table
  (wisp:test/requested-bytes.test.ts).
- **Allocation by function**: `allocationSampler()` (wisp:src/headless/luaPerf.ts)
  hooks every instruction between a `ClientScope`'s `enter` and `leave` and
  charges each instruction's requested bytes to the map function that ran
  it (self) and to every distinct map function on its stack (inclusive),
  keyed by the line the function is defined on. Bytes requested in Wisp's
  headless runtime, emulated natives included, go to `OUTSIDE_MAP` (-1),
  never to the map function that called the native. A fixture charging 50
  tables a frame is charged exactly 50 tables a frame, its caller nothing of
  its own, and an allocation-free function nothing (wisp:test/alloc-profile.test.ts).
  A game's profiler maps the lines to names, as Smashcraft's
  `perf profile RUN --alloc` does.
- **Allocated KB**: the bytes the map's code asked for, which Wisp's Lua32
  counts (`collectgarbage("requested")`, [Lua32 builds](headless.md#raw-float-rounding)):
  each new object at its requested size, each table resize at its parts' net
  growth (what the new parts add over the parts they replace, as Lua's
  collector debt counts it), and each string the code builds at its size even
  when an equal string is already interned.
  It leaves out the string table, stacks and call frames, which the collector
  shrinks and the next request regrows. So a frame's figure depends neither on
  what else the program holds nor on when the heap was last collected: an
  inert, never-called function moves no frame (wisp:test/requested-bytes.test.ts),
  where a heap delta once moved single frames by up to 8 KB at equal
  instruction counts (smashcraft#26). Automatic collection stays stopped
  throughout profiling, including between client callbacks. Between callbacks
  it explicitly collects once the heap has doubled since the last collection,
  or grown 16 MB if that is more, so collection time follows allocation
  rather than allocation times the live heap, and reports those
  collections' time per kilobyte freed (`collector us=... kb=...`). Profiling
  restores automatic collection on exit, and needs Wisp's Lua32: another Lua
  fails at `collectgarbage("requested")`.
- **Typed characters**: text the driver says reached the client's edit box
  before the frame (`measure.typed(slot, characters)`).
- **Predicted native time** (`native-us`, `typing-us`): the frame's cost in
  Warcraft by the [model](#predicted-native-cost), the map's callbacks and the
  edit-box stall apart.

It prints a heading and, per client and value, the start (before the first
frame), the total, and the median, 95th percentile, mean, maximum and top 1%
mean (the mean of the worst 1% of frames, at least one) per frame, here one client of Smashcraft's native bot session's four-fighter
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
(wisp:host/commands/perf.ts), naming the tsconfig and bundle of its
map, a Lua program that calls `runLuaPerf` or `runLuaPerfWith` with
`arg[1]` and `arg[2]`, the name of its default run and its other runs, each
with the map it measures. The program gets the run's name, the frames to
play and `samples` as its next arguments.

- `perf [RUN] [--frames N] [--samples] [--out FILE]` compiles the run's map
  and the program, runs it in the 32-bit Lua that `LUA` names (else the cached pinned one,
  [lua32](headless.md#raw-float-rounding)), prints the
  run and each client's predicted native cost per frame, and writes the run
  to FILE; for the run above:

  ```text
  p0 predicted native per frame: 4.89 ms p50, 20.17 ms p95, 57.94 ms worst; typing stall 1.80 ms worst
  ```

- `perf RUN --incremental-gc` (`collector: "incremental"` in the options, or
  `WISP_PERF_COLLECTOR=incremental` for the program) leaves Lua's collector
  in its normal incremental mode, as Warcraft runs it, with no count hook and
  no explicit collections, so a callback's time includes whatever collector
  steps and atomic phases its allocations triggered. Instructions read zero;
  Lua time, natives and allocated KB still print. It adds each client's
  callback times, natives and collector work included
  (`callback pSLOT count=... median-us=... p99-us=... max-us=... over-100ms=...`),
  and one timed collection cycle of the final heap in default-size steps
  (`cycle kb=... steps=... us=... step-median-us=... step-max-us=...`); the
  longest step holds the atomic phase.

- `perf compare A B [--threshold SHARE]` compares two runs per client and
  fails when, beyond the threshold (5% by default), B's instructions rise at
  their mean or top 1% mean, its native calls at their mean, its allocation at
  its mean or 95th percentile, its predicted native time at its median or
  95th percentile, or its typing stall at its top 1% mean; or when B's run
  found a problem. It prints every module's mean allocation per frame, A to
  B, and an allocation failure names the modules that grew most. No gate reads a single worst frame: which frame is worst
  moves whenever a bot's choices change (smashcraft#394). A run written
  before `top=` existed compares its maximum in its place. Each of these is made from counts, so the same code compares
  alike on any machine; Lua time is printed, not held to it.

Add `--json` to `perf`, `perf compare`, `perf native`, or `perf fit` for
JSON Lines on stdout. Each measurement is a `result` with `schema: 1` and
`command` (`perf`, `perf compare`, `perf native`, or `perf fit`). Headless
measurements include `name`, `frames`, `step`, `problems`, `collector` and a
`clients` array of `{client, metrics}`. Comparisons include `before`, `after`,
`threshold` and `regressions`. Native checks include the `model`, `native`,
`predicted`, `errors` and `passed`; fitted cases also name `fit` as `all` or
`held-out`. Samples still go to `--out FILE`, rather than JSON stdout.

Failures print a `failure` with `kind` (`error`, `check-fail`, or `budget`),
`frame: null`, `client: null` and `message`. The last line is always a
`summary` with `schema: 1`, `command`, `ok`, `counts: {results, failures}` and
`elapsedMs`; a failed command keeps its nonzero exit code. Text output is
unchanged when `--json` is absent.

For CI, run `perf --out` on both versions and `perf compare` the two files.
Smashcraft's 0.0.48 four-fighter match against 0.0.49's fails it on
allocation, its mean up 273% and its 95th percentile 501%: 0.0.48's binary32
arithmetic still allocated.

`wisp headless --cost` (wisp:host/commands/headless.ts) plays the
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
| Collector | 2 µs per KB | fitted to the same, on allocation counts that still included the hook's 30 B per 100 instructions (Smashcraft's rollback-four median frame read 84 KB with it and reads 16 KB without); the host's own full collections cost 7 µs per KB |
| Typing | 0.5 µs per character squared | 608 characters held a client about 180 ms (smashcraft#48) |

The collector term is not refitted yet. Against the native collector
alone, Smashcraft's four-fighter rollback match collects for 10–16 ms
about once a minute while each client requests a mean 20 KB a frame
(72 MB a minute at 60 frames a second): about 0.2 µs per KB amortized,
a tenth of the fitted 2 µs. But Warcraft pays that cost in one frame, not
spread over the frames that allocated it, so the per-frame term can't model
those pauses at any value, and `perf fit` refits it only from the
retained #19 native readings with their headless samples regenerated under
hook-free counts, which the [acceptance below](#wisp-only-acceptance) then rechecks.

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

[nativeFit](../host/perf/nativeFit.ts) (wisp:host/perf/nativeFit.ts)
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

### Wisp-only acceptance

The existing `perf native` and `perf compare` gates provide acceptance without
Warcraft. Check the unchanged `WARCRAFT_COST` against every retained reference,
then compare the candidate with its published baseline. The command below
exits nonzero if either reference misses native p50/p95 by over 20% or the
candidate regresses beyond the comparison threshold (5% by default). Each
check reads saved files and starts no Warcraft client. `--json` gives the
measured comparisons and their pass/fail summaries for a saved report.

Smashcraft's retained #19 references were recorded on 7 October 2026 at
`4ec5b823`, with Wisp's current cost constants, on a quiet machine. They cover
the integrity build's solo bot and four-fighter bot workloads, player 0,
1,800 callbacks each. The 57 windows compare callback p50/p95, using the native
clock steps; this calibration does not cover GPU/render time, native RSS,
or native p99. A candidate's computed p99 and worst prediction remain useful
diagnostics, but #19's 20% guarantee applies to p50 and p95 at this scope.

From Smashcraft's `ts/`, first save the current candidate:

```sh
bun wisp perf playable-bot-four --samples --out build/frame-cost-candidate.perf
```

Then accept it against the published baseline and unchanged retained inputs:

```sh
cost_refs="$HOME/.local/state/smashcraft/wisp19-20261007/4ec5b823"
bun wisp perf native "$cost_refs/exclusive-1791383217845/bot-native-p0.txt" \
  --samples "$cost_refs/bot.perf" --json &&
bun wisp perf native "$cost_refs/exclusive-1791383217845/bot-four-native-p0.txt" \
  --samples "$cost_refs/bot-four.perf" --json &&
bun wisp perf compare test/fixtures/perf/playable-bot-four.perf \
  build/frame-cost-candidate.perf --json
```

The references predict solo p50 7.00 ms against 8.00 ms (-12.5%), p95
20.99 ms against 21.00 ms (-0.04%); four-fighter p50 9.06 ms against
8.00 ms (+13.36%), p95 26.18 ms against 28.99 ms (-9.68%). Each is within
20%. The native files stay in private local storage; do not recreate native
timing from headless event counts. Other workloads or hardware need their own
matched reference before inheriting this calibration claim.

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
