# Architecture: where code lives

Wisp is a game-agnostic toolkit: a TSTL map library (`src/`), a Bun host library and CLI (`host/`) and TSTL plugins (`plugins/`). It names no game.
The tables say where things are today; "in box N" or a W-id names the [wisp#1](https://github.com/tompassarelli/wisp/issues/1) slice that moves it.

## Modules and import direction

A module may import only the modules in its "may use" column. `src/` never imports `host/`; shipped code never imports `test/`.

| module | today | responsibility | may use |
|---|---|---|---|
| num | `src/sim/` | binary32 soft-float, f32 helpers, intMath | none |
| natives | `src/natives/warcraft.d.ts` | Warcraft native declarations (generated) | none |
| runtime | `src/runtime/` | Pure map-side helpers: lookup, record text, config, payload, modules, test harness | num |
| map | `src/map/` | Map-side services calling natives: file I/O, dispatch, hot reload, frame meter, native driver, scene | runtime, num, natives |
| headless | `src/headless/` | Emulated Warcraft client: natives, lockstep, sync channel, journeys, Lua perf | map, runtime, num, natives |
| cli | `host/cli/` | Command type, CLI runner, timings, process spawning, JSON results, panel server | none |
| os | `host/os/` (`platform/`, `warcraft/`) | Host OS, desktop, Battle.net launcher, Warcraft window and input | cli |
| build | `host/toolchain/` | TSTL compile, Lua bundle, map script, object data, natives producer, number rules, source maps, package | cli, runtime, num, plugins |
| lan, net | `host/lan/`, `host/net/` | Offline LAN pair pool; UDP lockstep peer, proxy, join code | cli, os; cli, headless |
| render | `host/{browser,fidelity,render,models,terrain}/` | WebGL renderer, models, terrain, fidelity metrics | cli, os, headless, runtime, num |
| host | the other `host/` directories, one per responsibility: `accept`, `checks`, `client`, `compile`, `dev`, `doctor`, `farm`, `headless`, `io`, `perf`, `play`, `repro`, `scene`, `soak`, `testing`, `tune` | Feature services: play, doctor, menus, accept, soak, farm, map build, dev loop, test runner, repository checks | everything above |
| commands | `host/commands/` | `makeX` command factories a game instantiates, plus Wisp's CLI entries | host and below |
| plugins | `plugins/` | TSTL, tsserver and lint plugins | none |

## Where things live

| change | edit today | target |
|---|---|---|
| A headless native's behaviour | `src/headless/client.ts` (Warcraft 3 families: `src/headless/warcraft3Natives.ts`) | `src/headless/natives/<family>.ts` in box 19 |
| A native declaration | producer `host/toolchain/natives.ts` (writes `src/natives/warcraft.d.ts`) | stays |
| Float or integer math | `src/sim/f32.ts`, `src/sim/intMath.ts`, `src/sim/binary32.ts` | `src/num/` in W-num |
| Map-side file I/O, hot reload, frame meter | `src/map/fileio.ts`, `src/map/hotReload.ts`, `src/map/frameMeter.ts` | stays |
| Pure map helper | `src/runtime/` | stays |
| A command a game instantiates | `host/commands/<verb>.ts` (Wisp's own program: `host/commands/repo.ts`) | stays |
| CLI runner, process spawning | `host/cli/cli.ts`, `host/cli/hostProcess.ts` | stays |
| Warcraft window, launcher, input | `host/os/warcraft/`, `host/os/platform/` | stays |
| Compile, bundle, package | `host/toolchain/compiler.ts`, `host/toolchain/luaBundle.ts`, `host/toolchain/package.ts` (map build: `host/compile/mapBuild.ts`) | stays |
| Soak, dev loop | `host/soak/soak.ts`, `host/dev/watch.ts` | stays |
| Test cost ceilings | `host/testing/testCost.ts` | stays |
| What consumers may import | `package.json` `exports`, one subpath per module (host modules keep their `wisp/scripts/...` subpaths); a change is listed in `CHANGELOG.md` | the target layout's subpaths as modules move |
| A feature's documentation | `docs/<feature>.md`, linked from `docs/index.md` | one doc per export |
| Tests | `test/`, colocated `src/**/*.tests.ts` | stays |

## Target layout and order

- Declared `exports` (box 18): `wisp/num/*`, `wisp/runtime/*`, `wisp/testing`, `wisp/map/*`, `wisp/natives`, `wisp/headless/*`, `wisp/cli`, `wisp/host/*`, `wisp/commands/*`, `wisp/lan`, `wisp/net`, `wisp/os`, `wisp/render`, `wisp/build`, `wisp/plugins/*`. Anything under `*/internal/` is not importable; a consumer importing an unexported path fails to resolve.
- `src/{num,natives,runtime,map,headless}`; `host/{cli,os,toolchain,lan,net,render,commands,headless,dev,testing,soak,repro,perf,client,tune,play}` (the build module is `host/toolchain/` because `.gitignore` ignores every `build/`).
- Game-specific behaviour (Shadow Strike, fighter/stage soak axes, Smashcraft paths) leaves Wisp: games register abilities and supply labels (W-game).
- Order: box 18 alone; then W-cli, box 23, W-num; then boxes 19-22 in parallel; then W-game; then box 24 alone; then box 25 alone.
