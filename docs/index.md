# Wisp feature index

Start here when changing Wisp or building a map with it. The same pages ship
in the installed package under your project's `node_modules/wisp/docs/`.
Wisp supplies reusable services; the consuming game selects its commands,
paths, map content and acceptance journeys.

New map? Start from the [sample map](sample-map.md) (wisp:docs/sample-map.md):
a complete two-player map with its build, test, fresh-match and hot-reload
commands, and what a base map needs.

No Warcraft running? The [headless runtime](headless.md) (wisp:docs/headless.md)
runs your map's real bundle in simulated clients, in Bun and in 32-bit Lua:
desyncs between clients, error reports, hot reloads and what a player would see
wrong, in under a second for Smashcraft's two-client, 600-frame quick match.
Use it before reaching for the signed-in clients.

Changing code? [`wisp dev`](dev.md) (wisp:docs/dev.md) answers every save
with the saved files' type errors, the unit tests the save can affect, the
headless journeys (its own and the affected journey tests) and the whole type
check, each with its time since the save, and hot-reloads running clients when
given their folders.

Playtesting? [`wisp play`](play.md) (wisp:docs/play.md) goes from the
desktop to a match on the owner's display in one command: it checks the Wine
prefix, reuses or starts the signed-in Battle.net launcher, presses Play,
hosts the map, adds the game's computer opponent, starts its controller helper
and leaves the game fullscreen.

Tuning the feel? [`wisp tune`](tune.md) (wisp:docs/tune.md) serves a panel
on this computer that changes declared values, such as speeds and knockback,
in the running match through hot reloads, and writes the ones you keep back
into the source.

How Wisp compares with Wurst, the w3ts TypeScript template, WCSharp and
warcraft-vscode on the same map is measured in the
[toolchain comparison](comparison.md) (wisp:docs/comparison.md).

