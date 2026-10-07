# Wisp feature index

[Warcraft verification prior art](prior-art.md) compares reusable runtimes,
clients, renderers, hosts, replay parsers and engine access before extending
Wisp's native checks.
[Warsmash behavior notes](warsmash-notes.md) record independently written
life/death, animation/blending and map/model-format facts, separating source
research from native confirmations for headless checks and a standalone player.

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
Local held-key polling is modeled separately from other players' key events.
Use it before reaching for the signed-in clients. [`wisp soak`](soak.md)
(wisp:docs/soak.md) plays hundreds of its matches, computers and a fuzzed
controller against each other, and keeps a repro file for each problem found.

Changing code? [`wisp dev`](dev.md) (wisp:docs/dev.md) answers every save
with the saved files' type errors, the unit tests the save can affect, the
headless journeys (its own and the affected journey tests) and the whole type
check, each with its time since the save, and hot-reloads running clients when
given their folders.

Playtesting? [`wisp play`](play.md) (wisp:docs/play.md) goes from the
desktop to a match on the owner's display in one command: it checks the Wine
prefix, reuses or starts the signed-in Battle.net launcher, presses Play,
hosts the map once Warcraft III has read its ladder maps, starts the game's
controller helper, has the map start the match and leaves the game fullscreen.
[Driving Warcraft III without clicks](driving-warcraft.md)
(wisp:docs/driving-warcraft.md) compares the ways to make the game host,
join and start games without clicking its menus, with their account risk.

Testing in the real game without a Battle.net account? [`wisp lan`](lan.md)
(wisp:docs/lan.md) runs pairs of offline Warcraft III clients, each pair in a
network namespace with nothing but loopback, playing LAN matches that Wisp
hosts: `wisp lan pool --pairs N` starts them, `wisp lan fresh MAP` starts a
match, and the host logs every turn's actions and compares every client's
checksum each turn (`wisp engine actions`). Every `wisp engine` command works
on them, breakpoints included. Keep signed-in clients for what needs
Battle.net itself.

