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
| `test` | `bun test` | Unit tests; `LUA` and `TOWARD_ZERO_LUA` name the built Lua32s, for the emitted-Lua and numeric tests. Empty skips. |
| `headless` | empty | The game's [headless](headless.md) journey command. |
| `soak` | empty | The game's [soak](soak.md) command; keep it bounded with `--minutes`. |
| `lua` | `true` | Build Lua 5.3.6 with `LUA_32BITS` (checksum-pinned source) and its toward-zero twin ([raw float rounding](headless.md#raw-float-rounding)). |
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
