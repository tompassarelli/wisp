# The dev loop: `wisp dev`

One long-running command answers every save. It keeps a TypeScript checker,
the project's test graph, test processes and a headless journey process warm,
and on each save prints, each with its time since the save:

```text
saved src/game/sim/step.ts
   0.044 s  types: no errors in src/game/sim/step.ts
   0.585 s  journey quick-match: no problems
           p0: 341968 native calls
           p1: 341968 native calls
           no desync in 600 frames
           hot reload 1 running in every client
   2.696 s  tests: 512 passed (59 test files of 98 affected)
   3.249 s  types: no errors in the project
```

A failing test prints as soon as its process ends (`FAIL file > test: why`),
before the summary. A new save stops the previous save's work; a hot reload
already sending finishes first. With `--data DIR --data DIR`, each save also
hot-reloads the map into those clients exactly as `hot --watch` does
([hot reload](hot-reload.md)), and in-game error reports and desyncs print as
they appear.

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

**The journey.** A process that has already loaded the headless runtime loads
the game's modules as saved and plays the journey in two simulated clients,
reporting desyncs, error reports, a hot reload not running and scene problems
as `wisp headless` does. It skips the clients' checksums, which only
fingerprint a run for comparing runtimes; the desync check compares calls.

## Processes and CPUs

Registry modules and Bun test files run in separate processes. Registry
processes and the journey process start before a save and wait for it, so a
save pays only for loading the project's code. The loop splits the affected
tests across processes by their measured times, longest first: registry
modules share processes with each other; a Bun test file shares one only with
files of its `isolated` group, or with files in no group.

The loop sizes this from the CPUs it may use, a Linux cgroup quota included.
Under a quota, work beyond it stalls every process the loop runs, so with
fewer than 12 CPUs the journey and the saved files' check go first, then the
tests, then the whole check. Tests and the whole check run at lower priority
(`nice`), so they yield to the journey and the saved files' check.

## On Smashcraft

Ten saves of game modules on Smashcraft ebe9169, five adding a private
function and five an exported constant, measured in a 6-CPU cgroup quota
(median from the save): saved files' type errors 0.044 s, the quick-match
journey 0.585 s, the affected tests 2.696 s, the whole check 3.249 s. Before
`wisp dev`, in the same quota, the whole check took 0.49 s, the full test
suite 2.20 s and `wisp headless` 1.38 s, each run on its own. Nearly every
game module reaches the desync guard's 600-frame journey test (about 0.5 s
alone), and a save of any source file selects the source-shape audit, so the
affected tests seldom finish before the heaviest of those.

For ten behaviour-changing mutations in different game modules, every test
that failed in a full run was one the loop selected, and the loop printed a
failure each time.
