# Consumer CI

Wisp ships one reusable GitHub Actions workflow for games built on it,
wisp:.github/workflows/consumer.yml. A game calls it pinned to a Wisp
commit and gets, on a free GitHub-hosted runner, the same checks Wisp runs
on its own sample: the type and number-rule check, unit tests with the
emitted Lua run in a 32-bit Lua and its toward-zero twin, the headless
journeys and, if the game has one, a bounded soak. Nothing in it needs
Warcraft III, a map or any proprietary file.

Building the `.w3x` is a separate, opt-in job that runs only on the game's
own self-hosted runner, which holds the base map and assets. The map and its
sha256 digest stay in a store folder on that runner. The workflow never
uploads a map, never releases and never deploys.

## Use it

In the game's repository, with Wisp installed from
`vendor/wisp-<commit>.tgz` as described in the
[README](../README.md#consume-a-pinned-revision):

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
permissions:
  contents: read
jobs:
  wisp:
    uses: tompassarelli/wisp/.github/workflows/consumer.yml@<wisp commit>
    with:
      bun-version: 1.3.13              # the game's packageManager version
      wisp-ref: <wisp commit>          # the same commit; checked against package.json
      headless: bun scripts/game.ts headless
      soak: bun scripts/game.ts soak --minutes 5
      repro-paths: build/soak
```

Pin `uses:` and `wisp-ref` to the same full commit hash. When `wisp-ref` is
set, the run fails unless package.json installs `wisp-<wisp-ref>.tgz`, so
the template and the installed package can't drift apart.

| Input | Default | What it does |
| --- | --- | --- |
| `bun-version` | required | Exact Bun version. |
| `wisp-ref` | empty | Full Wisp commit the game vendors; empty in Wisp itself. |
| `working-directory` | `.` | The folder holding the game's package.json. |
| `install` | `bun install --frozen-lockfile` | Install command. |
| `check` | `bun run check` | Type and [number-rule](../plugins/number-rules.ts) check. Empty skips. |
| `test` | `bun test` | Unit tests; `LUA` and `TOWARD_ZERO_LUA` name the pinned Lua32s, for the emitted-Lua and numeric tests. Empty skips. |
| `headless` | empty | The game's [headless](headless.md) journey command. |
| `soak` | empty | The game's [soak](soak.md) command; keep it bounded with `--minutes`. |
| `lua` | `true` | Build Lua 5.3.6 with `LUA_32BITS` (from the checksummed source in wisp:vendor/lua-5.3.6.tar.gz) and its toward-zero twin ([raw float rounding](headless.md#raw-float-rounding)) with wisp:scripts/wisp/lua32.ts, the builder every test run uses. |
| `timeout-minutes` | 20 | Per job. |
| `expect-failure` | `false` | The run passes only if a command fails: for a deliberately broken fixture. |
| `diagnostics` | `true` | Upload each command's output and `repro-paths` as the Actions artifact `artifact-name`, kept 14 days. |
| `repro-paths` | empty | Newline-separated repro files or folders the commands write. |
| `artifact-name` | `wisp-ci` | Name of that artifact; give each call its own. |
| `private-map-build` | `false` | Also run the private map build below. |
| `private-runner` | `["self-hosted", "wisp-private"]` | JSON `runs-on` labels of the runner allowed to build. |
| `map-build` | empty | Command that writes the map to `$WISP_MAP_OUT`. |
| `map-name` | `map` | First part of the stored file name. |
| `map-store` | `$HOME/.local/state/wisp/ci-maps` | Absolute store folder on the private runner, outside the checkout. |

### What the uploaded artifact holds

The `headless` job uploads only command output (`wisp-ci/*.txt`) and the
repro files named in `repro-paths`. Wisp's repro files hold a match's seeds,
inputs and saved state, not the base map or assets. In a
public repository anyone can download Actions artifacts: set
`diagnostics: false` if a command's output or repros could contain private
paths or content.

## The private map build

With `private-map-build: true`, after the headless job passes, the
`private-map` job runs on the runner `private-runner` names. It checks out the
commit, installs, and runs
`bun node_modules/wisp/scripts/wisp/ciMapBuild.ts` (wisp:scripts/wisp/ciMapBuild.ts),
which:

1. refuses a GitHub-hosted runner, a store inside the checkout, and a map
   name or revision that isn't a plain file name or commit hash;
2. runs `map-build` with `WISP_MAP_OUT` set to a staging file inside the store;
3. computes the map's sha256 and renames the map and digest into place:

```text
<map-store>/<map-name>-<commit>.w3x
<map-store>/<map-name>-<commit>.w3x.sha256   # sha256sum format: check with sha256sum -c
```

A failed build leaves nothing in the store. The job has no upload step: the
map exists only on that runner, where the owner's own tools (`wisp lan fresh`,
`wisp play`, `wisp accept`) pick it up. Copying it anywhere else is a
deliberate, manual act; there is no automatic release or deployment.

### Set up the runner

1. Register a self-hosted runner for the game's repository with the label
   `wisp-private` (Settings, Actions, Runners). For a public repository,
   also require approval for workflows from outside collaborators, so a
   fork's pull request can't run on it.
2. Install Bun and `nix` on it (the map packager compiles on first use; see
   [MapBuild](../scripts/wisp/mapBuild.ts)).
3. Put the base map and assets in a folder on the runner, outside any
   checkout, and point the build at it through the runner's environment, for
   example `WISP_BASE_MAP` in the runner's `.env` file.
4. Call the template with:

```yaml
    with:
      private-map-build: true
      map-name: mygame
      map-build: bun scripts/game.ts map build --base "$WISP_BASE_MAP" --out "$WISP_MAP_OUT"
```

The step runs locally the same way:

```sh
bun node_modules/wisp/scripts/wisp/ciMapBuild.ts --store ~/maps --name mygame --revision "$(git rev-parse HEAD)" \
  -- bash -c 'bun scripts/game.ts map build --base "$WISP_BASE_MAP" --out "$WISP_MAP_OUT"'
```

## Wisp's own use

Wisp's CI (wisp:.github/workflows/ci.yml) calls the template twice on the
neutral [sample](sample-map.md): job `sample` runs its check, tests and
headless journey and must pass; job `sample-failing-fixture` runs the
headless journey against wisp:examples/sample/test/fixtures/desync.ts, where
only the first client creates an extra unit, with `expect-failure: true`,
so it passes only when the journey reports the desync. Both upload their
output as `wisp-ci-sample` and `wisp-ci-sample-failing-fixture`.
wisp:examples/sample/test/failing-fixture.test.ts checks the same verdict
locally. Wisp has no self-hosted runner, so its CI never sets
`private-map-build`.

The `framework` job runs Wisp's own check and full Bun suite. It installs
Ubuntu's `libstorm-dev` and sets `STORMLIB_PREFIX=/usr` and `CC=gcc`, so the
map packager (wisp:scripts/wisp/mapBuild.ts) and its tests
(wisp:test/map-pack.test.ts) build against that StormLib instead of nixpkgs';
without those two variables they use `nix`.

## Main stays green

Each finished CI run on `main` opens, updates or closes one issue titled
"main is red" (wisp:.github/workflows/main-red.yml, which runs
wisp:scripts/mainRed.ts). A failed run lists each failing test (Bun's
`(fail)` lines; a failed step with none, such as the type check, by its step
name), the first failing commit since the last green run and the compare link
from that green commit. A later failed run rewrites the list; a green run
closes the issue. A run that finishes after a newer one reports nothing, so
events arriving out of order never reopen or close it.

Dispatching the workflow with a CI run ID reports any branch's run the same
way, as "BRANCH is red", which is how to try it on a scratch branch.

Every push prints the open issue's failing tests in one line and never blocks:

```text
pre-push: main is red (#71 https://github.com/tompassarelli/wisp/issues/71), 2 failing: perf --json plays …; the overlay shows …
```

That is wisp:.githooks/pre-push running wisp:scripts/prePush.ts; enable it
once per clone with `git config core.hooksPath .githooks` (safe-push runs it).
A red main is not "already failing": before landing, check whether your
change touches a listed test, and if your commit broke main, fix it first.

## Autoland

Cloud workers can push only to `claude/` branches. A push to `claude/NAME`
lands it on main by itself when it passes
(wisp:.github/workflows/autoland.yml); nobody has to fetch, rebase or test
it locally.

1. **Rebase.** The branch's commits are rebased onto main. A conflict stops
   the run and names the conflicting files.
2. **Checks.** `bun run check` on the rebased commit, which is then pushed
   to a scratch `farm/autoland-SHA` branch (CI ignores `farm/**`).
3. **Suites.** The [farm](farm.md) test workflow runs the full suite for the
   rebased commit inside the autoland run (wisp:.github/workflows/farm-test.yml
   is also a reusable workflow for this).
4. **Compare.** At the same time, main's own failures come from the newest
   farm result for the base or one of its last 30 main ancestors: the
   summary a previous landing saved (artifact `autoland-summary-SHA`, kept
   14 days) or a `bun wisp farm test` run's. Only when none exists does it
   run `bun wisp farm test --ref BASE`. A test that fails on the branch but
   not in that result is a new failure; a shard that crashed without naming
   a test is new unless main's result also had one in that suite.
5. **Land.** With no new failures, the rebased commits are pushed to main
   (a plain fast-forward) and the branch is
   deleted. Pushes made with the workflow token start no workflows, so the
   run dispatches main's CI for the landed commit; "main is red" follows that
   CI run as usual. If main moved during the run, the tested commits are
   replayed onto it, as a local landing would; only a conflict sends the
   branch through again.
6. **Refuse.** On a conflict, a failed check or new failures, the branch
   stays and every issue the commits reference (`Refs wisp#N`) gets a comment
   naming the files or tests and linking the run. Push a fix to the same
   branch and it tries again.

The push itself only queues a run of main's copy of the workflow, so a
branch made from an older main still lands with the current rules. Runs
share one concurrency group with a queue, so branches land one at a
time in push order and never race main. To retry a branch without a new
commit: `gh workflow run autoland.yml -f branch=claude/NAME`. A commit that
changes `.github/workflows/` can't land this way (the workflow token may not
push workflow changes); the run says so on the issue, and it lands through a
normal `safe-push`.

## Runner capacity and waiting

The account runs at most 20 jobs at once across all of its repositories
(GitHub Free), and further jobs wait in one first-come queue. Workflows keep
their share bounded so a new run's first job starts within a minute: a large
matrix sets `max-parallel` and packs enough work in each job that setup stays
a small part of it, and CI runs once per ref (a newer push replaces the queued
run). Autoland's group holds only Autoland runs; farm runs have no group, so
landings never hold them back.

`bun wisp farm ... --wait` (`waitFor` in wisp:scripts/wisp/farm.ts) polls the
run with one `gh run view` (two API calls). It polls 10 s after the dispatch,
then waits 1.5 times longer after each poll that shows no change, up to 60 s,
and goes back to 10 s whenever a job starts or finishes. A run's jobs move a
few dozen times in all, so most polls come at the cap: twenty workers waiting
there use 40 API calls a minute (2,400 an hour, inside the 5,000 limit).
`farm test` for a commit that already has a queued or running farm test joins
that run before pushing anything: no scratch branch and no dispatch.

GitHub also refuses bursts (its secondary limits: many requests at once, or
many dispatches and pushes a minute), with "HTTP 403: API rate limit
exceeded" even while `gh api rate_limit` shows the hourly budget untouched;
that endpoint doesn't reflect what the requests themselves report. Every
`gh` call the farm makes (`run` in wisp:scripts/wisp/farm.ts) retries such a
refusal after 30 s, then twice as long each time with jitter, for at most 20
minutes, and says so on stderr. To read the real budget, look at a real
request's headers:
`curl -sI -H "Authorization: token $(gh auth token)" https://api.github.com/repos/OWNER/REPO | grep -i x-ratelimit`.

To see where runs wait, compare each run's `created_at` with its first job's
`started_at` (`gh api repos/OWNER/REPO/actions/runs/ID/jobs`); a queued job
has no `runner_name` yet. A run's status alone hides the jobs running inside
a queued run, so count jobs, not runs.
