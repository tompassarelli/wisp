# Wisp

## Direction

Wisp verifies Warcraft III maps without waiting on Warcraft III, then plays
them without it ([wisp#75](https://github.com/tompassarelli/wisp/issues/75)).
Every verdict that is a number from the map's code (simulation, checksums,
timing, CPU cost, audio events, which model or effect shows when, where and
in what pose) runs on Wisp. Under M5, a look lever whose fidelity gate passes
gets its verdict on Wisp within its calibrated range, when that verdict is
outside the gate's error margin. Native truth runs on the Warcraft VM:
one spot check per lever per build for verdicts inside the error margin,
settings outside the calibrated range, or Popcorn-dependent appearance.
Unstable references are inconclusive; they never widen the gate's bounds.
The laptop runs only product proofs. Drive a native
client from inside (wisp:docs/driving-warcraft.md), never through the OS
keyboard or chat. The frontier is online play over Wisp's own transport (M3).
Measure the native side with exact reads before pixels: on offline 3.0.0
clients use the engine debugger's frame-number, state, checksum and cost
reads (wisp:docs/builds.md) and stack-trace builds, align frames by the read
frame number, and keep screenshots for appearance only.
A native check of a TypeScript-only change hot-reloads into the running
match (`wisp hot --watch`, wisp:docs/hot-reload.md) instead of rebuilding.

Before implementing a feature here or in a consuming map, consult the
[feature index](docs/index.md) (wisp:docs/index.md) for existing capabilities
and opt-in setup, especially TypeScript stack traces. A feature isn't done
until wisp:docs/index.md lists it and a how-it-works page in wisp:docs/
explains it, including each subcommand on its command's own page when it has one.

Wisp owns reusable Warcraft III TypeScript compilation, numeric guards,
hot reload, runtime error reporting and host services. Its existing TypeScript
source and immutable compiler/tool pins are declared in
wisp:typescript-toolchain.lock. Use Bun. Keep Effect in host code;
synchronized Lua code remains pure TypeScript and Warcraft native calls.

Every check gets one run on a commit: it passes, ship; a failure gets fixed
and run once more. Load-bearing rules get one run of the broader check (the
farm sweep or parity corpus), not repeats: Bun/Lua parity and determinism.

Read warcraft-modding and verification for
changes. The operator explicitly authorized extracting the existing framework;
the skill's earlier in-Smashcraft deferral does not apply to this extraction.
Host tools that Bun runs (commands, runners, builds, captures, farm jobs) are
written as Effect programs when they start processes, wait, retry, hold a
resource or parse outside data. Load the effect-development skill before
designing one, and follow the pattern and examples in
[Host tools](docs/host-tools.md) (wisp:docs/host-tools.md). Map code compiled to Lua stays plain
TypeScript; pure calculations stay plain functions.
Read the installed pinned Effect source before choosing its APIs. Runtime imports must resolve through
the installed package.

No Smashcraft source imports or filesystem dependencies. Games supply their
configuration, assets, map declaration and acceptance journeys. Keep proprietary
assets and binaries outside this repository. No releases are authorized.
Follow [the clean-room rules](docs/clean-room.md) (wisp:docs/clean-room.md, [wisp#75](https://github.com/tompassarelli/wisp/issues/75)).

Test cost: one test may run at most 280M Lua32 instructions in its Lua
children and step at most 80,000 headless frames, each about 4 s on a farm
runner (wisp:scripts/wisp/testCost.ts). Compilation is bounded only by the
60 s hang timeout: farm runners expose no instruction counter. Only Tom raises
the ceilings. `bun run test` fails a test over one, naming the file and
"shrink it or move it to the farm", and prints CPU without gating it. CI cost
gates measure deterministic quantities, never CPU seconds (wisp#114,
smashcraft#394) (wisp:docs/testing.md, "Test cost").

Main stays green. Each CI run on main opens, updates or closes the one
"main is red" issue, which lists the failing tests and the first failing
commit, and every push prints that list (wisp:docs/ci.md, "Main stays green").
A red main is not "already failing": if your commit broke it, fix it first.

Use owned lanes, named staging and safe-push. Preserve current immutable pins.
Native client control belongs to the accountable parent run for this extraction.
