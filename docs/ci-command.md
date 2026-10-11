# The CI command

`ci` is one program for every check a project runs: on a laptop, in a cloud
worker, in Autoland's pre-merge step, after a merge, overnight and when
hunting seeds. A tier is a fixed list of stages, and each stage runs one of
Wisp's existing runners, so a local run and a CI run of the same tier do the
same thing. Workflows call a tier instead of restating its commands.

```sh
bun wisp ci pre-merge --base SHA     # type check, the affected tests, determinism
bun wisp ci pre-merge --base SHA --plan-only   # only print which tests it would run
bun wisp ci post-merge               # type check, the whole suite, the farm tests
bun wisp ci nightly [--minutes M]    # random soak seeds for M minutes
bun wisp ci seeds --n N [--seed S]   # N soak seeds, or N seeds from S
```

Add `--json` to any tier for one JSON line per stage (`type: "result"`,
`stage`, `verdict`, `seconds` and the stage's counts) and a last
`type: "summary"` line, with `schema: 1` and `command: "ci"`
(wisp:scripts/wisp/jsonResults.ts); the stages' own output then goes to
stderr. A stage that ran tests and had any fail adds `failed`, the failing
tests as `file > test name` (describe blocks between), read from bun test's
junit report: the stage passes `--reporter=junit` and a scratch
`--reporter-outfile` to its runner, and the timing phase writes one report
beside it per file (`junitFailures` in wisp:scripts/wisp/testRunner.ts). A
seed stage that fails (determinism, `seeds`, `nightly`) adds `failed` as the
failing matches' names (`match 3: a vs b on stage, policy/policy, seed N`).
Nothing failed, or no tests run, leaves `failed` out:

```json
{"schema":1,"command":"ci","type":"result","ok":false,"stage":"tests","verdict":"failed","seconds":2.1,"selected":2,"total":2,"failed":["test/b.test.ts > b"]}
```

Without it each stage prints one line when it ends:

```text
type check, passed, 4.7
tests, passed, 31.4
determinism LUA, passed, 1.0
determinism TOWARD_ZERO_LUA, passed, 1.0
```

The run exits 0 when every stage passed, 1 when one failed, and 75 when
none failed but one was inconclusive: the timing tests' busy-machine verdict
(wisp:scripts/wisp/testRunner.ts, [Testing](testing.md#timing-tests)). A
usage problem exits 2. Every stage runs even after one fails, so one run
names every failing stage.

## Declaring it

A game declares `ci` with `makeCi` (wisp:scripts/wisp/commands/ci.ts) next to
`makeDev`, from the same declarations, and adds it to its command list:

```ts
ci: {
  usage: "pre-merge --base SHA [--plan-only] | post-merge | nightly [--minutes M] | seeds --n N [--seed S]   [--json]",
  load: async () => (await import("wisp/scripts/wisp/commands/ci")).makeCi({
    root: DEV.root, sources: DEV.sources, typeCheck: DEV.typeCheck, tests: DEV.tests,
    soak: SOAK,          // the options the game passes makeSoak
  }),
},
repro: { ... },        // makeRepro with the same soak: the replay command ci prints
```

`root`, `sources`, `typeCheck.command` and `tests` are `wisp dev`'s
([dev](dev.md)); `soak` is the game's `makeSoak` options ([soak](soak.md)). A
game without a soak leaves it out: pre-merge then has no determinism stage,
and `nightly` and `seeds` refuse. The failing-seed replay command is the
game's own `repro` command, so a game with a soak declares `repro` with the
same soak ([repros](repro.md#shrinking-a-soak-failure)).

Wisp declares its own in wisp:scripts/wisp/repo.ts: its `bun run check`, its
test files, and the soak test's map with fault-free policies
(wisp:test/soak/ci-project.ts), with `repro` beside it. `bun run ci` is
`ci post-merge`.

## pre-merge

1. **type check**: `typeCheck.command` in `root`.
2. **tests**: the tests the changes since `--base` can affect, chosen the way
   `wisp dev` chooses them on a save (`TestPlan`,
   wisp:scripts/wisp/testSelection.ts). The changes are `git diff --name-only
   BASE` plus untracked files, keeping the paths a save would reach
   (`followsSave` in wisp:scripts/wisp/commands/dev.ts: project files at the
   root and files under `sources`). A changed project file, a preloaded
   module or a non-module file no test declares reading selects every test,
   as on a save. Files the diff creates or deletes count as changed: the plan
   is scanned fresh, so it already knows them. The selected files run through
   the project's `bun run test`; the stage prints how many of all the test
   files it selected (`tests: 50 of 76 test files affected by 1 changed
   files since SHA`; in Wisp all 50 run on every save, as `wisp dev` prints at its
   start: they read files without declaring which, or reach an `import()`
   the import graph can't follow).

   `--plan-only` (pre-merge only) runs no stage: it prints the selected test
   files, one a line, then the `tests:` line, and exits 0. With `--json` it
   prints one line instead of results:

   ```json
   {"schema":1,"command":"ci","type":"plan","base":"SHA","selected":["test/a.test.ts"],"total":76,"changed":["src/a.ts"],"reasons":{"test/a.test.ts":"imports src/a.ts"}}
   ```

   `reasons` says why each file is selected, as `TestPlan.select` found it:
   `changed directly`, `imports PATH`, `reads PATH` (a declared read) or
   `runs on every save: WHY`; a whole-suite selection gives every file its
   reason (`src/x.ts is new`). Autoland's shadow lander compares selections
   this way without running them.
3. **determinism LUA** and **determinism TOWARD_ZERO_LUA**: the soak's
   first 8 matches from seed 1, each capped at 600 frames, in a soak worker
   process (wisp:scripts/wisp/soakWorker.ts), once with the stock Lua32 as
   `LUA` and once with the toward-zero Lua32 as `LUA`
   (wisp:scripts/wisp/lua32.ts); `TOWARD_ZERO_LUA` names the toward-zero one in
   both. Each seed prints as the stage starts. A match passes with no finding
   but `unfinished` (the cap), and the two runs must end every match with the
   same native call checksums. The soak's matches run in the headless
   runtime in Bun, so for a soak whose game module never reads `LUA` the two
   runs are a determinism repeat in two fresh processes; a game whose soak
   plays emitted Lua gets both roundings.

On a 4-core machine the determinism stages take about 1 s each, run at the
same time, for Wisp's soak (8 matches of 600 frames, measured 11 Oct 2026);
the whole `ci pre-merge --base HEAD~1` for a one-test change took 38 s there,
31 s of it the 50 selected test files.
For Smashcraft this is an estimate, not a measurement: its 200-match soak
used 241 CPU seconds (6 Oct 2026), about 1.2 s a match over its full length,
which puts 8 capped matches under 10 s per mode, inside the 30 s budget.

## post-merge

1. **type check**: as above.
2. **tests**: the project's whole `bun run test`.
3. **farm tests**: every declared test file that calls `farmTest(`, with
   `bun test --timeout 120000 --preload testCostPreload.ts -t "farm: "`, the
   set CI's farm-tests job ran and each farm shard runs
   ([Test cost](testing.md#test-cost), [farm](farm.md)).

## seeds and nightly

`ci seeds --n N` plays N soak matches through the `soak` command itself
(`makeSoak`, read through its `--json` records): a random plan seed, or
`--seed S`, which plans the same N matches every time. Each match's seed
prints as the run starts. `ci nightly [--minutes M]` plays random seeds until
M minutes pass (10 by default, at most the soak's 30): batches of the soak's
2,000-match limit, each from a new random seed and limited to the minutes
left (rounded up to a whole minute), so a run ends within a minute of M.
Reaching the time limit is how it ends, not a failure; each match's seed
prints as it finishes.

A failing match keeps the soak's repro file (`OUT/match-N.json`, shrunk, with
the original beside it) and gets an issue body beside it,
`OUT/match-N.issue.md`, holding the seed, the commit (`git rev-parse HEAD`),
the failing stage, the findings and the replay command, which also prints:

```text
seeds: seed 385148257 (match 5) failed:
  desync: native calls differ after frame 120, call 10 differs between slot 0 and slot 1:
  replay: bun scripts/wisp/repo.ts repro build/soak/2026-10-11T14-23-13/match-5.json
  issue: build/soak/2026-10-11T14-23-13/match-5.issue.md
```

The replay command plays the repro again and exits 0 when it still fails with
the recorded kind of finding ([repros](repro.md#shrinking-a-soak-failure)).
