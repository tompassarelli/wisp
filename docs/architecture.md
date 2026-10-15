# Architecture: where code lives

Wisp is a game-agnostic toolkit: a TSTL map library (`src/`), a Bun host library and CLI (`scripts/`, becoming `host/`) and TSTL plugins (`plugins/`). It names no game.
The tables say where things are today; "in box N" or a W-id names the [wisp#1](https://github.com/tompassarelli/wisp/issues/1) slice that moves it.

## Modules and import direction

A module may import only the modules in its "may use" column. `src/` never imports `scripts/`; shipped code never imports `test/`.

| module | today | responsibility | may use |
|---|---|---|---|
| num | `src/sim/` | binary32 soft-float, f32 helpers, intMath | none |
| natives | `src/natives/warcraft.d.ts` | Warcraft native declarations (generated) | none |
| runtime | `src/runtime/` | Pure map-side helpers: lookup, record text, config, payload, modules, test harness | num |
| map | `src/platform/` | Map-side services calling natives: file I/O, dispatch, hot reload, frame meter, native driver, scene | runtime, num, natives |
| headless | `src/headless/` | Emulated Warcraft client: natives, lockstep, sync channel, journeys, Lua perf | map, runtime, num, natives |
| cli | `scripts/wisp/{cli,command,timings,hostProcess}.ts` | Command type, CLI runner, timings, process spawning | none |
| os | `scripts/platform/`, `scripts/warcraft/` | Host OS, desktop, Battle.net launcher, Warcraft window and input | cli |
| compiler | `scripts/*.ts` | TSTL compile, Lua bundle, map script, object data, natives producer, package | cli, runtime, num |
| lan, net | `scripts/wisp/lan/`, `scripts/wisp/net/` | Offline LAN pair pool; UDP lockstep peer, proxy, join code | cli, os; cli, headless |
| render | `scripts/wisp/browser/`, `scripts/wisp/fidelity/` | WebGL renderer, fidelity metrics | cli, os, headless, runtime, num |
| host | rest of `scripts/wisp/` | Feature services: play, doctor, menus, accept, soak, farm, dev loop, test runner | everything above |
| commands | `scripts/wisp/commands/` | `makeX` command factories a game instantiates, plus Wisp's CLI entries | host and below |
| plugins | `plugins/` | TSTL, tsserver and lint plugins | none |

## Where things live

| change | edit today | target |
|---|---|---|
| A headless native's behaviour | `src/headless/client.ts` (Warcraft 3 families: `src/headless/warcraft3Natives.ts`) | `src/headless/natives/<family>.ts` in box 19 |
| A native declaration | producer `scripts/natives.ts` (writes `src/natives/warcraft.d.ts`) | stays |
| Float or integer math | `src/sim/f32.ts`, `src/sim/intMath.ts`, `src/sim/binary32.ts` | `src/num/` in W-num |
| Map-side file I/O, hot reload, frame meter | `src/platform/fileio.ts`, `src/platform/hotReload.ts`, `src/platform/frameMeter.ts` | `src/map/` in box 23 |
| Pure map helper | `src/runtime/` | stays |
| A command a game instantiates | `scripts/wisp/commands/<verb>.ts` | `host/commands/` in box 25 |
| CLI runner, process spawning | `scripts/wisp/cli.ts`, `scripts/wisp/hostProcess.ts` | `host/cli/` in W-cli |
| Warcraft window, launcher, input | `scripts/warcraft/`, `scripts/platform/` | `host/os/` in box 25 |
| Compile, bundle, package | `scripts/compiler.ts`, `scripts/luaBundle.ts`, `scripts/package.ts` | `host/build/` in box 25 |
| Soak, dev loop | `scripts/wisp/soak.ts`, `scripts/wisp/watch.ts` | `host/soak/`, `host/dev/` in boxes 21, 22, 24 |
| Test cost ceilings | `scripts/wisp/testCost.ts` | `host/testing/` in box 24 |
| What consumers may import | `package.json` (no `exports` yet) | declared `exports` in box 18 |
| A feature's documentation | `docs/<feature>.md`, linked from `docs/index.md` | one doc per export |
| Tests | `test/`, colocated `src/**/*.tests.ts` | stays |

## Target layout and order

- Declared `exports` (box 18): `wisp/num/*`, `wisp/runtime/*`, `wisp/testing`, `wisp/map/*`, `wisp/natives`, `wisp/headless/*`, `wisp/cli`, `wisp/host/*`, `wisp/commands/*`, `wisp/lan`, `wisp/net`, `wisp/os`, `wisp/render`, `wisp/build`, `wisp/plugins/*`. Anything under `*/internal/` is not importable; a consumer importing an unexported path fails to resolve.
- `src/{num,natives,runtime,map,headless}`; `host/{cli,os,build,lan,net,render,commands,headless,dev,testing,soak,repro,perf,client,tune,play}`.
- Game-specific behaviour (Shadow Strike, fighter/stage soak axes, Smashcraft paths) leaves Wisp: games register abilities and supply labels (W-game).
- Order: box 18 alone; then W-cli, box 23, W-num; then boxes 19-22 in parallel; then W-game; then box 24 alone; then box 25 alone.
