# Warcraft verification prior art

Research date: 7 October 2026. Decision: which existing tools can move checks
out of Warcraft, or remove repeated client setup, before Wisp writes more
engine control. Wisp's existing headless runtime, synchronized hot reload,
scene recorder, menu socket and LAN host are the baseline, not missing features.
Wurst is covered separately by #41.

**Done when:** six problem groups record links, licences, maintenance,
capabilities Wisp lacks and a verdict; searches cover GitHub, Hive Workshop,
W3Champions, YDWE and KKWE/JAPI; actionable shortcuts have issue/comment
payloads. **Not required:** another engine, native starts, copied external code,
or a benchmark of every candidate.

The next choices are: measure Wisp's existing file channel for #38; use the
installed `war3-model` for #40; inspect FLO's turn clock and observer speed for
#39; measure dummy network clients for lobby tests; import real replay actions
with an existing parser. No reviewed source establishes modern Warcraft engine
frame stepping or rendering suppression as a ready library.

## Game-free verification

| Source | Licence and maintenance | Current capability Wisp lacks | Verdict and next action |
| --- | --- | --- | --- |
| [Warsmash](https://github.com/Retera/WarsmashModEngine), especially [simulation](https://github.com/Retera/WarsmashModEngine/tree/f9e0aeed4be372d6016519d0e97b384aa873f374/core/src/com/etheller/warsmash/viewer5/handlers/w3x/simulation) and `environment/PathingGrid.java` | [AGPL-3.0](https://github.com/Retera/WarsmashModEngine/blob/f9e0aeed4be372d6016519d0e97b384aa873f374/LICENSE); pushed 5 Oct 2026. Older MIT descriptions are obsolete; README explains the change. | An independent engine models unit data, combat, pathing and terrain. Wisp's fallback natives return defaults, and its unit model has no general combat/pathing. Warsmash README excludes post-1.33 model formats; it is not current retail parity. | **hypotheses only** (2026-10-31, [clean room](clean-room.md)): no new fact is sourced from it, its recorded facts wait for native fixtures, and Wisp does not emulate a unit simulation ([standalone profile](headless.md#standalone-profile)); no AGPL implementation is derived into MIT Wisp. Add evidence to #41's unit-state issue draft; use native fixtures for each selected behavior. Running a second complete engine is not the shortcut. |
| [War3Net](https://github.com/Drake53/War3Net), [Build 6.0.3](https://www.nuget.org/packages/War3Net.Build/6.0.3), [Build.Core](https://github.com/Drake53/War3Net/tree/18e88f0e1f67e6b16870dcbcd827740275fe2173/src/War3Net.Build.Core) | [MIT](https://github.com/Drake53/War3Net/blob/18e88f0e1f67e6b16870dcbcd827740275fe2173/LICENSE); pushed 1 Oct 2026. | Maintained map/object-data, MPQ and JASS parsing/serialization. The README lists Runtime, Rendering and Replay packages as coming soon; native JASS VM/full emulation is roadmap. | **learn-from** file-format behavior to feed object/unit data into headless tests, attached to #41's object-authoring/unit-state drafts. Do not replace Wisp's runtime with an advertised future runtime. Reusing a C# parser would add a host-language boundary; decide it only for a failing format case. |
| [mdx-m3-viewer JASS context](https://github.com/flowtsohg/mdx-m3-viewer/tree/2ff0bc00c6363f425016e23d88c0fb2929d3b3cc/src/utils/jass2) | MIT; README says no longer actively maintained; last push 27 Aug 2025. | JASS translated to Lua on a JavaScript Lua VM; some natives implemented. Author explicitly says not to expect whole maps to run. | **ignore** for Wisp's real Lua/TypeScript journeys: incomplete runtime and another translation do not close a current box. |
| [Python JASS interpreter](https://www.hiveworkshop.com/threads/ever-wanted-to-run-jass-scripts-outside-of-war3.266101/) | No licence established from the primary thread; last edit 9 Jun 2015. | Standalone JASS evaluation; fully emulated Warcraft runtime remains TODO. | **ignore**: Wisp already executes its map bundle and models the required natives. No copying rights established. |

## Programmatic clients

| Source | Licence and maintenance | Current capability Wisp lacks | Verdict and next action |
| --- | --- | --- | --- |
| [Lua Live Coding / WC3interpreter](https://www.hiveworkshop.com/threads/lua-live-coding.366724/) | Resource's explicit licence not established; v1.5.0, updated 6 Dec 2025, pending Hive review. | External commands, indexed outputs and coroutine breakpoints, including replay inspection. Numbered input filenames avoid Warcraft's cached reads; reconnect requires index resynchronization. Multiplayer is deliberately disabled because file contents must be synchronized. | **learn-from** these protocol facts for #38. Measure Wisp's synchronized hot-reload/FileIO path first, use fresh command paths and indexed acknowledgement, and deliver the same command on the same simulation frame. Copying the resource is unnecessary and unauthorised. |
| [GoWarcraft3 `w3gsclient`](https://github.com/nielsAD/gowarcraft3/blob/f13251b6caed199c3347214f4591e7ccaa96c7c7/cmd/w3gsclient/main.go), [dummy client](https://github.com/nielsAD/gowarcraft3/tree/f13251b6caed199c3347214f4591e7ccaa96c7c7/network/dummy) | [MPL-2.0](https://github.com/nielsAD/gowarcraft3/blob/f13251b6caed199c3347214f4591e7ccaa96c7c7/LICENSE); last pushed 18 Mar 2023, not archived. | A real command-line dummy player, lobby join state machine, peer connections and packet readers. Wisp has a host but tests lobby joins with real clients. It does not execute the map or produce its engine checksum. | **reuse** as a separate program for a measured 20-join lobby check, subject to today's 3.0 handshake. New dummy-client issue; preserve MPL notices, and publish source of modified covered files if distributed. #20 already covered protocol research, not this measurement. |
| [W3Champions launcher bridge](https://github.com/w3champions/launcher/tree/master/src/game), [Wisp's earlier comparison](driving-warcraft.md#1-the-menu-socket-recommended) | No root licence established; README explicitly deprecated. Successor source is private. | No missing capability for this task: Wisp already drives host/join/start over its menu page and game socket. The launcher's socket is its own bridge, not the game's socket. | **ignore** further bridge implementation. Reuse Wisp's installed menu page and existing LAN host, whose native result is recorded in #20. |

## Headless MDX rendering

| Source | Licence and maintenance | Current capability Wisp lacks | Verdict and next action |
| --- | --- | --- | --- |
| [war3-model](https://github.com/4eb0da/war3-model), [renderer API](https://github.com/4eb0da/war3-model/tree/master/renderer) | [MIT](https://github.com/4eb0da/war3-model/blob/master/LICENSE), pushed 15 Jun 2026. Wisp pins package 4.0.1. Local inspected source: `~/code/war3-model/worktrees/mdx1800-light`, revision `ddda8d7e643820594a4986769b87e731c449a755`, MIT file present. | MDX geometry, bones, sequences, global sequences, particles, ribbons, texture animation, team colour and BLP1/DDS decoding/rendering. Wisp has scene observations but no match frame output at research baseline. | **reuse** for #40; retain MIT notice. `ModelRenderer.setSequence`, `setFrame`, `setCamera`, `update(delta)` and render entry points already exist. `setFrame` seeks a skeleton; particles/ribbons/global sequences also need fixed-delta updates. Advance from birth to the requested frame instead of assuming a single seek restores effects. |
| [mdx-m3-viewer](https://github.com/flowtsohg/mdx-m3-viewer), [render tester](https://github.com/flowtsohg/mdx-m3-viewer/tree/2ff0bc00c6363f425016e23d88c0fb2929d3b3cc/src/utils) | [MIT](https://github.com/flowtsohg/mdx-m3-viewer/blob/2ff0bc00c6363f425016e23d88c0fb2929d3b3cc/LICENSE); explicitly no longer actively maintained, last push 27 Aug 2025. | Scene/model instances, partial map viewing, MDX sanity checks and a rendered-image comparison utility. Parsers work outside browsers; rendering still requires WebGL. | **learn-from** the existing render fixtures and scene organization for #40 if the installed renderer hits a specific missing feature. Do not write an MDX parser or introduce a second renderer before that failure. MIT notice applies to any actual derivation. |

`war3-model` documents BLP1 only, missing Light nodes and render priority,
partial ribbon properties and unsupported SoundTrack. Those are concrete
selection limits, not reasons to delay the five look checks. Use Wisp sound
cue observations for sound checks; an MDX renderer cannot stand in for the
map's cue schedule. Assets remain private; a library's licence does not grant
rights to Blizzard's art.

## Hosting and networking

| Source | Licence and maintenance | Current capability Wisp lacks | Verdict and next action |
| --- | --- | --- | --- |
| [FLO / W3C-Flo](https://github.com/BogdanW3/W3C-Flo), [official W3C component description](https://w3champions.atlassian.net/wiki/spaces/AV/pages/2654209) | Current fork [declares MIT](https://github.com/BogdanW3/W3C-Flo/blob/6db3a4010fab0b0b29824a61f2c9c956f97fd211/LICENSE), pushed 19 Jul 2025. Historical local `~/code/resources/w3champions/flo-2022` at `98c2a3bf9538abfbea6140bc4b65b8603c1676b6` is MPL-2.0. Old `w3champions/flo` URL returns 404. Do not apply the new root licence to old files. | Reconnect, artificial delay, observers/live streams, map/replay/protocol libraries. Wisp already advertises, hosts and relays LAN matches; reconnect/observer stream controls are absent. | **learn-from** [host clock](https://github.com/BogdanW3/W3C-Flo/blob/6db3a4010fab0b0b29824a61f2c9c956f97fd211/crates/node/src/game/host/clock.rs) pause/resume and [observer send queue](https://github.com/BogdanW3/W3C-Flo/blob/6db3a4010fab0b0b29824a61f2c9c956f97fd211/crates/client/src/observer/send_queue.rs) `set_speed` for #39/#38. These control protocol delivery, not a demonstrated renderer bypass or arbitrary engine-frame stepping. Measure host-controlled turn pacing before adding process traps. Reuse requires checking the chosen file's licence/history, especially historical MPL content. |
| [GoWarcraft3 protocol and lobby packages](https://github.com/nielsAD/gowarcraft3/tree/f13251b6caed199c3347214f4591e7ccaa96c7c7/network/lobby) | MPL-2.0; last push Mar 2023. | Independent packet codec/dump tools and dummy peers can test Wisp's host without another Wine process. Its classic BNCS support ends before patch 1.32. | **reuse** standalone W3GS diagnostics alongside the dummy-client issue. Restrict the experiment to offline Wisp lobby messages; there is no need for BNCS/account login. |
| [GHost++](https://github.com/uakfdotb/ghostpp/blob/master/MANUAL) | API licence is NOASSERTION; repository root has no simple COPYING file. Mixed dependency licences require file-level checking. Last push 2 Apr 2023. | Classic LAN/Battle.net/PVPGN autohost, map transfer and saved-game player layout. Wisp already covers its current LAN host needs. | **ignore** integration for current Reforged checks. The old login/protocol dependencies and no modern-runtime evidence make this more setup, not less. |
| [FLO Lab / FloTV](https://github.com/w3champions/flo-lab) | No licence established; README lists v0.4.2, 1.34 support and earlier speed control, but no current 3.0 compatibility evidence. | Existing observer speed control proves the idea has shipped for older builds. | **learn-from** the capability boundary in #39, not download/install as today's working fast mode. The current source's send queue is the inspectable mechanism. |

## Replays

| Source | Licence and maintenance | Current capability Wisp lacks | Verdict and next action |
| --- | --- | --- | --- |
| [w3gjs](https://github.com/PBug90/w3gjs), [low-level usage](https://github.com/PBug90/w3gjs/blob/40efcfc7bdb8ccb0241823f9aa099b98a62ca0fe/README.md) | [MIT](https://github.com/PBug90/w3gjs/blob/40efcfc7bdb8ccb0241823f9aa099b98a62ca0fe/LICENSE), pushed 22 Sep 2026. The old `@voces/w3gjs` fork is not the maintained upstream. | Parses retail `.w3g` metadata and low-level game data/action blocks. Wisp's repro/viewer currently replay its own recorded inputs; there is no retail replay importer. | **reuse** the low-level parser in a new replay-import issue. Preserve raw action bytes and offsets; convert only actions with established meanings. A parser recovers inputs, not Warcraft's state/poses or exact local polling. MIT notice required. |
| [w3grs](https://github.com/wakamex/w3grs) | [MIT](https://github.com/wakamex/w3grs/blob/dc92490b7668d02793d3fefd00f749e454dc5858/LICENSE), pushed 18 Jun 2026; Rust 1.85+. | Public low-level/timed-action output and parity comparison against w3gjs. Optional extended-actions keeps trigger commands, scenario triggers and opaque dropped actions, including post-2.0.2 command-card sources. | **learn-from** its action coverage and paired fixtures in the replay-import issue. Prefer TypeScript w3gjs for Wisp's first importer; preserve unknown/extended records rather than claiming they were reproduced. Use Rust only if a measured parser limitation requires it. |
| [FLO replay/observer records](https://github.com/BogdanW3/W3C-Flo/tree/6db3a4010fab0b0b29824a61f2c9c956f97fd211/crates) | Current MIT declaration versus historical MPL-2.0 as above; 2025 fork. | Server records connect incoming action turns, checksums and observer playback without reading render state. | **learn-from** record boundaries for the same replay-import issue and #39. Wisp already has per-turn host logs; prefer those for current parity evidence instead of adding a FLO deployment. |

## Memory and engine access

| Source | Licence and maintenance | Current capability Wisp lacks | Verdict and next action |
| --- | --- | --- | --- |
| [DracoL1ch/Leandrotp/Karaulov Memory Hack](https://www.hiveworkshop.com/threads/memory-hack.289508/), [API discussion](https://www.hiveworkshop.com/threads/memory-hack-api-description.289823/), [read-only follow-up](https://www.hiveworkshop.com/threads/accessing-memory-from-the-script-its-time-of-the-revolution.279262/) | No explicit code licence established from these threads. Historical API begins in 2016; forum replies are not current-build support. Follow-up says the write exploit was fixed after 1.27b. | Historical low-level engine calls and getters/setters beyond JASS. Wisp already locates and reads its present Lua VM/handles; controlled input writes and stepping are missing. | **learn-from** facts about object identity and version boundaries for #38. A JASS handle is not a raw engine address. Do not import old addresses or the exploit as a Reforged write mechanism; use Wisp's current offline discovery and existing file channel first. |
| [Karaulov DLL](https://github.com/UnrealKaraulov/WarcraftIII_DLL_126-xxx) | [Unlicense](https://github.com/UnrealKaraulov/WarcraftIII_DLL_126-xxx/blob/no_dream_ui/LICENSE); pushed 23 Apr 2026. Default branch `no_dream_ui`; bundled dependencies have separate terms. README targets Warcraft 1.26a/1.27a. | Native hooks, direct engine APIs and old custom-frame/overlay functions. Current pushes do not make the old supported runtime current. | **ignore** binary integration with Reforged. It does not close a modern stepping box; historical memory facts are already covered above. |
| [YDWE](https://github.com/actboy168/YDWE), [embedded engine runtime](https://github.com/actboy168/YDWE/blob/a69c315ebf2886ec54d66200707ab6e38bd3484d/Development/Plugin/Warcraft3/yd_lua_engine/lua_engine/libs_runtime.cpp), [author's engine guide](https://github.com/actboy168/jass2lua/blob/master/lua-engine.md) | [GPL-3.0](https://github.com/actboy168/YDWE/blob/a69c315ebf2886ec54d66200707ab6e38bd3484d/LICENSE); pushed 16 Jun 2024. Windows/classic injected engine, not stock Reforged Lua. | Engine embeds Lua, maps RNG to JASS natives, adds runtime error hooks, coroutine sleep and a debugger socket. These are useful descriptions of engine-internal control, not a complete headless runtime. | **learn-from** callback/coroutine and synchronized RNG facts for #38 and #41's unit-state/native-coverage issue. Do not derive GPL code into MIT Wisp without an explicit compatibility choice. The debugger socket is a fallback only after existing in-map commands fail. |
| [KKAPI official developer docs](https://create.kkdzpt.com/kkapidoc/), [embedded JAPI documentation](https://github.com/PhoenixZeng/embedded-japi-vue-press), [old docs](https://github.com/w4454962/embedded-japi-plugin) | KKAPI is platform documentation, not a reuse licence. Neither inspected JAPI docs repo establishes a root code licence. New docs pushed 12 Jan 2026; old README declares itself superseded. Old interface guide targets 1.24e/1.26/1.27. | Platform/injected extension APIs include local order/input hooks, effect animation, model/frame inspection and extra unit state. Official KKAPI says it is DzAPI compatible; that is not stock Reforged compatibility. | **learn-from** documented local-versus-synchronized input and UI distinctions for #38/#40. Record API facts only. Do not install KKWE or assume its extension exists on Wisp's offline retail clients. |
| [Warcraft III Community Edition](https://www.hiveworkshop.com/threads/warcraft-iii-community-edition.346600/), [public repository](https://github.com/Warcraft-III-Community-Edition/W3CE) | No licence established; repository contains docs, issues and an old common.j, not the engine source. Revised 31 Oct 2026: active. 0.3.2 released (files dated 16 Oct 2026, Hive resource updated 17 Oct), 0.4 on its test realm since about 22 Oct (W3CE Discord). The current natives ship as common.j inside `w3ce.mpq`; the GitHub copy (pushed 22 Dec 2024) is stale. | A 1.29.2.9231 launcher with its own server, a Vulkan renderer, Lua (including a deterministic engine), WASM, 518 natives beyond stock 1.29.2 (225 `Ce*`) and 3.0-format maps. It still requires Warcraft and replaces the launcher; 0.4 is flagged by Windows Defender. Saves are unsupported for Lua, WASM and multiplayer games. | **ignore** as a verification engine for today's Reforged, as before. **learn-from** (31 Oct 2026) its natives and issues, as a record of what map makers ask for. They are classified and ranked against Wisp's game API in [game-api-plan.md, "What extension engines were asked for"](game-api-plan.md#what-extension-engines-were-asked-for), with the lessons drawn for Wisp. Facts only; no code or text taken. |

## Searches and evidence

Searches ran against the named communities, not just seed links:

- GitHub: `w3champions flo Rust license`, `war3-model license`,
  `War3Net license headless Jass`, `Warcraft III headless Jass emulator`,
  `w3gjs github`, `w3grs github`, `Warsmash license`, `wc3lib license`,
  `Warcraft III programmatic client gowarcraft3`, `w3gs flo Rust Warcraft`,
  `ghost warcraft hostbot licence`, `karaulov war3 DracoL1ch`.
- Hive Workshop: `WC3 headless`, `WC3 Jass interpreter`,
  `DracoL1ch karaulov memory Warcraft`, `Memory hack DracoL1ch`;
  opened live-coding, interpreter, memory API and W3CE primary threads.
- W3Champions: `FLO w3champions Rust github`, `W3Champions flo license`,
  `FLO Warcraft github private source`; inspected official component docs,
  FLO Lab, launcher and Wisp #20, which identified the accessible fork.
- Chinese YDWE: `YDWE license`, `YDWE MIT`; read the author's Chinese Lua
  engine guide, current GPL licence and runtime/JAPI source paths.
- Chinese KKWE/JAPI: `KKWE japi 文档`, `KKWE japi github 魔兽 文档`,
  `KKWE 官网 JAPI`, `DzAPI KK JAPI github`; opened the official platform
  docs and followed old JAPI docs to their named replacement.

GitHub metadata and default-branch commit IDs were read on the research date,
with actual licence files checked for the selected sources. A recent push is
reported as a push, not proof of active support; explicit deprecation wins.
No code was copied, adapted or vendored during this research.

## Delivery to issues

GitHub writes recovered during research. The shortcuts were published and read
back: [native driver #38](https://github.com/tompassarelli/wisp/issues/38#issuecomment-6041036681),
[fast-forward #39](https://github.com/tompassarelli/wisp/issues/39#issuecomment-6041037623),
[headless frames #40](https://github.com/tompassarelli/wisp/issues/40#issuecomment-6041038476)
and [additional simulation evidence #41](https://github.com/tompassarelli/wisp/issues/41#issuecomment-6041039368).
The latter strengthens [native coverage #43](https://github.com/tompassarelli/wisp/issues/43),
[unit states #44](https://github.com/tompassarelli/wisp/issues/44) and
[object authoring #45](https://github.com/tompassarelli/wisp/issues/45).
The new measured work is [dummy lobby clients #46](https://github.com/tompassarelli/wisp/issues/46)
and [retail replay import #47](https://github.com/tompassarelli/wisp/issues/47).
Each useful verdict above names one of these destinations. The owning research
issue is [#42](https://github.com/tompassarelli/wisp/issues/42).

## The relay agent's game host (wisp#37)

Checked 24 October 2026, before the relay agent ported Wisp's LAN host to
Rust (wisp:docs/relay.md, "Lobby and game on the agent").

- **Source and revision:** W3C-Flo, github.com/BogdanW3/W3C-Flo at
  `6db3a4010fab0b0b29824a61f2c9c956f97fd211`; read in `crates/client/src/lan/game`
  (`lobby.rs`, `proxy.rs`, `slot.rs`), `crates/lan` and `crates/w3gs`.
- **Licence and covered scope:** the root `LICENSE` at that revision is MIT
  (Copyright (c) 2023 W3Champions). No file under `crates/client`, `crates/lan`
  or `crates/w3gs` carries its own licence header at that revision; the one
  MPL-2.0 file header in the tree is `crates/blp/src/lib.rs`, which nothing
  here reads. Earlier FLO revisions were MPL-2.0, which is why
  host/lan/host.ts, w3gs.ts and actions.ts name MPL-2.0 in their first lines;
  the MIT declaration is not applied to those older files.
- **Reused scope:** protocol facts only: which W3GS packets the host sends a
  joining player and in what order (slot info for the joiner, slot table,
  each other player's info, skins and profile, then the map check), their
  field layouts, the countdown wait, and action and checksum framing. These
  facts reached Wisp through host.ts, w3gs.ts and actions.ts, Wisp's own MIT
  TypeScript. The Rust crate `relay-agent` is ported from those Wisp files
  and replays a lobby transcript recorded from host.ts; no FLO code was
  copied, translated or adapted, and FLO was not a build or test dependency.
- **wc3-slop-lan** (github.com/Promises/wc3-slop-lan) has no licence and is
  read for facts only, as docs/driving-warcraft.md records; the agent reuses
  nothing from it beyond the map-check fold host/lan/map.ts already names.
- **Obligations:** none for facts. Copying FLO expression later would carry the
  MIT notice for files at this revision and a separate check of any file's
  history before 2023.

## Game API: UI frames

Checked 31 October 2026 for the UI frames family of the game API
(wisp:docs/game-api-plan.md), on Tom's pointer the same day.

- **Source and revision:** wc3-w3ts-frame-components,
  github.com/bertman12/wc3-w3ts-frame-components at
  `327f12cb95a094e1c203bd06209a3f966773a9dc` (17 October 2026). Read:
  `README.md`, `src/components/Core/MonoFrame.ts` and `CompositeFrame.ts`,
  `src/models/components.ts`, `src/theme/theme.ts` and `src/grid/grid.ts`.
- **Licence:** MIT (Copyright (c) 2026 JediMindTrix), root `LICENSE`.
- **What it is:** components built on w3ts's `Frame` class. A `MonoFrame` wraps
  one Warcraft frame type, and a `CompositeFrame` or `Grid` builds bigger
  widgets (button, tooltip, timer, list) from the small ones. Each component
  holds its configuration and its frame objects at run time.
- **Taken (ideas, no code):**
  - Frame types and known templates are typed, so a misspelt type fails to
    compile while a template from the map's own FDF is still accepted. The
    game API's `kind` and `template` parameters get the same typing, which
    costs nothing in Lua.
  - A frame has one handler per event; the library destroys the old trigger
    when the handler is set again. The game API keeps registration one to
    one on Warcraft, so the lowering stays free, and the native backend
    refuses a second handler for the same frame and event, so headless Bun
    tests catch a double registration.
- **Not taken:** the component classes, composites, grid and theme. They are
  wrapper objects with methods, which put a table lookup or an allocation
  on each Lua call; the plan's Lua cost rule allows neither. Widgets are a
  layer above the API that a game builds for itself (Smashcraft already has
  its own layout code in `ts/src/game/ui/`). The theme object is marked
  deprecated in its own source.
- **Obligations:** none, since no expression is copied. Copying code later
  would carry the MIT notice for this revision.
