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

1. **The commit.** A commit main already holds runs as is. Otherwise it must
   be the checkout's HEAD: the command pushes it with safe-push to a scratch
   branch `farm/COMMIT` (CI ignores `farm/**`), waits for the run whatever
   `--wait` says, and deletes the branch afterwards.
2. **Dispatch.** The command starts the repository's
   `.github/workflows/farm-test.yml` on main with the commit and a random tag,
   finds the run by the tag at the end of its name, and polls its jobs.
3. **Plan.** The plan job restores the newest `farm-timings.json` from the
   Actions cache and splits the test files (Bun) and tests (Lua) over the
   shards, slowest first, each to the shard with the least time so far
   (wisp:scripts/wisp/farmShards.ts). A file or test never measured counts
   as the median measured one; a Lua test never measured runs on the shard
   its name hashes to.
4. **Shards.** Bun shards run their files with Bun's JUnit reporter. Lua jobs
   compile the test bundle once and run several shards at once, one Lua
   process per core, each writing a line per test with its status and
   seconds. `bun install`'s download cache and the pinned 32-bit Lua build
   (5.3.6 with `LUA_32BITS`, from the checksum-pinned source, plus the
   round-toward-zero build, wisp:scripts/wisp/lua32.ts's ~/.cache/wisp/lua32)
   come from the Actions cache.
5. **Merge.** The merge job reads every shard's result into `summary.json`,
   which the command downloads and prints, and saves this run's measured
   seconds as the next run's `farm-timings.json`.

## A repository's workflow

Wisp's own wisp:.github/workflows/farm-test.yml is the template: a plan job,
one job per shard and a merge job, talking through `farmShards.ts`:

| Step | Command |
| --- | --- |
| Split | `farmShards.ts plan --timings FILE --bun N [--lua N] UNIT... > plan.json`; a unit is a test file, or comma-joined files that share one process |
| Lua assignments | `farmShards.ts lua-plan plan.json` prints `NAME<TAB>SHARD` lines for the Lua runner |
| Bun shard result | `farmShards.ts junit --shard K --exit-code C XML... > result.json` |
| Lua shard result | `farmShards.ts lua --shard K --exit-code C TSV... > result.json`, from `pass\|fail<TAB>SECONDS<TAB>NAME` lines |
| Merge | `farmShards.ts merge --plan plan.json --timings FILE --out summary.json RESULT...` |

The merge job uploads `summary.json` as the artifact `farm-test-summary`;
each shard uploads its `result.json` as `farm-test-result-SUITE-K`.
Smashcraft's smashcraft:.github/workflows/farm-test.yml adds the Lua jobs.

A game adds its own farm jobs (Smashcraft's `farm balance`, `farm pads`,
`farm perf`, `farm memory`) from the same pieces in wisp:scripts/wisp/farm.ts:
`resolveRef` (run it inside `Effect.scoped`: closing the scope deletes the
scratch branch, whatever ended the run), `dispatch`, `waitFor` and
`withArtifact`.
