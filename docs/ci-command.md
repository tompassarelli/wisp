# The CI command

`ci` is one program for every check a project runs: on a laptop, in a cloud
worker, in Autoland's pre-merge step, after a merge, overnight and when
hunting seeds. A tier is a fixed list of stages, and each stage runs one of
Wisp's existing runners, so a local run and a CI run of the same tier do the
same thing. Workflows call a tier instead of restating its commands.

```sh
bun wisp ci pre-merge --base SHA     # type check, the affected tests, determinism
bun wisp ci pre-merge --base SHA --plan-only   # only print which tests it would run, and whether determinism runs
bun wisp ci post-merge               # type check, the whole suite, the farm tests
bun wisp ci nightly [--minutes M]    # random soak seeds for M minutes
bun wisp ci seeds --n N [--seed S]   # N soak seeds, or N seeds from S
```

Add `--json` to any tier for one JSON line per stage (`type: "result"`,
`stage`, `verdict`, `seconds` and the stage's counts) and a last
`type: "summary"` line, with `schema: 1` and `command: "ci"`
(wisp:host/cli/jsonResults.ts); the stages' own output then goes to
stderr. A stage that ran tests and had any fail adds `failed`, the failing
tests as `file > test name` (describe blocks between), read from bun test's
junit report: the stage passes `--reporter=junit` and a scratch
`--reporter-outfile` to its runner, and the timing phase writes one report
beside it per file (`junitFailures` in wisp:host/testing/testRunner.ts). A
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

A stage that had nothing to check is `skipped`: its text line adds the
reason (`determinism, skipped, 0.0 (no change since SHA reaches the soak: 3
changed files)`) and its JSON line has `verdict: "skipped"`, `ok: true` and a
`reason` string.

The run exits 0 when every stage passed or was skipped, 1 when one failed, and 75 when
none failed but one was inconclusive: the timing tests' busy-machine verdict
(wisp:host/testing/testRunner.ts, [Testing](testing.md#timing-tests)). A
usage problem exits 2. Every stage runs even after one fails, so one run
names every failing stage.

## Declaring it

A game declares `ci` with `makeCi` (wisp:host/commands/ci.ts) next to
`makeDev`, from the same declarations, and adds it to its command list:

```ts
ci: {
  usage: "pre-merge --base SHA [--plan-only] | post-merge | nightly [--minutes M] | seeds --n N [--seed S]   [--json]",
  load: async () => (await import("wisp/scripts/wisp/commands/ci")).makeCi({
    root: DEV.root, sources: DEV.sources, typeCheck: DEV.typeCheck, tests: DEV.tests,
    soak: { ...SOAK, reads: ["maps/**"] },   // the options the game passes makeSoak, and what the soak reads
  }),
},
repro: { ... },        // makeRepro with the same soak: the replay command ci prints
```

`root`, `sources`, `typeCheck.command` and `tests` are `wisp dev`'s
([dev](dev.md)); `soak` is the game's `makeSoak` options ([soak](soak.md))
plus an optional `reads`: globs, from `root`, of the files the soak reads
without importing them (maps, data, JSON), which pre-merge's determinism
stage counts among its inputs. A
game without a soak leaves it out: pre-merge then has no determinism stage,
and `nightly` and `seeds` refuse. The failing-seed replay command is the
game's own `repro` command, so a game with a soak declares `repro` with the
same soak ([repros](repro.md#shrinking-a-soak-failure)).

Wisp declares its own in wisp:host/commands/repo.ts: its `bun run check`, its
test files, and the soak test's map with fault-free policies
(wisp:host/soak/ci/ciProject.ts), with `repro` beside it. That soak imports
everything it plays, so it declares no `reads`. `bun run ci` is
`ci post-merge`.

## pre-merge

1. **type check**: `typeCheck.command` in `root`.
2. **tests**: the tests the changes since `--base` can affect, chosen the way
   `wisp dev` chooses them on a save (`TestPlan`,
   wisp:host/dev/testSelection.ts). The changes are `git diff --name-only
   BASE` plus untracked files, keeping the paths a save would reach
   (`followsSave` in wisp:host/dev/savedFiles.ts: project files at the
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

   A game with a soak also gets pre-merge's determinism decision: the line
   `determinism: runs|skipped (REASON)` after the `tests:` line, and
   `"determinism":{"runs":false,"reason":"..."}` in the plan line.
3. **determinism LUA** and **determinism TOWARD_ZERO_LUA**, when a change
   since `--base` can reach the soak. The soak's inputs are the import
   closure (wisp:host/dev/importGraph.ts, as `TestPlan` follows it) of
   the soak's project, the `game` it names and the soak worker, plus the
   files `soak.reads` matches. The changes are every path `git diff
   --name-only BASE` and the untracked files name, wherever they are. The
   stage runs when one of them is an input or a project file (`package.json`,
   `tsconfig*.json`, `bunfig.toml`, a lockfile), and when the inputs can't be
   known: the project doesn't load, or a module in the closure has an
   `import()` the graph can't follow. Wisp's own scripts' `import()` calls
   don't count: the soak's loaders load its project and game, which are inputs
   already, and the rest load paths no soak plays (in a game they sit in
   `node_modules`, outside the graph). Otherwise the stage is one line,
   `determinism, skipped, 0.0 (no change since BASE reaches the soak: N
   changed files)`, and counts as passing. When it runs, it prints
   `determinism: runs (REASON)` (`src/a.ts reaches the soak`) and its two
   result lines carry that `reason`.

   It plays the soak's
   first 8 matches from seed 1, each capped at 600 frames, in a soak worker
   process (wisp:host/soak/soakWorker.ts), once with the stock Lua32 as
   `LUA` and once with the toward-zero Lua32 as `LUA`
   (wisp:host/compile/lua32.ts); `TOWARD_ZERO_LUA` names the toward-zero one in
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
  replay: bun host/commands/repo.ts repro build/soak/2026-10-11T14-23-13/match-5.json
  issue: build/soak/2026-10-11T14-23-13/match-5.issue.md
```

The replay command plays the repro again and exits 0 when it still fails with
the recorded kind of finding ([repros](repro.md#shrinking-a-soak-failure)).

## Seed farm

The seed farm, wisp:.github/workflows/seed-farm.yml, plays `ci nightly` on the
newest main on a hosted `ubuntu-latest` runner after every CI run on main
(`workflow_run` for pushes; a CI run that Autoland dispatches starts no
workflow_run, so ci.yml's `seed-farm` job dispatches it instead) and once an hour (`schedule` at minute 17, which GitHub
fires late or skips under load), and files every new failure as an issue. A run checks out the
ref, installs Bun 1.3.13 and both Lua32 builds with ci.yml's and the farm
tests' cache keys, and runs `COMMAND ci nightly --minutes M --json`.
Runs never overlap: a new one cancels nothing and waits behind the running
one, and GitHub keeps one waiting run per repository, so runs never
stack. A run with a failing seed ends red after filing.

For each failing match, the run reads the repro file the `--json` result's
`repros` names and titles its issue from the repro's first finding:
`seed farm: nightly: KIND: CLAUSE`, the finding's first clause with its
numbers as `N` (`seed farm: nightly: desync: native calls differ after frame
N`), so the same fault on another seed has the same title. Before filing,
it searches the open issues for that exact title: when one exists it
comments there with the new seed, commit and replay command; otherwise it
files `match-N.issue.md` with `gh issue create --body-file`, adding a
link to the run and the fresh-clone replay below, with the `bug` label when
the repository has one (it creates no labels). One issue per title, at most
5 filed or commented per run. The filed matches' repro files (`match-N.json`,
the unshrunk original, the issue body and the clients' logs) go in the run's
artifact `seed-farm-RUN_ID` under their paths from the checkout, kept 30 days.

Replaying from a fresh clone, as the issue prints it:

```sh
git clone https://github.com/OWNER/REPO && cd REPO
gh run download RUN_ID -R OWNER/REPO -n seed-farm-RUN_ID   # build/soak/…/match-N.json
git checkout COMMIT && bun install --frozen-lockfile && bun host/commands/repo.ts repro build/soak/…/match-N.json
```

`build/` is ignored, so the checkout keeps the downloaded repro. The replay
exits 0 when the repro still fails with the recorded kind of finding.

Run it by hand, on any branch or commit, with `workflow_dispatch`'s `ref`
(default: the dispatched branch) and `minutes` (default 10). A game calls it
from its own workflow, pinned to a Wisp commit, with the command that runs
its `ci` and `repro` and its minutes, and grants it `issues: write`:

```yaml
on:
  schedule:
    - cron: "41 * * * *"
permissions:
  contents: read
  issues: write
jobs:
  seed-farm:
    uses: tompassarelli/wisp/.github/workflows/seed-farm.yml@WISP_COMMIT
    with:
      command: bun scripts/game.ts   # default: bun host/commands/repo.ts
      minutes: 10                    # default 10, at most 30
```

The run farms the calling workflow's ref and files issues in the
calling repository.