| Need | Feature and entry point | Setup or boundary |
| --- | --- | --- |
| Find the TypeScript caller of a callback failure | [TypeScript stack traces](stack-traces.md) (wisp:docs/stack-traces.md) | Opt-in compiler plugin; development diagnostics with CPU and size cost. |
| Map a reported Lua line back to TypeScript | [SourceErrors](../scripts/wisp/sourceErrors.ts) (wisp:scripts/wisp/sourceErrors.ts) | Retain each bundle's source map; the hot watcher prints changed reports. No stack plugin required for line mapping; a thrown value's report already starts with its TypeScript [throw site](stack-traces.md#throw-sites-without-the-plugin). |
| Keep runtime error text off the screen of a build players run | [Error reports on screen](hot-reload.md#error-reports-on-screen) (wisp:docs/hot-reload.md, wisp:src/runtime/config.ts) | `configureRuntime({ ..., errorsOnScreen: false })` in every bundle's `install()`; default true. The report still reaches the error file `hot --watch` reads. |
| Every signal after each save: type errors, affected unit tests, headless journeys, hot reload | [`wisp dev`](dev.md) and [makeDev](../scripts/wisp/commands/dev.ts) (wisp:docs/dev.md, wisp:scripts/wisp/commands/dev.ts) | The project declares its sources, type-check projects and whole-check command, tests (registry, preload, isolation groups, journey tests, per-file audits) and journey. A test that reads project files at run time declares them, or it runs on every save; a per-file audit checks only the saved files with `savedFiles()`. |
| Change declared values in a running match from a panel; keep them in source | [Live tuning](tune.md) and [makeTune](../scripts/wisp/commands/tune.ts) (wisp:docs/tune.md, wisp:scripts/wisp/commands/tune.ts) | The project declares each value's file, path to its number literal, kind (`f32` or `int`), range and step; every change is a hot reload of the declaration's module. Values copied into match state need the game's `install()` to reapply them. One publisher per client folder: not beside `hot --watch` or `dev --data`. |
| See what each frame costs: Lua time, native calls and catch-up frames on screen, after every hot reload and in 32-bit Lua runs CI can compare | [Frame cost](frame-cost.md) (wisp:docs/frame-cost.md): the [frame meter](../src/platform/frameMeter.ts), [runLuaPerf](../src/headless/luaPerf.ts) and `wisp perf` | Development and diagnostic entries call `installFrameMeter()` in every `install()` and `startFrameMeter()` once; a build players run never imports it. Headless runs need a Lua program that calls `runLuaPerf` and `makePerf`. |
| Change code without rehosting a match | [Hot reload](hot-reload.md) (wisp:docs/hot-reload.md); each save sends only the modules it changed ([what a reload sends](hot-reload.md#what-a-reload-sends)) | Install reloadable handlers, retain global state and reapply supported runtime object fields; supply each client's CustomMapData directory. The host creates each client's `<prefix>-hot` folder before a match or reload ([polling cost](hot-reload.md#what-polling-costs)). |
| Compile TypeScript with Warcraft's number rules | [Compiler](../scripts/compiler.ts) and [numeric plugin](../plugins/warcraft-numbers.ts) (wisp:scripts/compiler.ts, wisp:plugins/warcraft-numbers.ts) | Use the pinned toolchain and numeric plugin; synchronized code has Lua32 restrictions. |
| See number-rule errors in `bun run check` and the editor | [Number rules](../plugins/number-rules.ts), the [check command](../scripts/numberRules.ts) and the [editor plugin](../plugins/number-rules-service.ts) (wisp:plugins/number-rules.ts, wisp:scripts/numberRules.ts, wisp:plugins/number-rules-service.ts) | Run `bun node_modules/wisp/scripts/numberRules.ts MAP_TSCONFIG...` after `tsc --build`; it caches per-file results in build/number-rules.json. For the editor, add `{ "name": "wisp/plugins/number-rules-service.cjs", "project": "./tsconfig.map.json" }` to `plugins` in the tsconfig the editor uses for map files (`project` limits the rules to the map config's files). It loads in the workspace TypeScript 6 language service (tsserver); TypeScript 7's language server loads no plugins. |
| Calculate synchronized integer or binary32 values | [Integer helpers](../src/sim/intMath.ts) and [binary32 helpers](../src/sim/f32.ts) (wisp:src/sim/intMath.ts, wisp:src/sim/f32.ts) | Explicit operations for Warcraft integer and float semantics. |
| Build a map or replace only its script | [MapBuild](../scripts/wisp/mapBuild.ts) and [map declaration](../scripts/mapInfo.ts) (wisp:scripts/wisp/mapBuild.ts, wisp:scripts/mapInfo.ts) | Game supplies the base map, declaration, and any container, object data and imports; output stays outside the checkout. Needs `nix` on first use: the map packager compiles from wisp:native/map-pack.c, and nixpkgs' Lua 5.3 compiler is linked for the script syntax check. |
| Generate custom objects, including FileIO's ability | [Object data](../scripts/objectData.ts) (wisp:scripts/objectData.ts) | A build without its own war3map.w3a gets FileIO's ability; a map that writes war3map.w3a includes it with `abilityData()`. |
| Read reports or write reload payloads | [GameFiles](../scripts/wisp/gameFiles.ts) (wisp:scripts/wisp/gameFiles.ts) | Host-side file transport; runtime and host must share file identities. |
| Control existing Warcraft clients | [Clients](../scripts/wisp/clients.ts) and the [client command](../scripts/wisp/commands/client.ts) (wisp:scripts/wisp/clients.ts, wisp:scripts/wisp/commands/client.ts) | Supply the clients file ([format](sample-map.md#play-it-and-change-it-while-it-runs)) and private desktop sessions; game-specific journeys belong to the consumer. |
| Go from the owner's desktop to a match in one command: prefix check, Battle.net, Play, hosted game, opponent, controller helper, fullscreen | [`wisp play`](play.md) (wisp:docs/play.md, wisp:scripts/wisp/play.ts) | The game declares its prefix, Steam shortcut, map, game name, opponent step and helper. Runs on the owner's niri desktop with `grim`, `tesseract`, `xdotool` and `steam`; never signs in or starts Warcraft III.exe itself. |
| Start a new match of a map in every client | [Fresh match](../scripts/wisp/lobby.ts) (wisp:scripts/wisp/lobby.ts) | Hosts from the first client, joins the others, starts, and waits for each client's match-start acknowledgement; Create Game must show the configured map folder. |
| Run a map in simulated clients without Warcraft: desyncs, error reports, hot reloads, scene problems | [Headless runtime](headless.md) and `wisp headless` (wisp:docs/headless.md) | Bun runs the map's TypeScript, 32-bit Lua its compiled bundle. The game declares its local-only natives, global prefixes and journeys; Warcraft's engine, timing and rendering keep their native checks. |
| Give headless clients Warcraft's sync-message latency | [Network and timing model](network-model.md) and `syncDelivery()` (wisp:scripts/wisp/syncChannel.ts) | Latency, 25 ms turns and 60 Hz callbacks fitted to native traces; no client lag, so it does not predict a sender's saturation. |
| Drive simulated clients from the game's own input helper, in real time | [Input from another program](headless.md#input-from-another-program) (wisp:scripts/wisp/headlessInput.ts) | Each client's CustomMapData as a real folder in Warcraft's file formats, typed text read from a file the helper appends to, 60 frames a second of wall time with stalls; typing into edit boxes and clicks on frames placed by absolute points. |
| Check what a player sees: the stage is drawn, no effect is missing its model, lingers, or shows particles while hidden | [Player view checks](player-view.md) (wisp:docs/player-view.md) | Opt-in scene recorder for development builds, game-declared kinds and lifetimes; one off-screen frame per client measured against game-declared pixel features; render visibility from game-read MDX facts (wisp:scripts/wisp/models.ts) and declared cameras and parking places. |
| Give a project its command-line program | [runCli](../scripts/wisp/cli.ts) (wisp:scripts/wisp/cli.ts) | The project names its commands; a failure prints its message and exits 1, a usage problem exits 2. |
| Name the engine subsystem a native desync diverged in | [Desync reports](hot-reload.md#desync-reports) (wisp:scripts/wisp/desyncs.ts) | `hot --watch` compares the Desync.txt each client writes beside its `--data` folder; it does not replace the game's replay or integrity checks. |
| Generate the package for an immutable pin | [Package instructions](../README.md#consume-a-pinned-revision) (wisp:README.md) | Authored TypeScript, emitted Lua, declarations and this documentation ship together. |

The checkout's `bun run check`, `bun run test` and package-generation command
are Wisp development commands. This package does not install a universal
`wisp` executable: a project composes its own program from these services
with `runCli`, as wisp:examples/sample/scripts/sample.ts does. Smashcraft's
concrete commands and game-specific policy live in smashcraft:docs/typescript.md.