For lobby protocol checks, [`wisp lan dummy`](lan.md#dummy-lobby-checks)
uses the separate GoWarcraft3 dummy beside side a for repeated joins, map and
profile messages, handicap changes and leaves; it does not execute the map.

Checking on the signed-in clients? [`wisp accept`](accept.md)
(wisp:docs/accept.md) runs every native check a game declares, next to the
issue each closes, in as few fresh matches as their maps allow, and prints
pass, fail or needs-look per check with its evidence folder.

Many scripted native checks? Never start a new game per check: in
Smashcraft (7 Oct 2026) a new game cost 42 to 64 s against about 24 s for
the check itself. Start one game per client pair, give the map a developer
command that puts the match back exactly as the map started it (Smashcraft's
`-dev reset`, held by a test comparing the next match's checksums and saved
moments with a new game's first match), run the headless side of every
check alongside, and shard the checks over the offline LAN pool. Smashcraft's
`bun wisp pad SCRIPT|DIR... [--pairs N]` does all four
(smashcraft:docs/native-bot-session.md, "Many scripts in one game").

A client dropped from Battle.net, crashed, stuck on its login, loading
screen or an old lobby, or sharing its prefix with a second runtime?
[`wisp client doctor`](doctor.md) (wisp:docs/doctor.md) finds each client's state
and runs its known recovery, step by step. A launcher at its sign-in form
is signed in with the client's declared account, so nobody signs in by hand;
it stops with one plain line only for a state it can't recover.
`wisp client sign-out CLIENT...` signs a client out. Run it instead of driving a client by
hand; `play`, `accept` and bot sessions run it before they start.

What is a client doing? [`wisp client watch`](watch.md) (wisp:docs/watch.md) prints
each client's state from events, never its screen: launcher, signing in,
signed in, the menu screen, lobby, loading, in match, results, disconnected or
crashed, plus its map's load errors and the ladder scan, each with its source.
Run it before clicking, reading or waiting on a client; code waits on the same
states with `waitFor`, and `unlessLost` stops any wait when a client crashes.

A native desync? [`wisp engine`](engine.md) (wisp:docs/engine.md) is a
read-only debugger into Warcraft III's engine. It names the first section and
turn where two clients' `Desync.log` dumps differ, follows every agent born
and freed in each client's presence table with its class, aligns two clients'
births, and records the game's stack at each birth. It is for your own
development clients only. [Why these tools exist](engine.md#why-these-tools-exist):
on Smashcraft #158 they cut a desync hunt from hours to minutes. Session
runners do it on their own: the [desync autopsy](autopsy.md)
(wisp:docs/autopsy.md) polls the clients during a session and prints
"first divergent birth #N Class at turn T on client X" when they desync.

Tuning the feel? [`wisp tune`](tune.md) (wisp:docs/tune.md) serves a panel
on this computer that changes declared values, such as speeds and knockback,
in the running match through hot reloads, and writes the ones you keep back
into the source.

Setting up CI for a game? The [consumer CI template](ci.md) (wisp:docs/ci.md)
is one reusable GitHub Actions workflow: check, emitted-Lua and numeric
tests, headless journeys and a bounded soak on free hosted runners, plus an
opt-in map build that keeps the revision-named .w3x and its digest on the
game's own self-hosted runner.

How Wisp compares with Wurst, the w3ts TypeScript template, WCSharp and
warcraft-vscode on the same map is measured in the
[toolchain comparison](comparison.md) (wisp:docs/comparison.md).

| Need | Feature and entry point | Setup or boundary |
| --- | --- | --- |
| Check unit owner, facing, life, mana, killing and removal in Bun and Lua32 | [Unit states](headless.md#unit-states), `HeadlessMap.unitStates` and `LuaHeadlessMap.unitStates` | Declare object-data initial life, mana and maximums by type ID, or explicitly set them before reading. Twelve shared cases include fractional death and writes after death; combat and revival stay outside this model. |
| Measure whether offline clients consume game turns faster than real time | [Faster turn delivery](lan.md#faster-turn-delivery), `wisp lan speed N --pair K` | Experimental host pacing, 1–16 times normal delivery; checksums and lag limits remain active. Actual client speed and rendering cost must be measured. |
| Render selected headless match frames from the map's models and textures; check named sound cues by frame | [Rendered frames and sound cues](headless.md#rendered-frames-and-sound-cues), `headless --render DIR --frames N...`, `--sound-cues FILE` | Supply `render.readAsset`; Chrome uses WebGL2. Keep private assets and renders outside repositories. Matched look checks and explicit cue calls can close headless; timing, shading and audible output still need native. |
| Deliver setup and scripted inputs to an offline map, then pause or step its simulation without keyboard or chat | [`wisp engine drive`](engine.md#native-driver), the existing FileIO channel and `nativeDriver` (wisp:src/platform/nativeDriver.ts) | Opt-in diagnostic map adapter; all playing clients must receive and agree on the same numbered payload before it executes. Own declared offline clients only. |
| Capture a native framebuffer with a bounded completion and no orphaned capture process | [Frame probe](player-view.md#frame-probe), `capture` (wisp:scripts/warcraft/desktop.ts) | Eight-second timeout; interruption kills and reaps the capture child. Exact game-frame checks additionally require the consumer's held pose and matching request/completion receipts. |
| Record up to five minutes of actual native callback costs, full-run p50/p95/p99/worst, and native-fit windows without OCR | [Bounded frame-cost capture](frame-cost.md#a-bounded-native-capture), `startFrameCostCapture` (wisp:src/platform/frameMeter.ts) and host reader (wisp:scripts/wisp/frameCostCapture.ts) | An already-running diagnostic meter; 1–18,000 callbacks, raw per-client receipts, no new handles. Source changes or a missing clock invalidate the capture. Native session health and gameplay phase remain native gates. |
| Find the TypeScript caller of a callback failure | [TypeScript stack traces](stack-traces.md) (wisp:docs/stack-traces.md) | Opt-in compiler plugin; development diagnostics with CPU and size cost. |
| Map a reported Lua line back to TypeScript | [SourceErrors](../scripts/wisp/sourceErrors.ts) (wisp:scripts/wisp/sourceErrors.ts) | Retain each bundle's source map; the hot watcher prints changed reports. No stack plugin required for line mapping; a thrown value's report already starts with its TypeScript [throw site](stack-traces.md#throw-sites-without-the-plugin). |
| Keep runtime error text off the screen of a build players run | [Error reports on screen](hot-reload.md#error-reports-on-screen) (wisp:docs/hot-reload.md, wisp:src/runtime/config.ts) | `configureRuntime({ ..., errorsOnScreen: false })` in every bundle's `install()`; default true. The report still reaches the error file `hot --watch` reads. |
| Every signal after each save: type errors, affected unit tests, headless journeys, hot reload | [`wisp dev`](dev.md) and [makeDev](../scripts/wisp/commands/dev.ts) (wisp:docs/dev.md, wisp:scripts/wisp/commands/dev.ts) | The project declares its sources, type-check projects and whole-check command, tests (registry, preload, isolation groups, journey tests, per-file audits) and journey. A test that reads project files at run time declares them, or it runs on every save; a per-file audit checks only the saved files with `savedFiles()`. |
| Change declared values in a running match from a panel; keep them in source | [Live tuning](tune.md) and [makeTune](../scripts/wisp/commands/tune.ts) (wisp:docs/tune.md, wisp:scripts/wisp/commands/tune.ts) | The project declares each value's file, path to its number literal, kind (`f32` or `int`), range and step; every change is a hot reload of the declaration's module. Values copied into match state need the game's `install()` to reapply them. One publisher per client folder: not beside `hot --watch` or `dev --data`. |
| See what each frame costs: Lua time, native calls and catch-up frames on screen, after every hot reload and in 32-bit Lua runs CI can compare; predict what a frame costs in Warcraft | [Frame cost](frame-cost.md) (wisp:docs/frame-cost.md): the [frame meter](../src/platform/frameMeter.ts), [runLuaPerf](../src/headless/luaPerf.ts), `wisp perf`, `wisp headless --cost`, the [native cost model](frame-cost.md#predicted-native-cost) (wisp:src/headless/nativeCost.ts) and its check and fit against native overlay readings, `wisp perf native` and `wisp perf fit` ([nativeFit](../scripts/wisp/nativeFit.ts)) | Development and diagnostic entries call `installFrameMeter()` in every `install()` and `startFrameMeter()` once; a build players run never imports it. Headless runs need a Lua program that calls `runLuaPerf` and `makePerf`. |
| Change code without rehosting a match | [Hot reload](hot-reload.md), `wisp hot` and [makeHot](../scripts/wisp/commands/hot.ts) (wisp:docs/hot-reload.md, wisp:scripts/wisp/commands/hot.ts); each save sends only the modules it changed ([what a reload sends](hot-reload.md#what-a-reload-sends)) | Install reloadable handlers, retain global state and reapply supported runtime object fields; supply each client's CustomMapData directory. The host creates each client's `<prefix>-hot` folder before a match or reload ([polling cost](hot-reload.md#what-polling-costs)). |
| Compile TypeScript with Warcraft's number rules | [Compiler](../scripts/compiler.ts) and [numeric plugin](../plugins/warcraft-numbers.ts) (wisp:scripts/compiler.ts, wisp:plugins/warcraft-numbers.ts) | Use the pinned toolchain and numeric plugin; synchronized code has Lua32 restrictions. |
| Measure whether native clients traverse the same hash tables in the same order | [Native table iteration order](headless.md#native-table-iteration-order), `bun test/table-order/build.ts BASE.w3m OUT.w3x` | An offline LAN pair writes checksums and complete orders for 1,000 string keys and 1,000 sparse integer keys; map output stays outside the checkout. |
| Preserve each iteration's captured `for (let ...)` binding in Lua | [Captured loop bindings](loop-bindings.md) (wisp:plugins/loop-bindings.ts) | Automatic with the numeric plugin in full and incremental compilation; callbacks keep their iteration's binding. |
| See number-rule errors in `bun run check` and the editor | [Number rules](../plugins/number-rules.ts), the [check command](../scripts/numberRules.ts) and the [editor plugin](../plugins/number-rules-service.ts) (wisp:plugins/number-rules.ts, wisp:scripts/numberRules.ts, wisp:plugins/number-rules-service.ts) | Run `bun node_modules/wisp/scripts/numberRules.ts MAP_TSCONFIG...` after `tsc --build`; it caches per-file results in build/number-rules.json. For the editor, add `{ "name": "wisp/plugins/number-rules-service.cjs", "project": "./tsconfig.map.json" }` to `plugins` in the tsconfig the editor uses for map files (`project` limits the rules to the map config's files). It loads in the workspace TypeScript 6 language service (tsserver); TypeScript 7's language server loads no plugins. |
| Catch a raw float `+ - *` that Warcraft would round differently: Lua replays and checks in a Lua32 rounding them toward zero as well as a stock one | [Raw float rounding](headless.md#raw-float-rounding) and [towardZeroLua](../scripts/wisp/towardZeroLua.ts) (wisp:native/toward-zero.h, wisp:scripts/wisp/towardZeroLua.ts) | A LUA_32BITS Lua 5.3.6 compiled with the header; `towardZeroLua(DIR)` builds one with `nix`, CI with `make`. Toward zero is the nearest model of Warcraft's rounding found, not its exact rule. |
| Calculate synchronized integer or binary32 values | [Integer helpers](../src/sim/intMath.ts), [f32](../src/sim/f32.ts) and [binary32 helpers](../src/sim/binary32.ts) (wisp:src/sim/intMath.ts, wisp:src/sim/f32.ts, wisp:src/sim/binary32.ts) | Explicit operations for Warcraft integer and float semantics. Write one operation per `f32(a + b)`, `f32(a - b)`, `f32(a * b)` or `f32(a / b)`: in Lua the compiler routes it through the exact binary32 helpers (about 1 µs in Lua32; a quotient, through `divideFloat32`, more), because Warcraft's raw `+` and `*` can land an ulp toward zero and its raw `/` an ulp off nearest; an operation nested inside stays raw, as do a product with and a quotient by a power-of-two literal. `f32(x)` compiles to `x`, and `f32(0.1)` to the binary32 nearest 0.1. Non-integer literals compile to exact hexadecimal floats, because Warcraft reads a decimal that isn't exactly binary32 with its own rounding. |
| Build a map or replace only its script | [MapBuild](../scripts/wisp/mapBuild.ts) and [map declaration](../scripts/mapInfo.ts) (wisp:scripts/wisp/mapBuild.ts, wisp:scripts/mapInfo.ts) | Game supplies the base map, declaration, and any container, object data and imports; output stays outside the checkout. Full MPQ hash tables grow on import addition; source archives stay unchanged. Needs `nix` on first use: the map packager compiles from wisp:native/map-pack.c, and nixpkgs' Lua 5.3 compiler is linked for the script syntax check. |
| Describe a menu panel as typed data; generate its FDF, TOC and a map module that creates it with native frame calls and returns typed handles, with bad names, templates and anchors reported at build time | [Declarative frames](ui.md), `generateFrames` and `writeFrames` (wisp:docs/ui.md, wisp:scripts/wisp/frames.ts) | Game runs `writeFrames` before compiling and passes its entries to MapBuild's `imports`; FRAME, BACKDROP, TEXT and GLUETEXTBUTTON only. Clicks, focus and per-client presentation stay in the game's script. |
| Package hundreds of private imports quickly and losslessly: every import, base file and generated file goes in and is verified in one archive opening each | [Asset ingestion](asset-ingestion.md), `map-pack replace-list` and `extract-list` (wisp:docs/asset-ingestion.md, wisp:native/map-pack.c) | Automatic in `MapBuild.build`. Entries are stored zlib-compressed byte for byte, never re-encoded; sources are only read. Measured 49 s to 12.2 s packaging and 23 s to 2.0 s extraction for Smashcraft's 1,108 clip and portrait imports. |
| Generate custom objects, including FileIO's ability | [Object data](../scripts/objectData.ts) (wisp:scripts/objectData.ts) | A build without its own war3map.w3a gets FileIO's ability; a map that writes war3map.w3a includes it with `abilityData()`. |
| Read reports or write reload payloads | [GameFiles](../scripts/wisp/gameFiles.ts) (wisp:scripts/wisp/gameFiles.ts) | Host-side file transport; runtime and host must share file identities. |
| Know what each client is doing (closed, launcher, signing in, signed in, menu screen, lobby, loading, in match, results, disconnected, crashed), its load errors and ladder scan, from the menus' socket, its log, crash reports, match receipts and processes; wait on a state | [`wisp client watch`](watch.md), `wisp client watch` and `wait` and [ClientWatch](../scripts/wisp/watch.ts) (wisp:docs/watch.md, wisp:scripts/wisp/clientWatchCommand.ts, wisp:scripts/wisp/watch.ts) | The clients file's `documents` (in a Wine prefix) and, for menu screens, `menuReportPort` with the current menu page installed; run where the host's processes are visible. `filePrefix` adds the map's match receipts. |
| Control existing Warcraft clients | [Clients](../scripts/wisp/clients.ts) and the [client command](../scripts/wisp/commands/client.ts) (wisp:scripts/wisp/clients.ts, wisp:scripts/wisp/commands/client.ts) | Supply the clients file ([format](sample-map.md#play-it-and-change-it-while-it-runs)) and private desktop sessions; game-specific journeys belong to the consumer. Return and typed text go only to a client in a match with its menu page connected ([watch.md](watch.md#typing-only-into-a-match)). |
| Gate native setup on observed chat entry and every selected client's new requested map receipt | [Chat setup](watch.md#confirmed-chat-setup), `openObservedChat` and `confirmedCommand` (wisp:scripts/wisp/chatSetup.ts) | Supply the map's chat observation and requested receipt predicate; input execution follows confirmation. A missed Return or receipt names the first boundary and client. |
| Go from the owner's desktop to a match in one command: prefix check, Battle.net, Play, the map hosted after Warcraft III's ladder scan, controller helper, the map's match setup, fullscreen | [`wisp play`](play.md) (wisp:docs/play.md, wisp:scripts/wisp/play.ts) | The game declares its prefix, Steam shortcut, map, request to the map, match step, helper and `menuReportPort`; it hosts a private game only through the installed menu page and stops without one. Runs on the owner's niri desktop with `grim`, `tesseract`, `xdotool` and `steam`; never signs in or starts Warcraft III.exe itself. |
| Run the game's declared native checks as one batched session: pass, fail or needs-look per check, evidence kept privately | [`wisp accept`](accept.md) and [makeAccept](../scripts/wisp/commands/accept.ts) (wisp:docs/accept.md, wisp:scripts/wisp/accept.ts, wisp:scripts/wisp/acceptLive.ts) | The game declares checks as data (map profile, setup commands, captures, pass rules) and supplies its fresh-match start and receipt file names; `--dry-run` prints the plan without touching clients. With `shards` (offline pool pairs), the sessions split over every selected pair at once and the reports merge. Visual judgement beyond declared rules stays with the owner (needs-look). |
| Bring every client to a ready state: recover a dropped, crashed, login-stuck, loading-stuck or lobby-stuck client, or two runtimes on one prefix | [`wisp client doctor`](doctor.md) and [makeDoctor](../scripts/wisp/clientDoctorCommand.ts) (wisp:docs/doctor.md, wisp:scripts/wisp/doctor.ts, wisp:scripts/wisp/doctorHost.ts) | The game declares how each signed-in client's Battle.net starts and supplies `wisp client watch`'s ClientWatch; `offline: true` clients need no launcher declaration and are checked without control, leaving recovery to their LAN pool. `withDoctor` runs it before a run and once after a failure. Signs in at the launcher's sign-in form with the client's declared `accounts` entry (commands that print the username and password; values only piped to the form); without one, the form stops it with one line. `wisp client sign-out CLIENT...` (`makeSignOut`) removes the saved login. |
| Keep a main-display `wisp play` from changing the display settings of a client on a private desktop that shares its prefix: declared settings restored before a run, the played file put back when the game exits | [Display settings](display-settings.md) (wisp:docs/display-settings.md, wisp:scripts/warcraft/preferences.ts, wisp:scripts/wisp/restorePreferences.ts) | A client declares `displaySettings` in the clients file for doctor; `play` needs no declaration, and its optional `recommendedSettings` fill only keys the file lacks. War3Preferences.txt's `[Video]` section only for doctor; the whole file for play. |
| Start a new match of a map in every client | [Fresh match](../scripts/wisp/lobby.ts) (wisp:scripts/wisp/lobby.ts) | Hosts a private game from the first client through its menu page, joins the others by name and password, starts, and waits for each client's match-start acknowledgement; every client needs `menuReportPort` and the installed page. |
| Host, join, start or leave a game without clicks, through the menus' own socket; which no-click approach to use and why | [Driving Warcraft III without clicks](driving-warcraft.md) and `wisp menus` (wisp:docs/driving-warcraft.md, wisp:scripts/wisp/menus.ts) | Needs Wisp's menu page in the game's `_retail_/webui` and the registry value `Allow Local Files`, set once per prefix with the account owner's agreement (W3Champions' install method; see the page's account risk). Leaving a running match stays keys. |
| Run a map in simulated clients without Warcraft: desyncs, error reports, hot reloads, scene problems and unmodeled native calls | [Headless runtime](headless.md) and `wisp headless` (wisp:docs/headless.md) | Bun runs the map's TypeScript, 32-bit Lua its compiled bundle. Missing-native failures name native, client and frame, including in JSON; maps declare supplied behavior or exact `intentionalNoops` names with reasons. Local-only calls still require modeled behavior. |
| Author custom units and leveled abilities with typed setters | [Object data](object-data.md) and [sample definitions](../examples/sample/scripts/objects.ts) | Share named IDs with map code; `UnitObject` and `AbilityObject` write the existing format 2 encoder, including nonzero data columns and unreal type 2. `abilityData` keeps FileIO included. |
| Find what a playtest would: many matches by computers and a fuzzed controller | [`wisp soak`](soak.md) and [makeSoak](../scripts/wisp/commands/soak.ts) (wisp:docs/soak.md, wisp:scripts/wisp/soak.ts) | The game declares its roster, policies, controller and a match setup module (`defineSoak`, `defineSoakGame`), and may add detectors of its own (`findings`); at most four worker processes and thirty minutes; each finding writes a repro file that `soak --repro FILE` plays again. Headless runtime's boundaries; frame costs are Bun's scaled by the game's `costScale`, plus Warcraft's native-call and typing costs the model predicts (the driver's `typed`). |
| Give headless clients Warcraft's sync-message latency | [Network and timing model](network-model.md) and `syncDelivery()` (wisp:src/headless/syncChannel.ts) | Latency, 25 ms turns and 60 Hz callbacks fitted to native traces; no client lag, so it does not predict a sender's saturation. |
| Import a current native Warcraft replay as timed player actions and compare it with its LAN host log; replay a game-supported input journey and scrub its saved frames | [`wisp repro import`](repro.md#importing-a-native-replay) and [importNativeReplay](../scripts/wisp/replayImport.ts) (wisp:scripts/wisp/replayImport.ts) | Uses MIT w3gjs 4.3.0 for metadata and game-data boundaries, Wisp’s current native-action decoder for payloads. Retains raw player blocks, every game-data record and unknown tails with decompressed offsets. Only a declared game adapter simulates inputs; private replay files stay outside the repository. |
| Replay or inspect a saved moment, or shrink a soak failure: `wisp repro FILE` verifies its ending checksum, `--test NAME` writes a test, `--frame N --out FILE [--diff-frame N\|previous]` saves canonical state and a field-path diff, `--view` opens a frame slider with both clients' state and declaration links, `--shrink [--out FILE]` removes unnecessary soak inputs | [Repros](repro.md) and [makeRepro](../scripts/wisp/commands/repro.ts) (wisp:docs/repro.md, wisp:src/runtime/repro.ts, wisp:src/runtime/recordText.ts) | The game saves with `writeRepro`, declares `replayRepro`, and optionally `inspectRepro` and `viewerSources` for declaration links. A `soak` declaration names the existing soak module and the directory for generated Bun regression tests. |
| Drive simulated clients from the game's own input helper, in real time | [Input from another program](headless.md#input-from-another-program) (wisp:scripts/wisp/headlessInput.ts) | Each client's CustomMapData as a real folder in Warcraft's file formats, typed text read from a file the helper appends to, 60 frames a second of wall time with stalls; typing into edit boxes and clicks on frames placed by absolute points. |
| Check what a player sees: the stage is drawn, no effect is missing its model, lingers, or shows particles while hidden | [Player view checks](player-view.md) (wisp:docs/player-view.md) | Opt-in scene recorder for development builds, game-declared kinds and lifetimes; one off-screen frame per client measured against game-declared pixel features; render visibility from game-read MDX facts (wisp:scripts/wisp/models.ts) and declared cameras and parking places. |
| Bracket native framebuffer pixels on the same monotonic clock as an injected input | [`captureTimed`](player-view.md#frame-probe) (wisp:scripts/warcraft/desktop.ts) | Returns RGB with acquisition start/end nanoseconds from the caller's clock; serial samples retain capture uncertainty. A consumer identifies its actual game pixels and gates using the conservative end time, not a diagnostic marker or midpoint. |
| Give a project its command-line program; name a new command or flag | [runCli](../scripts/wisp/cli.ts) and the [command vocabulary](cli.md) (wisp:scripts/wisp/cli.ts, wisp:docs/cli.md) | The project names its commands from the vocabulary's nouns, verbs and flags (`PROGRAM NOUN [VERB] [OBJECT...]`, one meaning per flag); a new top-level noun needs a row there. A failure prints its message and exits 1, a usage problem exits 2. |
| Name a native desync's cause without a human step: every native session runner (`wisp client doctor`, `wisp client watch`, runs wrapped by `withDoctor` with `autopsy`) polls the clients' presence tables, and on a new desync report prints the first divergent birth, its class, turn and client, and saves the evidence | [Desync autopsy](autopsy.md) and [withAutopsy](../scripts/wisp/engine/autopsy.ts) (wisp:docs/autopsy.md, wisp:scripts/wisp/engine/autopsy.ts) | Your own maps and clients only, not cheating ([guardrails](autopsy.md#guardrails)). Clients from the clients file; read-only. Without memory reads (`kernel.yama.ptrace_scope`), one line says so and the autopsy uses the Desync.logs alone. |
| Run offline Warcraft III clients in pairs, each pair in its own network namespace with nothing but loopback and no Battle.net account, and play LAN matches of your map on them hosted by Wisp: every turn's actions logged, every client's checksum compared each turn | [`wisp lan`](lan.md) and [lan](../scripts/wisp/commands/lan.ts) (wisp:docs/lan.md, wisp:scripts/wisp/lan/) | Your own offline clients and maps only, never signed-in Battle.net clients, not cheating ([guardrails](lan.md#guardrails)). Joining needs a one-instruction code switch that is undone within a fraction of a second, made only after a loopback-only check; builds checked: 3.0.0.24268. `setup` needs an existing install to reflink; `pool` needs the private-desktop launcher and the machine-capacity helper; `pool --fps N` measures a different foreground/background cap with the other graphics settings fixed. About 0.5–0.75 core, 0.8–1.4 GB of memory and 0.7 GB of GPU memory per client at the parity profile. |
| What Warcraft's network layer delivered, per turn, to a pair of pool clients: orders, BlzSendSyncData payloads with their prefixes, key and frame events, chat, leaves, desyncs; and each presence birth placed in its turn | [`wisp engine actions`](engine.md#actions) and `wisp engine diff ACTIONS.log POLL.log` (wisp:scripts/wisp/lan/actionsCommand.ts, wisp:scripts/wisp/engine/actionLog.ts) | Pool clients only; the log comes from Wisp's LAN host, not from reading a signed-in client's traffic. |
| Find why two clients desynced, inside the engine: the first differing turn and section of their `Desync.log`, every agent born and freed in each client's presence table with its class, the two clients' births aligned, the game's stack at each birth, the code callback behind a birth at its TypeScript line and the exact Lua and TypeScript stack at each birth, and the table found again after a Warcraft update | [`wisp engine`](engine.md) and [makeEngine](../scripts/wisp/commands/engine.ts) (wisp:docs/engine.md, wisp:scripts/wisp/engine/, [Lua stacks](engine.md#lua-stacks) in wisp:scripts/wisp/engine/lua.ts) | Development clients from the clients file only, never other players' games ([guardrails](engine.md#guardrails)). Two tiers: passive reads from outside the game (`desync`, `poll` with its closure provenance, `diff`, `locate`) may follow a client signed in to Battle.net; traps (`watch`, `watch --lua`, which stops the thread with ptrace, and `locate --watch`) refuse unless the client is verifiably offline. A read tries first and usually works (Proton's user namespace, or a Wisp launcher as the client's ancestor); when it fails, the command prints the `kernel.yama.ptrace_scope` commands, which only the owner runs. `watch` needs `perf`. Offsets per build are in wisp:scripts/wisp/engine/offsets.json. |
| Name the engine subsystem a native desync diverged in | [Desync reports](hot-reload.md#desync-reports) (wisp:scripts/wisp/desyncs.ts) | `hot --watch` compares the Desync.txt each client writes beside its `--data` folder; it does not replace the game's replay or integrity checks. |
| Run a game's check, emitted-Lua and numeric tests, headless journeys and bounded soak in GitHub Actions; build the map only on the game's self-hosted runner | [Consumer CI](ci.md), the reusable workflow wisp:.github/workflows/consumer.yml and [ciMapBuild](../scripts/wisp/ciMapBuild.ts) (wisp:docs/ci.md, wisp:scripts/wisp/ciMapBuild.ts) | Pin `uses:` and `wisp-ref` to one Wisp commit. Public jobs are source and headless only and upload command output and repros (`diagnostics: false` turns that off). `private-map-build: true` writes `STORE/NAME-COMMIT.w3x` and its `.sha256` on a runner labeled `wisp-private`, never as an Actions artifact; no release or deployment. |
| Generate the package for an immutable pin | [Package instructions](../README.md#consume-a-pinned-revision) (wisp:README.md) | Authored TypeScript, emitted Lua, declarations and this documentation ship together. |

The checkout's `bun run check`, `bun run test` and package-generation command
are Wisp development commands. This package does not install a universal
`wisp` executable: a project composes its own program from these services
with `runCli`, as wisp:examples/sample/scripts/sample.ts does, naming its
commands by the [command vocabulary](cli.md) (wisp:docs/cli.md). Smashcraft's
concrete commands and game-specific policy live in smashcraft:docs/typescript.md.

## Machine-readable results

`headless`, `soak`, `repro`, `accept`, and `perf` support `--json`: one JSON
object per result and a final summary with verdict, counts, and elapsed time.
See the [CLI fields](cli.md), [headless](headless.md), [soak](soak.md),
[repro](repro.md), [accept](accept.md), and [performance](frame-cost.md) pages.
