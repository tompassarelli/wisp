# The farm

Full test suites don't run on the development machine. Run the tests a change
affects locally (`wisp dev` runs them on every save) and the full suites on
GitHub's free hosted runners:

```text
bun wisp farm test [--ref REF] [--wait]
```

`wisp farm test` runs the repository's full Bun suite, and its 32-bit Lua
suite when it has one, for one commit, sharded over parallel jobs, and prints
one result: pass, fail and skip counts per suite, then each failing test by
name and each shard that failed without naming one. It exits 1 when anything
failed. Without `--ref` it runs the checkout's HEAD.

## How it works

At startup, every farm command sweeps origin's `farm/*` branches whose head
commit is older than 24 hours. Queued and in-progress runs keep their branches,
including commits named in a workflow's run title when it dispatches on main.
This clears branches left by a killed command or a manual push.

1. **The commit.** A commit main already holds runs as is. Otherwise it must
   be the checkout's HEAD: the command pushes it with safe-push to a scratch
   branch `farm/COMMIT` (CI ignores `farm/**`), waits for the run whatever
   `--wait` says, and deletes the branch afterwards.
2. **Dispatch.** The command starts the repository's
   `.github/workflows/farm-test.yml` on main with the commit and a random tag,
   finds the run by the tag at the end of its name, and polls its jobs
   (from every 10 s backing off to every 60 s while nothing moves; a commit
   that already has a queued or running farm test joins that run instead;
   [Runner capacity and waiting](ci.md#runner-capacity-and-waiting)).
3. **Plan.** The plan job restores the newest `farm-timings.json` from the
   Actions cache and splits the test files (Bun) and tests (Lua) over the
   shards, slowest first, each to the shard with the least time so far
   (wisp:scripts/wisp/farm/farmShards.ts). A file or test never measured counts
   as the median measured one; a Lua test never measured runs on the shard
   its name hashes to. Test files under `repos/` (vendored repositories,
   which bunfig.toml's `pathIgnorePatterns` keeps out of every run) get no shard.
4. **Shards.** Bun shards run their files with Bun's JUnit reporter. Lua jobs
   compile the test bundle once and run several shards at once, one Lua
   process per core, each writing a line per test with its status and
   seconds. `bun install`'s download cache and the pinned 32-bit Lua build
   (5.3.6 with `LUA_32BITS`, from the checksum-pinned source, plus the
   round-toward-zero build, wisp:scripts/wisp/compile/lua32.ts's ~/.cache/wisp/lua32)
   come from the Actions cache. Each shard runs on a hosted runner or the
   farm box ([Where shards run](#where-shards-run)).
5. **Merge.** The merge job reads every shard's result into `summary.json`,
   which the command downloads and prints, and saves the next run's
   `farm-timings.json`: a test's new estimate moves halfway to a slower
   measurement and a fifth of the way to a faster one, so one noisy runner
   doesn't reshuffle the next plan; a test measured for the first time takes
   its measurement.

## Where shards run

When the `FARM_RUNNER` repository variable names a self-hosted runner label
(Wisp's is the farm-big box), the plan job sends the even Bun shards there
and the odd ones to hosted runners, so both pools run at once. It sends an
even shard to the farm only while the box can take it (wisp#132): the farm box
ran shards 1.37x slower than hosted while its VM pool loaded it to 62 on
30 cores.

wisp:.github/workflows/farm-load.yml runs every 5 minutes (and on dispatch)
on the `FARM_RUNNER` label, with no checkout. It writes
`{"load1":L,"cores":C,"at":UNIX_SECONDS}` from `/proc/loadavg` and `nproc` to
`farm-load.json` and saves it in the Actions cache under
`farm-load-RUN_ID`; one probe waits for the box at a time. Schedules run on
main, so every branch's plan job restores the newest sample (`restore-keys:
farm-load-`), the same way it restores `farm-timings.json`. Without
`FARM_RUNNER` the probe is skipped.

`placeShards` in wisp:scripts/wisp/farm/farmShards.ts (`farmShards.ts place`)
decides each shard. An even shard goes to the farm label only when a sample
exists, it is at most 900 s old, and `load1 <= cores`. Otherwise it goes to
`ubuntu-latest` with the reason `missing`, `stale AGEs` (a box too busy to
take the probe for 15 minutes is too busy for shards) or `load L > C cores`.
Without `FARM_RUNNER` every shard is hosted (`no farm runner`). A
`farm-runner` dispatch input, which measures a box before enabling it, skips
the load check (`farm-runner input`). The plan job's run summary has one line
per shard, such as `- bun 0: ubuntu-latest (load 62.1 > 30 cores)`.

## A repository's workflow

Wisp's own wisp:.github/workflows/farm-test.yml is the template: a plan job,
one job per shard and a merge job, talking through `farmShards.ts`:

| Step | Command |
| --- | --- |
| Split | `farmShards.ts plan --timings FILE --bun N [--lua N] UNIT... > plan.json`; a unit is a test file, or comma-joined files that share one process |
| Placement | `farmShards.ts place --shards N --farm LABEL [--load farm-load.json]` prints each shard's `{runner, reason}`; without `--load` the load check is skipped, and a `--load` file that doesn't exist reads as `missing` |
| Lua assignments | `farmShards.ts lua-plan plan.json` prints `NAME<TAB>SHARD` lines for the Lua runner |
| Bun shard result | `farmShards.ts junit --shard K --exit-code C XML... > result.json` |
| Lua shard result | `farmShards.ts lua --shard K --exit-code C TSV... > result.json`, from `pass\|fail<TAB>SECONDS<TAB>NAME` lines |
| Merge | `farmShards.ts merge --plan plan.json --timings FILE --out summary.json RESULT...` |

The merge job uploads `summary.json` as the artifact `farm-test-summary`;
each shard uploads its `result.json` as `farm-test-result-SUITE-K`.
Smashcraft's smashcraft:.github/workflows/farm-test.yml adds the Lua jobs.

A game adds its own farm jobs (Smashcraft's `farm balance`, `farm pads`,
`farm perf`, `farm memory`) from the same pieces in wisp:scripts/wisp/farm/farm.ts:
`resolveRef` (run it inside `Effect.scoped`: closing the scope deletes the
scratch branch, whatever ended the run), `dispatch`, `waitFor` and
`withArtifact`.
