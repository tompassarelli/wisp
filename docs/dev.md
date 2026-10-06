# The dev loop: `wisp dev`

One long-running command answers every save. It keeps a TypeScript checker,
the project's test graph, test processes and a headless journey process warm,
and on each save prints three signals, each with its time since the save, and
then the whole type check:

```text
saved src/game/presentation/impactState.ts
   0.060 s  types: no errors in src/game/presentation/impactState.ts
   0.633 s  unit tests: 86 passed (18 test files of 99 affected; test/source-shapes.test.ts checked only the saved files)
   2.025 s  journeys: quick-match passed; 17 journey tests: 17 passed (8 test files of 99 affected)
   2.793 s  types: no errors in the project
```

- **types**: the saved files' type errors, `file:line:column TSxxxx message`.
- **unit tests**: the affected tests that aren't journeys.
- **journeys**: the project's own headless journey and the affected tests that
  play journeys in simulated clients. The journey's report (calls, desync,
  reload, scene) prints when it found a problem.

A failing test prints as soon as its process ends (`FAIL file > test: why`),
before its signal's line. A new save stops the previous save's work; a hot reload
already sending finishes first. With `--data DIR --data DIR`, each save also
hot-reloads the map into those clients exactly as `hot --watch` does
([hot reload](hot-reload.md)), and in-game error reports, desyncs and each
reload's [frame cost](frame-cost.md#after-each-hot-reload) print as they appear.

## Declare it

A project adds the command with `makeDev` (wisp:scripts/wisp/commands/dev.ts).
Paths and globs are relative to `root`:

```ts
export const dev = makeDev({
  root: tsDirectory,
  sources: ["src", "scripts", "test"],
  typeCheck: { projects: ["tsconfig.json", "tsconfig.game.json"], command: [process.execPath, "run", "check"] },
  tests: {
    files: ["{src,scripts,test}/**/*.test.ts"],
    registry: "src/**/*.tests.ts",
    registryRunners: ["test/game.test.ts"],
    preload: ["test/host-natives.ts"],
    reads: { "test/source-shapes.test.ts": ["src/**/*.ts"] },
    journeys: ["test/desync-guard.test.ts", "test/desync-guard-integrity.test.ts"],
    perFile: ["test/source-shapes.test.ts"],
    warm: { "test/source-shapes.test.ts": ["typescript"] },
    isolated: [["test/desync-guard.test.ts", "test/desync-guard-integrity.test.ts"]],
    env: { BUN_JSC_useFTLJIT: "false" },
  },
  journey: { module: "scripts/wisp/journeys.ts", export: "MY_JOURNEYS", name: "quick-match" },
  hot: { project, sourceDirectory, sourceMapDirectory, filePrefix: "mygame" },
});
```

- `sources` are watched recursively; a save of the root's tsconfig, package or
  lock files reruns every test and rereads the projects. A package change
  needs `wisp dev` restarted to load the new packages.
- `typeCheck.projects` are checked file by file on each save;
  `typeCheck.command` is the project's own whole check.
- `tests.files` are Bun test files; `tests.registry` the modules that register
  tests with wisp:src/runtime/testing.ts, each run as its own test. A
  `registryRunners` file only runs the registry, so the loop runs its modules
  instead. `preload` is bunfig.toml's test preload. `env` applies to every
  test process.
- `tests.journeys` are the Bun test files that play journeys in simulated
  clients; they report with the project's own journey.
- `tests.perFile` are audits that check each file they read on its own. When
  only files they read brought them in, they run with those files in
  `WISP_DEV_FILES`: `savedFiles()` (wisp:scripts/wisp/devResult.ts) returns
  them, or undefined when the audit should check everything, as in CI.
- `tests.warm` gives a Bun test file a process of its own, started before the
  save, that has already loaded the installed modules listed, such as the
  TypeScript compiler an audit parses with.
- `journey` names a module exporting the game's `HeadlessProject`, the same
  declaration `makeHeadless` takes ([headless runtime](headless.md)), and the
  journey to play.

## What each save runs

**Type errors of the saved files.** A TypeScript 7 checker (the pinned
compiler's API server) keeps every project open; a save takes a new snapshot
with the saved files read again and checks only those files, in every project
that contains them, Effect's diagnostics included. A change can also break a
file that imports the saved one: the whole check after it reports those.
TypeScript 6's in-process builder, which the map compiler uses, checked a
saved Smashcraft file in 60-220 ms and an export change's importers in
0.4-3.5 s; the TypeScript 7 server checks the saved file in 6-80 ms.

**The tests the save can affect.** A test is affected when it loads the saved
module, directly or through other modules: the loop scans each module's
imports as Bun loads them (static imports, re-exports, literal `import()` and
`require`; type-only imports load nothing), and rescans a saved module, so an
edit that adds an import counts from that save on. A test that reads project
files at run time declares them in `reads`; a save of a matching file selects
it. Every test runs when the graph can't decide:

- a file was created or deleted,
- the saved file isn't a module and no test declares reading it,
- the save changes a module every test preloads.

A test that loads a module with a computed `import()`, or reads files itself
(it names `readFileSync`, `Bun.file`, `Bun.Glob` and the like) without a
`reads` entry, runs on every save; the loop prints each such test when it
starts. Only the affected tests run, so a test that failed earlier and loads
nothing the save touched isn't run again until a save affects it.

**The journeys.** A process that has already loaded the headless runtime loads
the game's modules as saved and plays the project's journey in two simulated
clients, reporting desyncs, error reports, a hot reload not running and scene
problems as `wisp headless` does. It skips the clients' checksums, which only
fingerprint a run for comparing runtimes; the desync check compares calls.
Each affected journey test runs in its own process beside it.

## Processes and CPUs

Registry modules and Bun test files run in separate processes. Registry
processes, the journey process and each `warm` file's process start before
a save and wait for it, so a save pays only for loading the project's code.
The loop splits the affected unit tests across processes by their measured
times, longest first: registry modules share processes with each other; a Bun
test file shares one only with files of its `isolated` group, or with files
in no group. A per-file audit and a `warm` file run alone.

The loop sizes this from the CPUs it may use, a Linux cgroup quota included.
With 12 CPUs or more every signal runs at once. Under a quota, work beyond it
stalls every process the loop runs, so with fewer the signals run in deadline
order: the saved files' check and the unit tests, then the journeys, then the
whole check, and test processes take turns for all but one CPU. Tests and the
whole check run at lower priority (`nice`).

## On Smashcraft

Ten saves of game modules on Smashcraft f3b3d39, five adding a private
function and five an exported constant, measured in a 6-CPU cgroup quota
(median from the save): the saved files' type errors 0.056 s, the unit tests
0.640 s, the journeys 2.050 s, the whole check 2.653 s. The journey work is
fixed: the quick match and the eight journey test files take about 5.7
CPU-seconds, so in a 6-CPU quota the journeys can't end within a second of
the save even alone, and they wait for the unit tests. Before `wisp dev`, in
the same quota, the whole check took 0.60 s, the full test suite 2.46 s and
`wisp headless` 1.87 s, each run on its own.

For ten behaviour-changing mutations in different game modules, every test
that failed in a full run was one the loop selected, and the loop printed a
failure each time.
