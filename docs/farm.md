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
   `.github/workflows/farm-test.yml` with the commit and a random tag, from
   main for a commit main holds and from the scratch branch otherwise, so a
   candidate that changes the workflow runs its own copy,
   finds the run by the tag at the end of its name, and polls its jobs
   (from every 10 s backing off to every 60 s while nothing moves; a commit
   that already has a queued or running farm test joins that run instead;
   [Runner capacity and waiting](ci.md#runner-capacity-and-waiting)).
3. **Plan.** The plan job restores the newest `farm-timings.json` from the
   Actions cache and splits the test files (Bun) and tests (Lua) over the
   shards, slowest first, each to the shard with the least time so far
   (wisp:host/farm/farmShards.ts). A file or test never measured counts
   as the median measured one; a Lua test never measured runs on the shard
   its name hashes to. Test files under `repos/` (vendored repositories,
   which bunfig.toml's `pathIgnorePatterns` keeps out of every run) get no shard.
4. **Shards.** Bun shards run their files with Bun's JUnit reporter. Lua jobs
   compile the test bundle once and run several shards at once, one Lua
   process per core, each writing a line per test with its status and
   seconds. `bun install`'s download cache and the pinned 32-bit Lua build
   (5.3.6 with `LUA_32BITS`, from the checksum-pinned source, plus the
   round-toward-zero build, wisp:host/compile/lua32.ts's ~/.cache/wisp/lua32)
   come from the Actions cache. Each shard runs on a hosted runner or the
   farm box ([Where shards run](#where-shards-run)).
5. **Merge.** The merge job reads every shard's result into `summary.json`,
   which the command downloads and prints, and saves the next run's
   `farm-timings.json`: a test's new estimate moves halfway to a slower
   measurement and a fifth of the way to a faster one, so one noisy runner
   doesn't reshuffle the next plan; a test measured for the first time takes
   its measurement.

## Where shards run

Wisp's runner placement is the reviewed wisp:runner-routing.json and
wisp:host/farm/runnerRoute.ts. The workflow revision's own `route` job (CI) or
plan job (farm test) runs the script, which counts this repository's
unfinished jobs asking for the `farm-big` label (the runners API needs an admin
token the workflow lacks) and reports `capacity` minus that count as the idle
runners. Only `push`, `workflow_dispatch` and `schedule` events can pick the
farm: a `pull_request` or `pull_request_target` event, a fork's included, a
retry (run attempt above 1) and a full farm all give `ubuntu-latest`. Keep
`capacity` equal to the number of wisp runners registered on gex45 (2).

`placeShards` in wisp:host/farm/farmShards.ts (`farmShards.ts place`) sends the
first `idle` Bun shards that need no cargo to the farm label and the rest to hosted runners, so
both pools run at once; with no farm label every shard is hosted
(`no farm runner`). A `farm-runner` dispatch input names the label in place of
the choice (`ubuntu-latest` forces hosted runners). The plan job's run summary
has the route's reason and one line per shard, such as
`- bun 0: farm-big (2 farm runners idle)`. A shard holding a test that builds
the relay (`cargo`, which the farm image lacks) stays hosted (`needs cargo`),
as do the CI `framework` job and the Rust and Windows jobs. The farm box ran
shards 1.37x slower than hosted while its VM pool loaded it to 62 on
30 cores (wisp#132): this routing no longer reads the box's load, so a loaded
box slows farm shards rather than moving them.

Autoland runs the suite inside each branch's own run, so branches waiting at once each add a farm run, and the plan job chooses its runners again for each.

## A repository's workflow

Wisp's own wisp:.github/workflows/farm-test.yml is the template: a plan job,
one job per shard and a merge job, talking through `farmShards.ts`:

| Step | Command |
| --- | --- |
| Split | `farmShards.ts plan --timings FILE --bun N [--lua N] UNIT... > plan.json`; a unit is a test file, or comma-joined files that share one process |
| Placement | `farmShards.ts place --shards N --farm LABEL --idle N [--cargo I,J]` prints each shard's `{runner, reason}`: the first N shards not listed in `--cargo` on LABEL, the rest hosted |
| Lua assignments | `farmShards.ts lua-plan plan.json` prints `NAME<TAB>SHARD` lines for the Lua runner |
| Bun shard result | `farmShards.ts junit --shard K --exit-code C XML... > result.json` |
| Lua shard result | `farmShards.ts lua --shard K --exit-code C TSV... > result.json`, from `pass\|fail<TAB>SECONDS<TAB>NAME` lines |
| Merge | `farmShards.ts merge --plan plan.json --timings FILE --out summary.json RESULT...` |

The merge job uploads `summary.json` as the artifact `farm-test-summary`;
each shard uploads its `result.json` as `farm-test-result-SUITE-K`.
Smashcraft's smashcraft:.github/workflows/farm-test.yml adds the Lua jobs.

A game adds its own farm jobs (Smashcraft's `farm balance`, `farm pads`,
`farm perf`, `farm memory`) from the same pieces in wisp:host/farm/farm.ts:
`resolveRef` (run it inside `Effect.scoped`: closing the scope deletes the
scratch branch, whatever ended the run), `dispatch`, `waitFor` and
`withArtifact`.
