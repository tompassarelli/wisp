# Game API (plan)

Status: planned, 31 October 2026, revised after an adversarial review and
again when boxes G3 to G8 were written (see "Review"). This page plans only; each box at the end is its own issue.

Decision (proxy at Tom's question, 31 October 2026): gameplay and presentation
code calls Wisp's own game API, shaped for this game, not Warcraft III's
natives. The API has two backends, chosen at build time:

- **Warcraft.** A TypeScriptToLua plugin lowers each API call to the native
  call it stands for while the map compiles. The compiled map runs no Wisp
  code for the call.
- **Native.** On Bun, the same imports resolve to Wisp's own implementation in
  TypeScript, which feeds the Rust window (docs/native-window-plan.md).

Smashcraft moves onto the API one family at a time, with both backends green
after each family. No family moves in the same change as another.

## Why

Today the contract is Warcraft's native API. Wisp's standalone runs a map by
emulating a Warcraft client one native at a time ([headless.md](headless.md):
"every Warcraft native the map can call emulated per client", down to
Warcraft's binary32 timer rounding). That has three costs:

- It ties the native engine to Blizzard's interface and semantics, so every
  engine feature is an emulation of a quirk.
- It blocks a renderer that does better than Warcraft, because its inputs are
  whatever Warcraft's natives can express.
- It puts Blizzard's API shape at the centre of the clean-room exposure that the
  outside review flagged ([clean-room.md](clean-room.md)).

With the API as the contract, the Warcraft mapping becomes one backend's table
of facts about public declarations. Wisp's native engine then implements Wisp
semantics that it documents itself.

## What exists

**Smashcraft's native calls.** Counted at smashcraft 6782827367 with the
script under "Survey". It matches every call expression `Name(` whose name
`src/natives/warcraft.d.ts` declares, in `smashcraft/ts/src/**/*.ts`:

```text
$ bun family.ts natives.txt ~/code/smashcraft/main/ts/src
UI frames               natives 48  sites 714  files 48
effects                 natives 34  sites 623  files 44
strings and math        natives 8   sites 242  files 35
players                 natives 10  sites 169  files 46
camera and world look   natives 35  sites 80   files 10
sound                   natives 19  sites 78   files 7
timers and frame loop   natives 9   sites 61   files 17
units and positions     natives 34  sites 53   files 9
events                  natives 3   sites 51   files 13
input                   natives 16  sites 48   files 19
sync messages           natives 4   sites 39   files 13
files                   natives 4   sites 33   files 7
handle ids              natives 1   sites 15   files 7
total                   natives 225 sites 2206 files 130
```

The item's brief quoted 245 natives at 2,569 sites in 176 files, a wider scope
than this. This count covers call expressions in `ts/src` only. Tests in
`ts/test` and host scripts in `ts/scripts` add 20 sites in 6 files (2,226 sites
over all of `ts/`). Host scripts never run in the map, so they do not migrate.

**Where the calls are.** Per directory:

- `game/ui`: 729 sites in 30 files;
- `host/loop`: 674 in 48;
- `game/render`: 668 in 39;
- `host/entries`: 50 in 4;
- `platform/`: 85 in 9.

`game/sim`, `match`, `replay`, `netcode`, `input`, `fighters`,
`presentation`, `lobby`, `roster`, `session`, `classic` and `menu` call no
native at all (0 sites).

**Where Smashcraft reads Warcraft state today.** The simulation reads nothing
from Warcraft. Every read is in the shell (`host/loop`, `platform`) or in
presentation:

- **Input rows (synchronized).** These are the only path into the sim. A
  sync event's `BlzGetTriggerSyncData` and `GetTriggerPlayer` feed the
  rollback journal in `host/loop/rollback.ts:438`, `journal.ts` and
  `journalPause.ts:102,158,192`. The netcode's delay probe reads them in
  `netDelay.ts:370`, stage-ready in `stageLoad.ts:54`, player files in
  `playerFiles.ts:48`, and menu choices in `game/ui/frames.ts:193`.
- **Keys and pads (local).** `BlzGetTriggerPlayerKey`, `BlzIsKeyPressed` and
  `BlzIsLocalClientActive` are read in `host/loop/keys.ts`, `inputs.ts:73`
  and `analogPad.ts:63`. Each read becomes an input row that is sent with
  `BlzSendSyncData` (`journal.ts:127`). It reaches the sim only through that
  sync.
- **The frame tick (synchronized).** `TimerStart(tick, FRAME_SECONDS, true,
  TICK)` in `host/loop/shell.ts:351` steps the match once per tick. The sim
  counts ticks and never reads elapsed time.
- **Clocks (local).** `TimerGetElapsed` gives the draw interpolation alpha in
  `betweenFrames.ts:66`. The other reads are diagnostics: `trace.ts`,
  `sessionRates.ts`, `responseProbe.ts`, `frameCost.ts`, `renderClock.ts`,
  `callbackClock.ts`, `analogPad.ts` and `rollback.ts:74`.
- **Who plays (synchronized at start).** `GetPlayerController` and
  `GetPlayerSlotState` are read in `host/loop/inputs.ts:22,31`, `ui.ts:228`
  and `playerFiles.ts:91`. They feed the lobby's human mask.
- **World origin (constant).** `shell.ts:357` reads
  `GetRectCenter(GetPlayableMapRect())`.
- **Screen and pointer (local).** `BlzGetLocalClientWidth`/`Height` and
  `BlzGetMouseScreenPosX`/`Y` are read in `game/ui/frames.ts`, `stageUi.ts`,
  `pauseScreen.ts` and `host/loop/view.ts`.
- **Presentation read-backs (local).** The camera is read with
  `GetCameraField` in `game/render/cameraLift.ts`, an effect's place with
  `BlzGetLocalSpecialEffectX`/`Y`/`Z` in `host/loop/fighterCloak.ts:59`, and
  whether a unit is hidden with `IsUnitHidden` in `fighterCloak.ts:115`.
- **Unit object data (diagnostic).** `host/loop/objectData.ts` reads
  `GetUnitMoveSpeed`, `BlzGetUnitAttackCooldown` and `GetUnitTypeId`.

Unit positions are written from the sim (`SetUnitX`/`Y` in
`host/loop/fighterBody.ts`) and never read back.

**Wisp's emulation already has the right shape inside.** In
`src/headless/natives/` the emulation keeps one store per family: `Effects`
(234 lines), frames (142), sound (168), units (232), camera and cinematic
filter (75), triggers and timers (306), and math (30). Each store holds what a
player would see: an effect's pose, a frame's tree and text. Native names
exist only at the store's entry points. The native window draws from those
stores through `RenderScene`, `host/window/drawScene.ts` and
`host/window/nativeUi.ts`. Effects and models draw as of wisp#108 and UI
frames as of a7ead11f (wisp#109).

## The contract

- **One module per family:** `wisp/game/effects`, `wisp/game/frames`,
  `wisp/game/sound`, `wisp/game/input`, `wisp/game/clock`,
  `wisp/game/players`, `wisp/game/bodies`, `wisp/game/text`,
  `wisp/game/view`, `wisp/game/sync`, `wisp/game/files`, plus the shared
  `wisp/game/events`. The family's declarations are the contract: functions
  and handle types that Wisp names (`Effect`, `Frame`, `Sound`, `Beam`,
  `Body`, `Player`, `Events`). Those types become opaque at step 6 (see
  below).
- **Free functions over handles,** for example
  `setEffectScale(effect, scale)`, not methods. A method call or a wrapper
  object costs a table lookup or an allocation per call in Lua. A free
  function lowers to exactly one native call.
- **Constants are Wisp's own** (`EffectAnimation.attack`,
  `FrameEvent.click`, `Key.escape`). The Warcraft backend lowers each one to
  the global the native expects (`ANIM_TYPE_ATTACK`), which is the same global
  read the code makes today, not a `Convert*` call.
- **Each call says whether it is synchronized or local.** A local call (a
  read-back, the screen size, a local-player effect) carries `local` in its
  family's declaration. Synchronized code that calls it is the same desync
  bug it is today, and the headless call log still catches it.
- **Events are their own small module,** `wisp/game/events`:
  `createEvents()`, `onEvents(events, handler)` and `destroyEvents(events)`,
  which lower to `CreateTrigger`, `TriggerAddAction` and `DestroyTrigger`.
  Each family registers its own sources on an events value: frames with
  `addFrameEvent(events, frame, event)`, keys with `addKeyEvent`, sync with
  `addMessageEvent`, chat with `addChatEvent`, and leaving with
  `addLeaveEvent`. That is the shape today's code has: one trigger, many
  sources, one handler. It arrives with G2, the first family that registers
  anything.
- **Handle types alias Warcraft's until step 6.** Families take each other's
  handles: effects take a `Player` (`setEffectTeamColor(effect, player)`),
  and frames are registered on `Events`. While some families are still raw
  natives, each Wisp handle type is declared as an alias of its Warcraft
  type (`type Player = player`, `type Events = trigger`). A value from a raw
  `Player(n)` then passes to a migrated call, and a migrated value passes to
  a raw native, with no conversion call. On Bun the emulation and the native
  store are one store, so they share one handle space. Step 6 makes the
  types opaque once no raw native is left to accept them.
- **Module `game` in structure.toml.** Its paths are `src/game/**` and its
  responsibility is "Wisp's game API: per-family declarations, the Warcraft
  backend's lowering table and the native backend". It may use num,
  runtime and natives. Three modules gain `game` in `may_use`:
  - plugins, for the lowering table;
  - headless, whose Warcraft-named entry points call the stores;
  - host, for `host/window` and `host/headless`.

  The stores' helpers move with them, so `game` never imports headless:
  `src/headless/animation.ts`, `frameRate.ts`, the store types in
  `clientTypes.ts`, `units.ts`'s `copyBlend`, `frames.ts` and
  `jassFormat.ts`. Box G1 makes this change and the matching
  [architecture.md](architecture.md) row.

Layout:

- `src/game/<family>.d.ts`: the contract.
- `src/game/warcraft/<family>.ts`: the lowering table (data: Wisp call to
  native template).
- `src/game/native/<family>.ts`: the native backend.

`package.json` `exports` map `wisp/game/<family>` to the native module under
the `bun` condition and to the declaration under `types`. The TSTL plugin
handles the import under Lua.

## Warcraft backend: lowering and the Lua cost rule

**Evidence that a plugin is needed** (probe in `/tmp/gapi/probe`, TSTL
1.37.1, 31 October 2026):

- A declaration with `@customName BlzSetSpecialEffectScale`, imported from a
  module, compiles to `local ____effects = require(...)`, then a field read,
  then a call. Each call pays a require at load and an upvalue, and the file
  fails to resolve.
- The same declaration in an ambient namespace compiles to
  `wisp.BlzSetSpecialEffectScale(e, 2)`, which is a global table read per
  call.

Only a bare global `declare function` lowers for free, and a global is not a
module contract. So the Warcraft backend is a TSTL plugin,
`plugins/game-api.ts`, in the style of `plugins/loop-bindings.ts`:

- For an import from `wisp/game/*`, it drops the import.
- It rewrites each call of an imported function as the lowering table's
  template, with arguments substituted in place. Most templates are one
  native call, with the arguments in the same order.
- A template may name several natives only where every Smashcraft site
  already makes those calls together, as in `eventKey`, which is
  `GetHandleId(BlzGetTriggerPlayerKey())` at all 6 sites. A template is one
  expression, because a call has no statements to expand into, and each
  argument appears at most once, because a repeated argument would run twice
  or need a local. Where call sites combine natives in
  different ways, the API keeps the parts. One case is frame events:
  `game/ui/frames.ts:120-158` registers many frames on one shared trigger and
  dispatches on `GetHandleId(BlzGetTriggerFrame())`, so no per-frame
  `onFrameEvent` template could reproduce it.
- Using an API function as a value (passing it, storing it) is a compile
  error that names the call, because under Lua no function exists to pass.
  Code that has to treat natives as values stays on raw natives as Warcraft
  backend code. Three files do: the soak handle ledger
  (`platform/soakHandles.ts`), which reassigns `natives.AddSpecialEffect`
  and its kin, and `host/loop/sessionRates.ts` and `host/loop/handleLedger.ts`,
  which wrap natives by name in the globals table.
- The lowering table names natives only as they appear in
  `src/natives/warcraft.d.ts`, the generated declarations, and composes them
  only as Smashcraft's own code does. It holds interface facts, like the
  declarations. G1 adds a line saying so to [clean-room.md](clean-room.md).

**The Lua cost rule.** On the Warcraft backend a migrated call costs exactly
what the native call it replaced cost: no added Lua instructions, native
calls, allocations or map script bytes. The budget is zero, not the 5% CI
threshold, which stays the backstop for every other change. A call whose
lowering cannot meet zero is a design error in the API for that call: change
the API shape, never the budget. A safety rule that would need state on
Warcraft goes to the native backend, where it is checked in every headless
Bun test, instead of into the lowering.

**The measurement that proves it,** run for the first family (G1) and again
for every later family, in `smashcraft/ts`:

1. The pin update that brings the family's Wisp side lands alone first,
   because Wisp's own runtime is compiled into the bundle. On that commit:
   `bun wisp perf playable-human-four --out build/before.perf` and
   `bun wisp map build`, keeping the playable bundle it compiles
   (`build/playable.lua`) as `build/before.lua`.
2. On the codemod commit: the same, writing `build/after.perf` and
   `build/after.lua`.
3. Normalize both bundles and diff them; the result prints nothing:
   `sed -E 's/(SOURCE_STAMP = )"[0-9a-f]{12}"/\1"STAMP"/; s/("src\/[^"]*\.ts):[0-9]+"/\1:N"/g'`.
   Two fields legitimately change. The source stamp is a hash of every
   `ts/src` file (smashcraft:ts/plugins/source-version.ts). Each `throw`'s
   `file:line` (wisp:plugins/warcraft-numbers.ts) moves when the codemod adds
   import lines. The codemod is one to one, so apart from those two fields
   lowering must reproduce the old script byte for byte. A non-empty diff
   is the falsifying evidence: it names the first call that lowers
   differently.
4. `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   passes. Instructions (mean and top 1% mean), native calls, allocation and
   predicted native time do not rise at all. Those counts are deterministic
   (frame-cost.md), so zero is a fair gate.

Steps 3 and 4 are the evidence the box reports. Step 3 is the stronger check.
Step 4 shows the same result in the units that Smashcraft's frame budget is
written in: the map's own work at p99 ≤ 10 ms (smashcraft AGENTS.md).

## Native backend

- **One store per family, in TypeScript on Bun:** `src/game/native/<family>.ts`.
  Each store is the store that `src/headless/natives/<family>.ts` already
  keeps, moved and renamed. The Warcraft-named entry points that remain in
  `src/headless` become thin calls into it.
- **The store belongs to the world, not the module.** Headless runs several
  clients in one process, and today the current client lives in a closure in
  `host/headless/headless.ts:103-170`. `src/game` cannot import host.
  - G1 adds `src/game/native/world.ts`, which holds the bound world and its
    stores, with `bindWorld(world)` for its host.
  - `host/headless` binds each client's world before it runs that client.
  - The native window's session binds its one world.
  - The stores are plain TypeScript under Wisp's number rules, because
    headless Lua also compiles Wisp's runtime with TSTL (headless.md). The
    same store code therefore runs in Bun and in Lua32.

  G1 checks this first, before the codemod: two headless clients create
  effects in the same frame, and each client's `effectPoses()` holds only
  its own.
- **Equivalence of the backends comes from two existing gates:**
  - Bun runs the map's TypeScript, whose imports resolve to the native backend.
  - 32-bit Lua runs the compiled bundle, whose lowered native calls reach the
    same store through the emulation.
  - Headless Bun/Lua parity (headless.md, "Synchronized and local-only
    calls") already requires equal checksums of the two runs.
  - So when headless installs its log hook, each native backend call logs
    the native name and arguments of its lowering row. The Lua run logs the
    same native call. `callHash.ts` and the games' `localNatives` lists keep
    their native names and need no change. Outside headless no hook is
    installed, and the native backend logs nothing.
- **Drawing and sound stay as the native window plan assigns them.**
  `drawScene.ts` and `nativeUi.ts` read the stores, and Rust draws. G1 and G2
  change where the stores live, not what is drawn.

**Where Warcraft quirks go.** A quirk the native backend copies today only so
it can be Warcraft is dropped from the native backend once its family moves.
It stays in `src/headless` for as long as the Warcraft backend's tests need
it. Examples:

- binary32 timer deadlines and the 1/1024 s minimum timeout, where the native
  clock counts integer frames;
- Preload's 259-byte line cut;
- a frame text limit that reads -256.

A Warcraft behaviour that Wisp keeps on purpose is written down as Wisp's own
rule, with its reason:

- `R2S` binary32 formatting with ties away from zero. Replays and records are
  text, and a replay recorded on one backend must read alike on the other.
- The 255-character sync message, so a wire format fits both transports.

## Determinism and lockstep

The simulation is Smashcraft's own code and calls no native today. The API
keeps lockstep determinism by changing none of its inputs:

- **Input rows.** On Warcraft they arrive through the sync family. On native
  they arrive through Wisp's transport (`src/netcode`, `host/net`), in the
  same order per peer, including the sender. The sync family's contract is
  that order and the 255-character limit.
- **Ticks.** A periodic clock timer at `FRAME_SECONDS` steps the match once
  per fixed 1/60 s frame on both backends. On Warcraft it is today's
  `CreateTimer` and `TimerStart`. On native the window's frame clock fires
  it (native-window-plan.md, "Seam (revised)"). The sim still never
  reads elapsed time. Elapsed time is a local read in the clock family
  (`localElapsed`) and is used only for the draw alpha and for diagnostics.
- **Who plays.** The players family's `playerControl(player)` and
  `playerSlotState(player)` are the lobby's facts at match start: on Warcraft,
  the controller and slot-state natives; on native, the session's slots.
- **Read-backs** (screen, pointer, camera, effect place) are `local` reads,
  never inputs to the sim.
- **One match runs one backend.** A Warcraft client and a native client in
  the same match is out of scope. Replays move between backends, which is why
  the text family keeps `R2S` formatting.

## Families

For each family: its Wisp calls, the Warcraft mapping (every call lowers to
the native shown, or to the sequence shown), the owner of the native backend,
and the Smashcraft call sites that move (counted above).

- **Effects** (`wisp/game/effects`). 623 sites in 44 files, 34 natives.
  - Calls: `createEffect(model, x, y)`, `destroyEffect`, `setEffectPosition`,
    `setEffectZ`, `setEffectScale`, `setEffectMatrixScale`,
    `resetEffectMatrix`, `setEffectOrientation`, `setEffectYaw`/`Pitch`/`Roll`,
    `setEffectAlpha`, `setEffectColor`, `setEffectTeamColor`,
    `playEffectAnimation`, `setEffectAnimation`, `setEffectTime`,
    `setEffectTimeScale`, `setEffectBlendTime`, `clearEffectSubAnimations`;
    local reads `effectPosition`, `effectScale`; beams `createBeam`,
    `moveBeam`, `setBeamColor`, `destroyBeam`; floating text
    `createFloatingText`, `setFloatingText*`.
  - Warcraft: `AddSpecialEffect`, `DestroyEffect`,
    `BlzSetSpecialEffect*`, `BlzResetSpecialEffectMatrix`,
    `BlzPlaySpecialEffect`, `BlzSpecialEffectClearSubAnimations`,
    `BlzGetLocalSpecialEffectX/Y/Z`, `BlzGetSpecialEffectScale`,
    `AddLightningEx`, `MoveLightningEx`, `SetLightningColor`,
    `DestroyLightning`, `CreateTextTag`, `SetTextTag*`. Each is one to one.
  - Native owner: `src/game/native/effects.ts` (from
    `src/headless/natives/effects.ts`), drawn by `window/wisp-window`'s
    model renderer (wisp#108). Emitters, lightning and text tags are drawn in
    W4 (native-window-plan.md).
- **UI frames** (`wisp/game/frames`). 714 sites in 48 files, 48 natives.
  - Calls: `createFrame(kind, name, parent, template, context)`,
    `createFrameFromTemplate`, `destroyFrame`, `frameByName`, `rootFrame`,
    `loadFrameTemplates`, `hideWarcraftUi`; setters for visible, enabled,
    text, text alignment, font, texture, size, absolute point, point, clear
    points, level, alpha, scale, text limit, focus and vertex colour; reads
    for visible, enabled, text, text limit, name, child count and child;
    `addFrameEvent(events, frame, event)`, `eventFrame`,
    `eventFrameKind`, `eventFrameText`, `frameId(frame)`; local
    `screenSize`; `showMessage`, `debugMessage`, `clearMessages`;
    `packColor`; the quest log.
  - `kind` is a string-literal union of the frame kinds (`"BACKDROP"`,
    `"TEXT"`, `"GLUETEXTBUTTON"`, ...), so a misspelt kind fails to compile
    and costs nothing in Lua. The native backend refuses to register the
    same frame and event twice, which headless Bun tests catch. Both ideas
    come from frame components (prior-art.md, "Game API: UI frames").
  - Warcraft: `BlzCreateFrameByType`, `BlzCreateFrame`, `BlzDestroyFrame`,
    `BlzGetFrameByName`, `BlzGetOriginFrame`, `BlzLoadTOCFile`,
    `BlzHideOriginFrames`, `BlzFrameSet*`/`BlzFrameGet*`/`BlzFrameIsVisible`,
    `BlzTriggerRegisterFrameEvent`, `BlzGetTriggerFrame`,
    `BlzGetTriggerFrameEvent`, `BlzGetTriggerFrameText`, `GetHandleId`
    (for `frameId`), `BlzGetLocalClientWidth/Height`,
    `DisplayTextToPlayer`, `BJDebugMsg`, `DisplayTimedTextToPlayer`,
    `ClearTextMessages`, `BlzConvertColor`, `CreateQuest`/`QuestSet*`.
    That is all 48 natives the survey counts for this family.
  - Native owner: `src/game/native/frames.ts` (from
    `src/headless/natives/frames.ts`), drawn by `window/wisp-window/src/ui/`
    (a7ead11f). Calls that exist only to manage Warcraft's own UI
    (`hideWarcraftUi`, the quest log) are no-ops on the native backend,
    declared in the contract as such.
- **Sound** (`wisp/game/sound`). 78 sites in 7 files, 19 natives.
  - Calls: `createSound`, `soundFromLabel`, `playSound`, `stopSound`,
    `setSoundVolume`, `setSoundPitch`, `setSoundPosition`,
    `setSoundDistances`, `setSoundCutoff`, `setSoundDuration`,
    `releaseWhenDone`, `soundFileDuration`; music `playMusic`, `stopMusic`,
    `clearMusic`, `playTheme`, `endTheme`; `setVolumeGroup`,
    `resetVolumeGroups`.
  - Warcraft: `CreateSound`, `CreateSoundFromLabel`, `StartSound`,
    `StopSound`, `SetSound*`, `KillSoundWhenDone`, `GetSoundFileDuration`,
    `PlayMusic`, `StopMusic`, `ClearMapMusic`, `PlayThematicMusic`,
    `EndThematicMusic`, `VolumeGroupSetVolume`, `VolumeGroupReset`.
  - Native owner: `src/game/native/sound.ts` (from
    `src/headless/natives/sound.ts`), played by the cpal mixer in W6
    (native-window-plan.md, "Sound").
- **Input** (`wisp/game/input`). 48 sites in 19 files, 16 natives.
  - Calls: `osKey(code)`, `addKeyEvent(events, player, key, modifiers, down)`,
    `eventKey`, local `keyDown`, local `windowFocused`, local `pointerX`,
    `pointerY`, `eventPointerX`, `eventPointerY`, `mouseDown`, `setPointer`,
    `showCursor`, `addChatEvent(events, player, text, exact)`, `chatText`,
    `addPointerMoveEvent(events, player)`, `enableSelections`,
    `enableUserControl`.
  - Warcraft: `ConvertOsKeyType`, which stays a call of its own because
    `platform/osKeys.ts` caches its result; `BlzTriggerRegisterPlayerKeyEvent`,
    `TriggerRegisterPlayerEvent(EVENT_PLAYER_MOUSE_MOVE)`,
    `GetHandleId(BlzGetTriggerPlayerKey())` (every key-reading site makes
    that pair), `BlzIsKeyPressed`, `BlzIsLocalClientActive`,
    `BlzGetMouseScreenPosX/Y`, `BlzGetTriggerPlayerMouseX/Y`,
    `BlzIsMouseButtonPressed`, `BlzSetMousePos`, `BlzEnableCursor`,
    `TriggerRegisterPlayerChatEvent`, `GetEventPlayerChatString`,
    `BlzEnableSelections`, `EnableUserControl`.
  - Native owner: `window/wisp-window`'s SDL3 keyboard and pad sampling at
    the render thread's sample point (607fc2fd), delivered by
    `host/window/frameLoop.ts`. The native window's mouse (cursor,
    held buttons, left click on a frame) reaches the map the same way and is
    not part of G1 or G2: it adds no `wisp/game` surface, because
    `BlzGetMouseScreenPosX/Y`, `BlzIsMouseButtonPressed` and
    `FRAMEEVENT_CONTROL_CLICK` already lower through the Input and frames
    families above; it is a host feed (`src/headless/pointer.ts`,
    native-window-plan.md "Mouse") and G2 does not wait for it.
- **Events** (`wisp/game/events`). 51 sites in 13 files, 3 natives:
  `createEvents`, `onEvents` and `destroyEvents`, lowering to
  `CreateTrigger`, `TriggerAddAction` and `DestroyTrigger`. Native owner:
  `src/game/native/events.ts` (from `src/headless/natives/triggersTimers.ts`).
  Lands with G2.
- **Timers and frame loop** (`wisp/game/clock`). 61 sites in 17 files, 9
  natives.
  - Calls: `createTimer`, `startTimer(timer, seconds, periodic, handler)`,
    `pauseTimer`, `destroyTimer`, local `localElapsed`, `setNormalSpeed`,
    `lockSpeed`, local `gameSpeed`, `restartMatch`, and the constant `FRAME_SECONDS`. There is no
    `onFrame` composite: `host/loop/shell.ts:350-352` keeps the tick timer
    it creates and hands it to `startFrameClock`, so only the parts lower
    one to one.
  - Warcraft: `CreateTimer`, `TimerStart`, `PauseTimer`, `DestroyTimer`,
    `TimerGetElapsed`, `SetGameSpeed(MAP_SPEED_NORMAL)`,
    `SetMapFlag(MAP_LOCK_SPEED, true)`, `GetGameSpeed`, `RestartGame`.
  - Native owner: the window's frame clock (native-window-plan.md, "Seam
    (revised)", W1b/W1c), stepping `host/window/simWorker.ts`. The native
    clock counts integer frames. `src/headless/natives/timerDeadline.ts`'s
    binary32 rounding stays in headless only.
- **Players** (`wisp/game/players`). 169 sites in 46 files, 10 natives.
  - Calls: `player(slot)`, `playerSlot`, `localPlayer`, `eventPlayer`,
    `playerControl(player)`, `playerSlotState(player)`, `playerName`,
    `setPlayerColor(player, color)`, `addLeaveEvent(events, player)`. The
    pair stays two calls: Smashcraft holds `Player(slot)` in a local and tests
    the pair for humans and for computers, and `playerFiles.ts:91` tests the
    slot state alone.
  - Warcraft: `Player`, `GetPlayerId`, `GetLocalPlayer`,
    `GetTriggerPlayer`, `GetPlayerController`, `GetPlayerSlotState`,
    `GetPlayerName`, `SetPlayerColor` with
    `ConvertPlayerColor`, `TriggerRegisterPlayerEvent(EVENT_PLAYER_LEAVE)`.
  - Native owner: the netcode session's slots (`src/netcode`, `host/net`),
    filled from the lobby.
- **Units and positions** (`wisp/game/bodies`). 53 sites in 9 files, 34
  natives.
  - Calls: `mapCenter`, `locationX`, `locationY`, `removeLocation`,
    `createBody(player, kind, x, y, facing)`, `removeBody`, `setBodyX`,
    `setBodyY`, `setBodyHeight`, `setBodyFacing`, `setBodyColor`,
    `setBodyTint`, `setBodyScale`, `setBodyTimeScale`, `setBodyAnimation`,
    `setBodyAnimationIndex`, `showBody`, local `bodyHidden`,
    `setBodyTeamGlow`, and local diagnostic reads `bodyKind`,
    `bodyMoveSpeed`, `bodyAttackCooldown`. Warcraft-only object setup keeps
    one call per native (`setBodyName`, `setBodySelectionScale`,
    `setBodyMoveSpeed`, `setBodyAttackCooldown`, `setBodyBlendTime`,
    `setBodyInvulnerable`, `setBodyPathing`, `pauseBody`, `addBodyAbility`,
    `removeBodyAbility`, `setAbilityTooltip`), each a no-op on native.
    Sites set these in different runs, so no composite reproduces them.
  - Warcraft: `GetRectCenter(GetPlayableMapRect())` (`mapCenter`),
    `GetLocationX/Y`, `RemoveLocation`, `CreateUnit`, `RemoveUnit`,
    `SetUnitX/Y`, `SetUnitFlyHeight`, `BlzSetUnitFacingEx`, `SetUnitColor`,
    `SetUnitVertexColor`, `SetUnitScale`, `SetUnitTimeScale`,
    `SetUnitAnimation`/`ByIndex`, `ShowUnit`, `IsUnitHidden`,
    `BlzShowUnitTeamGlow`, and the object-data setters (`BlzSetUnitName`,
    `BlzSetUnitRealField`, `SetUnitMoveSpeed`, `BlzSetUnitAttackCooldown`,
    `UnitAddAbility`, `UnitRemoveAbility`, `SetUnitInvulnerable`,
    `SetUnitPathing`, `PauseUnit`, `SetUnitBlendTime`, and
    `BlzSetAbilityTooltip` for the fighter unit's ability).
  - Native owner: `src/game/native/bodies.ts` (from
    `src/headless/natives/units.ts`). A body is a posed model with team
    colour in the same drawn-model list as effects.
- **Strings and math** (`wisp/game/text`). 242 sites in 35 files, 8 natives.
  - Calls: `formatInt`, `formatReal`, `formatRealWidth`, `parseInt`,
    `parseReal`, `toReal`, `truncate`, `textLength`.
  - Warcraft: `I2S`, `R2S`, `R2SW`, `S2I`, `S2R`, `I2R`, `R2I`,
    `StringLength`, each one to one.
  - Native owner: `src/game/native/text.ts`, which states Wisp's own
    formatting rules on top of the num module's binary32 helpers. It moves
    from `src/headless/natives/math.ts`, with the formatting half of
    `jassFormat.ts` (frames take the rest in G2). Lowering
    `toReal` to nothing would save a native call per use, but only if Lua
    5.3's integer and float subtypes never reach formatting. That is a later
    measured change, not this plan.
- **Camera and world look** (`wisp/game/view`). 80 sites in 10 files, 35
  natives.
  - Calls: camera fields, bounds, position, pan and smoothing, and local
    camera reads; fog, sky, terrain visibility, day and night models, time
    of day, shadow lights; the cinematic filter.
  - Warcraft: `SetCameraField`, `GetCameraField`, `SetCameraBounds`,
    `SetCameraPosition`, `PanCameraToTimed`, `CameraSetSmoothingFactor`,
    `GetCamera*Position*`, `SetTerrainFogEx(V)`, `ResetTerrainFog`,
    `BlzSetTerrainFog*`, `FogEnable`, `FogMaskEnable`, `SetSkyModel`,
    `BlzShowSkyBox`, `BlzShowTerrain`, `SetDayNightModels`,
    `SetTimeOfDay(Scale)`, `BlzSetMinShadowCastingPointLightCount`,
    `SetCineFilter*`, `DisplayCineFilter`.
  - Native owner: `src/game/native/view.ts` (from
    `src/headless/natives/cameraCine.ts`), camera placement in
    `host/render/screen.ts`, and lighting, fog, sky and filter passes in W4.
- **Sync messages** (`wisp/game/sync`). 39 sites in 13 files, 4 natives.
  - Calls: `send(prefix, data)`, `addMessageEvent(events, player, prefix)`,
    `messageData`, `messagePrefix`.
  - Warcraft: `BlzSendSyncData`, `BlzTriggerRegisterPlayerSyncEvent`,
    `BlzGetTriggerSyncData`, `BlzGetTriggerSyncPrefix`.
  - Native owner: Wisp's transport (`src/netcode`, `host/net`, `relay/`).
- **Files** (`wisp/game/files`). 33 sites in 7 files, 4 natives.
  - Calls: `clearFileLines`, `startFile`, `addFileLine(text)`, `endFile(path)`,
    one per native, because sites add lines in loops and between other calls
    and a `lines` array would allocate; reads stay in `src/map/fileio.ts`.
  - Warcraft: `PreloadGenClear`, `PreloadGenStart`, `Preload`,
    `PreloadGenEnd`.
  - Native owner: host file I/O on Bun, in the game's data folder.
- **Handle ids.** 15 sites in 7 files. This family has no module of its own.
  - A key's code is input's `eventKey`, which lowers to the
    `GetHandleId(BlzGetTriggerPlayerKey())` pair (6 sites).
  - A frame's id is frames' `frameId`, which lowers to `GetHandleId` (2
    sites in `game/ui/frames.ts`).
  - The rest are Warcraft backend diagnostics and keep calling
    `GetHandleId` on raw handles: the soak handle ledger
    (`platform/soakHandles.ts`), `host/loop/sessionRates.ts` and
    `host/loop/objectData.ts`.

## Migration order

Each step lands in Wisp first and is then picked up by Smashcraft's pin
update and codemod. Both backends are green after each step:

- **Warcraft backend green:** Smashcraft's suite (sim, headless Bun, Lua32),
  the empty bundle diff and `perf compare --threshold 0`.
- **Native backend green:** `wisp play --standalone --window native`
  scripted run, in which the Bun run's call log shows no emulated native of the
  migrated family.

Per Smashcraft's policy, the step lands on those checks and takes its
native capture on main's build afterwards.

1. **G1 effects** (623 sites). It is first because it carries the plugin's
   falsifying check. The renderer already draws effects, and the effects
   store is the most domain-shaped one.
2. **G2 UI frames and events** (714 and 51 sites). It is second because
   the native window already draws UI frames and the menus are the whole
   game outside a match. Events come with it because frames are the first
   family that registers anything. The registrations of other families (key,
   sync, chat, leave) stay raw natives on an events value until their own
   step.
3. **Strings and math** (242). Pure, one to one, and the replay-text rule
   is settled here.
4. **Players, sync messages, input and clock** (169, 39, 48, 61) are one
   family each but land in that order. Together they are the lockstep path, so
   each one's box runs the four-client playable journey for divergence as
   well as the Lua diff.
5. **Sound** (78), **camera and world look** (80), **units and positions**
   (53) and **files** (33), in any order: they share no call and take no
   events value. Handle ids move with frames (step
   2) and input (step 4), and the diagnostics stay raw.
6. **Shrink headless** once every family has moved. The Bun runtime runs
   only the native backend. The Warcraft emulation in `src/headless`
   (`client.ts`'s native table, `warcraft3Natives.ts` and the native-named
   entry points of each store) remains only as what the 32-bit Lua runs of
   the Warcraft backend's bundle need. Every quirk with no Lua test that
   needs it is deleted, with its doc rows in headless.md. Every Wisp
   example and fixture map moves onto the API or into a Lua run, because only
   main is supported. This step is several landings (G8a to G8d), and each
   leaves both backends green.

## Boxes

Placement: every box is code-only work on public repos (wisp, smashcraft), so
it goes to the cloud lane while the credit lasts.

**What can run in parallel.** A box starts once the boxes it names have landed:

- G1 lands first, because every other box needs its plugin.
- After G1, these run at once: G2, G3, G5, G6 and G7b. G3 (strings and math)
  needs only G1's plugin.
- G4a needs G2 as well, because its registrations take an events value.
- The lockstep path lands strictly in order: G4a, G4b, G4c, G4d. Each one's
  four-client check then names the one family that broke it.
- G7a follows G4a, which adds nested templates. G5, G6, G7a and G7b run beside
  the lockstep path.
- G8a, G8b, G8c and G8d land in order, after every family.

**Rules for parallel boxes:**

- `build/before.*` comes from the codemod commit's actual parent. When another
  box lands first, rebase and rebuild `before`, because the bundle changes.
- The codemod is a script in the lane. On a rebase conflict, reset to
  origin/main, then rerun the pin update and the script. Never merge pin files.
- G2 and G3 both take from `jassFormat.ts`. The second to land moves its half
  from wherever the first left it.
- Each box's list comes from the survey at smashcraft e611550e48, and its counts
  are what its `rg` printed there. `ConvertPlayerColor` is in G7a's list and
  `TriggerRegisterPlayerEvent` in G4c's, because a site of each outlasts G4a.

### G1: effects family

Wisp:

- `src/game/effects.d.ts`, `src/game/warcraft/effects.ts`, and
  `src/game/native/effects.ts`. The native module is the headless
  `Effects` store, moved together with `src/headless/lightnings.ts` and
  `textTags.ts`, because beams and floating text are in this family.
- The store helpers it needs, moved into `src/game/native/`:
  `animation.ts`, `frameRate.ts`, the store types from `clientTypes.ts`,
  and `copyBlend`. The units store imports `copyBlend` from there until
  bodies moves.
- `src/game/native/world.ts` and its binding in `host/headless` and the
  native window session.
- `plugins/game-api.ts`.
- `exports` and a CHANGELOG line.
- The structure.toml module and its `may_use` edges, the architecture.md
  row, and the clean-room.md line.
- The headless log hook. Also a count of emulated-native calls per name in
  the headless client, which check 5 reads.
- A docs page `docs/game-api.md` with the effects family, linked from
  docs/index.md.

First, before the codemod, check two things. Lower one call
(`setEffectScale`) in a fixture map, and check that its Lua is
byte-identical to the native call. Then check that two headless clients keep
separate effects.

Smashcraft lands two commits: the pin update alone, then a codemod of the 34
effect natives to `wisp/game/effects`. `platform/soakHandles.ts` keeps raw
natives, because it uses them as values.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(AddLightningEx|AddSpecialEffect|BlzGetLocalSpecialEffectX|BlzGetLocalSpecialEffectY|BlzGetLocalSpecialEffectZ|BlzGetSpecialEffectScale|BlzPlaySpecialEffect|BlzResetSpecialEffectMatrix|BlzSetSpecialEffectAlpha|BlzSetSpecialEffectAnimation|BlzSetSpecialEffectAnimationBlendTime|BlzSetSpecialEffectColor|BlzSetSpecialEffectColorByPlayer|BlzSetSpecialEffectMatrixScale|BlzSetSpecialEffectOrientation|BlzSetSpecialEffectPitch|BlzSetSpecialEffectPosition|BlzSetSpecialEffectRoll|BlzSetSpecialEffectScale|BlzSetSpecialEffectTime|BlzSetSpecialEffectTimeScale|BlzSetSpecialEffectYaw|BlzSetSpecialEffectZ|BlzSpecialEffectClearSubAnimations|CreateTextTag|DestroyEffect|DestroyLightning|MoveLightningEx|SetLightningColor|SetTextTagColor|SetTextTagPermanent|SetTextTagPos|SetTextTagText|SetTextTagVisibility)\(' src | wc -l` prints
   `0`. It prints 623 at 6782827367.
2. The normalized diff of `build/before.lua` and `build/after.lua` (step 3
   of the measurement) prints nothing.
3. `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
4. Smashcraft's `bun run test` passes in Bun and Lua32, with Bun/Lua parity
   checksums equal on playable-human-four.
5. The native window's scripted standalone run draws the match's effects,
   and its headless client counts zero emulated calls of those 34 natives.

Not required:

- lowering any other family;
- drawing emitters or lightning in Rust (W4);
- deleting the headless effect emulation (step 6).

### G2: UI frames and events

Wisp:

- `src/game/frames.d.ts`, `src/game/warcraft/frames.ts` and
  `src/game/native/frames.ts`, from the headless frames store together
  with `src/headless/frames.ts` and `jassFormat.ts`.
- `wisp/game/events` (from the trigger half of `triggersTimers.ts`).
- The frame kinds and templates as literal unions.
- The native backend's duplicate-registration check.
- The frames and events section of `docs/game-api.md`.

Smashcraft lands two commits: the pin update alone, then a codemod. The
codemod moves the 48 UI natives in `game/ui`, `game/render`, `host/loop`,
`host/entries` and `platform/` (`BlzSetAbilityTooltip` goes to bodies and
`BlzEnableCursor` to input), the 51 event sites, and the 2 frame-id
`GetHandleId` sites. `BlzFrameSetModel` and `BlzFrameSetSpriteAnimate`
(`game/ui/liveCard.ts`) landed after the survey and move too.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(BJDebugMsg|BlzConvertColor|BlzCreateFrame|BlzCreateFrameByType|BlzDestroyFrame|BlzFrameClearAllPoints|BlzFrameGetChild|BlzFrameGetChildrenCount|BlzFrameGetEnable|BlzFrameGetName|BlzFrameGetText|BlzFrameGetTextSizeLimit|BlzFrameIsVisible|BlzFrameSetAbsPoint|BlzFrameSetAlpha|BlzFrameSetEnable|BlzFrameSetFocus|BlzFrameSetFont|BlzFrameSetLevel|BlzFrameSetModel|BlzFrameSetPoint|BlzFrameSetScale|BlzFrameSetSize|BlzFrameSetSpriteAnimate|BlzFrameSetText|BlzFrameSetTextAlignment|BlzFrameSetTextSizeLimit|BlzFrameSetTexture|BlzFrameSetVertexColor|BlzFrameSetVisible|BlzGetFrameByName|BlzGetLocalClientHeight|BlzGetLocalClientWidth|BlzGetOriginFrame|BlzGetTriggerFrame|BlzGetTriggerFrameEvent|BlzGetTriggerFrameText|BlzHideOriginFrames|BlzLoadTOCFile|BlzTriggerRegisterFrameEvent|ClearTextMessages|CreateQuest|DisplayTextToPlayer|DisplayTimedTextToPlayer|QuestSetCompleted|QuestSetDescription|QuestSetDiscovered|QuestSetIconPath|QuestSetRequired|QuestSetTitle|WispFrameSetSpriteTime|CreateTrigger|TriggerAddAction|DestroyTrigger)\(' src | wc -l`
   prints `0`. It prints 765 at 6782827367 with the 48 names the pattern held then, and 775 with the three model and sprite names (`BlzFrameSetModel`, `BlzFrameSetSpriteAnimate`, `WispFrameSetSpriteTime`, all in `game/ui/liveCard.ts`) at 5cff2f5fad.
2. The normalized bundle diff prints nothing.
3. `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
4. Smashcraft's `bun run test` passes in Bun and Lua32, with parity
   checksums equal.
5. The native window's scripted standalone run shows character select and
   the match HUD, and its headless client counts zero emulated calls of
   those 51 natives.

Not required:

- widget components above the API (see prior-art.md);
- frames with a colour but no texture;
- any other family.

### G3: strings and math

ETA: 60 min. Depends on: G1. Runs beside G2, G5, G6 and G7b.

Wisp:

- `src/game/text.d.ts`, `src/game/warcraft/text.ts` and
  `src/game/native/text.ts`, from `src/headless/natives/math.ts` (the eight
  rows only) and the formatting half of `jassFormat.ts`: `describeNumber`,
  `fixed` and `leadingNumber`.
- The rules in `docs/game-api.md`: `formatReal` keeps `R2S`'s binary32 text
  with ties away from zero, because replays are text.

Smashcraft lands two commits: the pin update alone, then a codemod of the 8
natives. Every call is one to one, so the lowering needs nothing beyond G1's
template format.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(I2R|I2S|R2I|R2S|R2SW|S2I|S2R|StringLength)\(' src | wc -l` prints `0`. It prints 235 at e611550e48.
2. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. A Bun test and a Lua32 test of `src/game/native/text.ts` give the same text
   for the same table of values, ties included.
5. The native window's scripted standalone run shows character select, and its
   headless client counts zero emulated calls of those 8 natives.

Not required:

- lowering `toReal` to nothing;
- `SubString`, `SquareRoot`, `Atan2` and the bit natives, which Smashcraft does
  not call;
- any other family.

### G4a: players

ETA: 90 min. Depends on: G1, G2. First box of the lockstep path.

Wisp:

- The template format grows two forms in `src/game/warcraft/lowering.ts` and
  `plugins/game-api.ts`: a global as an argument
  (`TriggerRegisterPlayerEvent($1, $2, EVENT_PLAYER_LEAVE)`) and a nested
  native (`SetPlayerColor($1, ConvertPlayerColor($2))`). A template is still
  one expression, and each `$n` is used at most once.
- `src/game/players.d.ts`, `src/game/warcraft/players.ts` and
  `src/game/native/players.ts`, over the netcode session's slots. `Player`
  moves here from `effects.d.ts`.
- Headless binds each client's slots into its world.

Smashcraft lands two commits: the pin update alone, then a codemod. The second
also makes `ts/scripts/wisp/perfLua.ts` fail a run when `clients.firstDivergence()`
is set, because no perf run checks that today. `ConvertPlayerColor` at `SetUnitColor` moves with bodies (G7a) and the
mouse-move `TriggerRegisterPlayerEvent` with input (G4c).

Done when:

1. In smashcraft `ts/`, `rg -o '\b(GetLocalPlayer|GetPlayerController|GetPlayerId|GetPlayerName|GetPlayerSlotState|GetTriggerPlayer|Player|SetPlayerColor)\(' src | wc -l` prints `0`, and
   `rg -c EVENT_PLAYER_LEAVE src` prints nothing. The first prints
   164 at e611550e48.
2. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. `bun wisp perf playable-human-four` exits 0 with its four clients undiverged,
   and `bun wisp net pair --humans 4 --relay local --script
   test/native/pads/trailer/online-rollback.pad --frames 600` ends with
   `checksums match on all 4`.
5. The native window's scripted standalone run reaches a match with the
   lobby's slots, and its headless client counts zero emulated calls of those
   8 natives.

Not required:

- native lobby features beyond the slots (one-team maps, switching maps);
- any other family.

### G4b: sync messages

ETA: 90 min. Depends on: G4a.

Wisp:

- `src/game/sync.d.ts`, `src/game/warcraft/sync.ts` and
  `src/game/native/sync.ts`. Under headless the module delivers through
  `src/headless/syncChannel.ts`, moved with it. Under `net` runs it delivers
  through `host/net`.
- The contract: delivery in the same order per peer, including the sender, and
  a 255-character limit. The native backend throws on a longer message, which
  headless Bun tests catch.

Smashcraft lands two commits: the pin update alone, then a codemod of the 4
natives.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(BlzGetTriggerSyncData|BlzGetTriggerSyncPrefix|BlzSendSyncData|BlzTriggerRegisterPlayerSyncEvent)\(' src | wc -l` prints `0`. It prints 39 at e611550e48.
2. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. `bun wisp perf playable-human-four` exits 0 with its four clients undiverged,
   and `bun wisp net pair --humans 4 --relay local --script
   test/native/pads/trailer/online-rollback.pad --frames 600` ends with
   `checksums match on all 4`.
5. A Wisp test sends a 256-character message on the native backend and sees it
   refused, and its headless client counts zero emulated calls of those 4
   natives on playable-human-four.

Not required:

- server-sent messages;
- changing the relay or the wire format.

### G4c: input

ETA: 90 min. Depends on: G4b.

Wisp:

- `src/game/input.d.ts`, `src/game/warcraft/input.ts` and
  `src/game/native/input.ts`, reading the samples that
  `host/window/frameLoop.ts` delivers and `src/headless/pointer.ts`.
- `eventKey` lowers to `GetHandleId(BlzGetTriggerPlayerKey())`, the 6 sites'
  pair. `osKey(code)` lowers to `ConvertOsKeyType($1)` and stays its own call,
  because `platform/osKeys.ts` caches its result and `addKeyEvent` takes that
  value.

Smashcraft lands two commits: the pin update alone, then a codemod of the 17
natives, which takes the 6 key `GetHandleId` sites with them.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(BlzEnableCursor|BlzEnableSelections|BlzGetMouseScreenPosX|BlzGetMouseScreenPosY|BlzGetTriggerPlayerKey|BlzGetTriggerPlayerMouseX|BlzGetTriggerPlayerMouseY|BlzIsKeyPressed|BlzIsLocalClientActive|BlzIsMouseButtonPressed|BlzSetMousePos|BlzTriggerRegisterPlayerKeyEvent|ConvertOsKeyType|EnableUserControl|GetEventPlayerChatString|TriggerRegisterPlayerChatEvent|TriggerRegisterPlayerEvent)\(' src | wc -l` prints `0`. It prints 50 at e611550e48.
2. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. `bun wisp perf playable-human-four` exits 0 with its four clients undiverged,
   and `bun wisp net pair --humans 4 --relay local --script
   test/native/pads/trailer/online-rollback.pad --frames 600` ends with
   `checksums match on all 4`.
5. The native window's scripted standalone run moves a fighter by key and
   selects a card by mouse, and its headless client counts zero emulated calls
   of those 17 natives.

Not required:

- the typed character, relative motion, cursor icon, cage or frame under the
  pointer (the proposed input completion box);
- new pad sampling in Rust.

### G4d: clock

ETA: 90 min. Depends on: G4c. Last box of the lockstep path.

Wisp:

- `src/game/clock.d.ts`, `src/game/warcraft/clock.ts` and
  `src/game/native/clock.ts`: integer frames, fired by the window's frame clock
  through `host/window/simWorker.ts` and by the frame step under headless.
- `timerDeadline.ts` stays in `src/headless`. A timer whose period is not a
  whole number of frames fires on the frame at or after its deadline. If that
  changes a parity checksum, the map's period changes; the native clock gains
  no rounding.

Smashcraft lands two commits: the pin update alone, then a codemod of the 9
natives. `TimerGetElapsed` becomes `localElapsed`.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(CreateTimer|DestroyTimer|GetGameSpeed|PauseTimer|RestartGame|SetGameSpeed|SetMapFlag|TimerGetElapsed|TimerStart)\(' src | wc -l` prints `0`. It prints 61 at e611550e48.
2. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. `bun wisp perf playable-human-four` exits 0 with its four clients undiverged,
   and `bun wisp net pair --humans 4 --relay local --script
   test/native/pads/trailer/online-rollback.pad --frames 600` ends with
   `checksums match on all 4`.
5. The native window's scripted standalone run holds 60 ticks/s through a
   match, and its headless client counts zero emulated calls of those 9
   natives.

Not required:

- a composite `onFrame`;
- changing how `betweenFrames.ts` computes its alpha;
- saved games.

### G5: sound

ETA: 75 min. Depends on: G1. Runs beside every box before G8a.

Wisp:

- `src/game/sound.d.ts`, `src/game/warcraft/sound.ts` and
  `src/game/native/sound.ts`, from `src/headless/natives/sound.ts`. The cues
  still reach `host/window/soundPlayer.ts`.

Smashcraft lands two commits: the pin update alone, then a codemod of the 19
natives, all one to one.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(ClearMapMusic|CreateSound|CreateSoundFromLabel|EndThematicMusic|GetSoundFileDuration|KillSoundWhenDone|PlayMusic|PlayThematicMusic|SetSoundDistanceCutoff|SetSoundDistances|SetSoundDuration|SetSoundPitch|SetSoundPosition|SetSoundVolume|StartSound|StopMusic|StopSound|VolumeGroupReset|VolumeGroupSetVolume)\(' src | wc -l` prints `0`. It prints 78 at e611550e48.
2. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. `bun wisp headless --sound-cues FILE --json` lists the same cues before and
   after the codemod.
5. The native window's scripted standalone run reports `audioPlayed` above 0
   and no missing sound, and its headless client counts zero emulated calls of
   those 19 natives.

Not required:

- mixer changes in Rust;
- any other family.

### G6: camera and world look

ETA: 90 min. Depends on: G1. Runs beside every box before G8a.

Wisp:

- `src/game/view.d.ts`, `src/game/warcraft/view.ts` and
  `src/game/native/view.ts`, from `src/headless/natives/cameraCine.ts`. Fog,
  sky, terrain, day and night, and light calls that the emulation only records
  move as records.
- One call per native, so `GetCameraTargetPositionX/Y/Z` and
  `GetCameraEyePositionX/Y/Z` are six local reads.

Smashcraft lands two commits: the pin update alone, then a codemod of the 35
natives. `WispSetSkyLook` and `WispResetSkyLook` stay as they are: they are
Wisp's own window hooks, guarded by `typeof`, and an API call has no value to
guard.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(BlzSetMinShadowCastingPointLightCount|BlzSetTerrainFogDrawOverSky|BlzSetTerrainFogMaxLinearDensity|BlzShowSkyBox|BlzShowTerrain|CameraSetSmoothingFactor|DisplayCineFilter|FogEnable|FogMaskEnable|GetCameraEyePositionX|GetCameraEyePositionY|GetCameraEyePositionZ|GetCameraField|GetCameraTargetPositionX|GetCameraTargetPositionY|GetCameraTargetPositionZ|PanCameraToTimed|ResetTerrainFog|SetCameraBounds|SetCameraField|SetCameraPosition|SetCineFilterBlendMode|SetCineFilterDuration|SetCineFilterEndColor|SetCineFilterEndUV|SetCineFilterStartColor|SetCineFilterStartUV|SetCineFilterTexMapFlags|SetCineFilterTexture|SetDayNightModels|SetSkyModel|SetTerrainFogEx|SetTerrainFogExV|SetTimeOfDay|SetTimeOfDayScale)\(' src | wc -l` prints `0`. It prints 80 at e611550e48.
2. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. The native window's scripted standalone run frames a match with the same
   camera pose as before the codemod, and its headless client counts zero
   emulated calls of those 35 natives.

Not required:

- drawing fog, sky or the filter in Rust (W4);
- depth of field and world-to-screen.

### G7a: units and positions

ETA: 90 min. Depends on: G1, and G4a for nested templates. Runs beside every
other box before G8a.

Wisp:

- `src/game/bodies.d.ts`, `src/game/warcraft/bodies.ts` and
  `src/game/native/bodies.ts`, from `src/headless/natives/units.ts`.
  `copyBlend` loses its last headless user.
- `mapCenter` lowers to `GetRectCenter(GetPlayableMapRect())`, and
  `setBodyColor(body, color)` to `SetUnitColor($1, ConvertPlayerColor($2))`.
- Calls that only set up Warcraft's unit are no-ops on the native backend,
  declared as such.

Smashcraft lands two commits: the pin update alone, then a codemod of the 34
natives and the last `ConvertPlayerColor`. Its `worldOrigin` in
`host/loop/shell.ts` stays a local function over the parts.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(BlzGetUnitAttackCooldown|BlzSetAbilityTooltip|BlzSetUnitAttackCooldown|BlzSetUnitFacingEx|BlzSetUnitName|BlzSetUnitRealField|BlzShowUnitTeamGlow|ConvertPlayerColor|CreateUnit|GetLocationX|GetLocationY|GetPlayableMapRect|GetRectCenter|GetUnitMoveSpeed|GetUnitTypeId|IsUnitHidden|PauseUnit|RemoveLocation|RemoveUnit|SetUnitAnimation|SetUnitAnimationByIndex|SetUnitBlendTime|SetUnitColor|SetUnitFlyHeight|SetUnitInvulnerable|SetUnitMoveSpeed|SetUnitPathing|SetUnitScale|SetUnitTimeScale|SetUnitVertexColor|SetUnitX|SetUnitY|ShowUnit|UnitAddAbility|UnitRemoveAbility)\(' src | wc -l` prints `0`. It prints 56 at e611550e48.
2. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. The native window's scripted standalone run draws the fighters in their team
   colours, and its headless client counts zero emulated calls of those 35
   natives.

Not required:

- the `setModel`, `attach` and `queueAnimation` calls (proposed box);
- any other family.

### G7b: files

ETA: 60 min. Depends on: G1. Runs beside every box before G8a.

Wisp:

- `src/game/files.d.ts`, `src/game/warcraft/files.ts` and
  `src/game/native/files.ts`: the host's file I/O in the game's data folder.
  Preload's 259-byte cut stays in `src/headless/natives/preloadText.ts`.

Smashcraft lands two commits: the pin update alone, then a codemod of the 4
natives.

Done when:

1. In smashcraft `ts/`, `rg -o '\b(Preload|PreloadGenClear|PreloadGenEnd|PreloadGenStart)\(' src | wc -l` prints `0`. It prints 33 at e611550e48.
2. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. A Wisp test writes a 300-byte line on the native backend and reads all 300
   bytes back, and its headless client counts zero emulated calls of those 4
   natives on playable-human-four.

Not required:

- moving reads out of `src/map/fileio.ts`;
- saved games.

### G8a: Wisp constants and opaque handles

ETA: 90 min. Depends on: G2, G4d, G5, G6, G7a, G7b. First shrink box.

Wisp:

- `plugins/game-api.ts` lowers a family constant (`EffectAnimation.attack`) to
  the global the native expects, the same global read as today. G1 added no
  constants, and the plugin has no form for them yet.
- Each family's `.d.ts` declares the constants Smashcraft uses, and the native
  backend gives them Wisp's own values. Until this box they are Warcraft's raw
  globals, so a family's codemod leaves them in place.
- Every `export type X = <warcraft type>` in `src/game/*.d.ts` becomes opaque.

Smashcraft lands two commits: the pin update alone, then a codemod of the
constants and of the handle type names. `platform/soakHandles.ts`,
`host/loop/sessionRates.ts`, `host/loop/handleLedger.ts` and
`host/loop/objectData.ts` hold the only casts to a Warcraft type, for
`GetHandleId` and the by-name wrappers.

Done when:

1. In smashcraft `ts/`, after
   `grep -oE '^declare (const|var|let) [A-Za-z0-9_]+' node_modules/wisp/src/natives/warcraft.d.ts | awk '{print $3}' > /tmp/constants.txt`,
   `rg -o -w -f /tmp/constants.txt src | wc -l` prints `0`. It prints 233 at
   e611550e48.
2. In wisp, `rg -n '^export type \w+ = [a-z]' src/game/*.d.ts | wc -l` prints
   `0`, and smashcraft's `bun run check` passes.
3. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
4. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.

Not required:

- removing `GetHandleId` from the diagnostics;
- Wisp's own code (G8b).

### G8b: Wisp's own code on the API

ETA: 90 min. Depends on: G8a.

Wisp:

- `src/map`, `src/ui` and `examples/` move onto the API, 177 native sites at
  ac1f9d30, 13 of them in `src/map/fileio.ts`. That file keeps its raw reads as Warcraft backend code,
  and the native backend gets its own reader.
- `test/` fixtures do not move here (G8d).

Done when:

1. The survey script over `src/map`, `src/ui` and `examples`, skipping
   `src/map/fileio.ts`, prints `total natives 0 sites 0`.
2. `examples/sample`'s compiled bundle diffs empty before and after, with the
   same normalizing `sed`.
3. Wisp's `bun test` passes in Bun and Lua32, and smashcraft's `bun run test`
   passes on a pin of this commit.
4. `examples/sample` runs in the native window's scripted standalone run with
   no emulated call of any native.

Not required:

- calls the families lack: a missing call is added to its family in this box,
  with its lowering row, and nothing else is added.

### G8c: Bun runs only the native backend

ETA: 90 min. Depends on: G8b.

Wisp:

- A map on Bun gets no Warcraft global from `src/headless/client.ts`. Only
  Wisp's own hooks (`WispSetPlaying`, `WispSetSkyLook`, `WispResetSkyLook`)
  remain. A `warcraftNatives: true` client option keeps the table for the
  fixtures that G8d moves, and G8d removes it.
- Headless Bun/Lua parity still holds: Bun logs each call's lowering row, and
  Lua logs the same native.

Smashcraft:

- `platform/soakHandles.ts`, `host/loop/sessionRates.ts` and
  `host/loop/handleLedger.ts` wrap natives by name, so they install nothing on
  Bun and run only in Lua32. Their tests move to Lua32 or read the native
  backend's log. The `GetHandleId` diagnostics follow them.
- The 20 sites in `ts/test` and `ts/scripts` that run on Bun move to the API.

Done when:

1. On Bun, a headless client's `emulatedCalls` sums to 0 over
   playable-human-four.
2. In smashcraft `ts/`, the survey script over `src`, skipping those three
   files, `host/loop/objectData.ts` and the `Wisp*` hooks, prints `total
   natives 0 sites 0`.
3. Smashcraft's `bun run test` passes in Bun and Lua32, with parity checksums
   equal on playable-human-four.
4. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
5. `bun wisp perf playable-human-four` exits 0 with its four clients undiverged,
   and `bun wisp net pair --humans 4 --relay local --script
   test/native/pads/trailer/online-rollback.pad --frames 600` ends with
   `checksums match on all 4`.

Not required:

- deleting any emulation (G8d).

### G8d: delete what no Lua test needs

ETA: 90 min. Depends on: G8c. Last box. If `test/` holds more Bun-only fixtures
than one worker can land, stop with `Split:` by fixture directory.

Wisp:

- Each `test/` fixture that still needs `warcraftNatives: true` moves to its
  Lua run or goes with the quirk it tests. `test/` holds 1,034 native
  sites at ac1f9d30.
- The option goes. So does every native-named entry point and quirk with no Lua
  test that needs it, with its row in [headless.md](headless.md). `client.ts`'s
  table and `warcraft3Natives.ts` stay as what the 32-bit Lua runs need.

Done when:

1. `rg -n 'warcraftNatives' src host test | wc -l` prints `0`.
2. `rg -l 'timerDeadline|preloadText' src/game | wc -l` prints `0`.
3. Wisp's `bun test` passes in Bun and Lua32, and smashcraft's `bun run test`
   passes on a pin of this commit.
4. The normalized bundle diff prints nothing, and
   `bun wisp perf compare build/before.perf build/after.perf --threshold 0`
   exits 0.
5. The native window's scripted standalone run plays a match on the pinned
   build.

Not required:

- removing the Warcraft backend or Lua runs;
- generating `docs/game-api.md` from the declarations.

## What extension engines were asked for

Research, 31 October 2026. Warcraft III extension engines are years of map
makers asking for what the stock game cannot do. This section classifies
those requests against the families above. It ranks them by how much each one
speeds up making a game in Wisp (hot reload, fast iteration, fewer
workarounds) and by what Smashcraft and later Wisp games need. Only facts
about the APIs and the requests are recorded. No source licenses its code to
Wisp (W3CE has no licence, YDWE is GPL-3.0, and the KKAPI and JAPI docs are
platform documentation), so nothing here is copied from them.

Sources:

- **W3CE 0.3.2 natives.** Read from `Scripts/common.j` inside `W3CE.mpq`,
  in the release Tom downloaded (W3CE-v0.3.2.zip, files dated 16 October
  2026). The archive was read with smpq, and no executable was run. Against
  the stock `common.1.29.2.j` shipped in the same archive, it declares 518
  more natives: 225 `Ce*`, 206 `Blz*` from later retail patches, and 87
  others (field converters, minimap icons, command-button effects,
  checkpoints, depth of field). The `Ce*` natives come in 11 groups, with
  the three instance-field groups listed as one:
  - damage event (12): several damage types, attack flags, ranged, attack, damage
    and weapon type;
  - frames (85): creation with a create context, texture coordinates,
    border and tile size, alpha mode, layer and control style, position and
    size reads, parent, click, slider value, tooltip, cursor cage, a model in
    a frame, and the hovered frame;
  - instance fields (23, 8 and 20) for abilities, items, units and unit
    weapons;
  - keyboard (6): meta keys, the typed character, and a key event with a
    modifier mask;
  - model handle (35): position, orientation, scale, colour, time, animation by
    name, index, rarity or queue, model path swap, texture path by index,
    texture count, and attachments;
  - mouse (17): absolute and relative position, buttons, set position, hovered and
    targeted unit, item or destructable, and the cursor state and icon;
  - selection (4): selectable widgets, and units unselectable for the local
    player only;
  - sync (4): a sync event that can be marked as coming from the server;
  - user input mode (11): the build mode's unit, ability and ground point, the
    target mode's ability, order and target, and the current mode.
- **W3CE's [issues](https://github.com/Warcraft-III-Community-Edition/W3CE/issues?q=is%3Aissue)**
  (64 in all states, read 31 October 2026). This section links each request it
  uses.
- **W3CE's [Hive resource page](https://www.hiveworkshop.com/threads/warcraft-iii-community-edition.346600/)**
  (0.3.2, updated 17 October 2026), with its feature list, known issues and
  changelog. Pages 3 and 4 of the thread are user support and hold no
  feature requests.
- **The W3CE Discord #community-edition channel,** as screenshots Tom shared on
  31 October 2026. No message text is quoted.
- **The JAPI docs** ([embedded JAPI](https://github.com/PhoenixZeng/embedded-japi-vue-press)),
  read for their topic list: doodad, ability and item APIs; unit model,
  texture, portrait and name swap; attack missile model, arc and speed;
  binding an effect to a unit; world-to-screen conversion; the hovered unit;
  the FPS cap; and the server API. KKAPI and YDWE are as recorded in
  [prior-art.md](prior-art.md).

### W3CE as of 31 October 2026

These are dated facts. The Discord facts come from Tom's screenshots, and the
rest from the release and the Hive page:

- 0.3.2 is the current release. 0.4 has been on a public test realm since
  about 22 October. The launcher's own main menu carries the build and the
  Discord link.
- The current natives ship as `common.j` inside `w3ce.mpq`. The one on
  GitHub is years older (last pushed 22 December 2024). A 0.3 common.j of
  about 394 KB was posted in the Discord on 30 October. The 0.3.2 file read
  above is 400,323 bytes.
- 0.3.0 replaced Battle.net with W3CE's own server: accounts, hosted games,
  no port forwarding, and a game that survives the host leaving. It also
  added a Vulkan renderer, a deterministic Lua engine for maps that ship
  `war3map.l64` (beside the retail-compatible one), maps saved in the 3.0
  formats, and signed self-updates. It dropped the .NET runtime. 0.3.2 added
  the Reign of Chaos campaign as an edition switch, and realm games for maps
  up to 512 MB.
- 0.4 added credential storage on Linux. After it, Windows Defender flags the
  launcher as `Behavior:Win32/DefenseEvasion.A!ml`. The 0.3.2 changelog had
  already fixed one antivirus flag by making the release smaller.
- Reign of Chaos custom games are unsupported. The plan is a "balance set"
  inside The Frozen Throne. The campaign is a special case.
- Save and load are unsupported for maps that run Lua or WASM, and for
  multiplayer games. Lua, the new frames and the instance API keep state that
  the save format does not track.

### Lessons for Wisp

- **Distribution and antivirus trust.** W3CE ships a modified launcher that
  loads its own native code into Warcraft and now stores credentials. That
  behaviour is what a heuristic scanner flags, and every release has to earn
  that trust again. Wisp touches no Warcraft process. The Warcraft backend is
  a plain map, and the native backend is Wisp's own program, so it has nothing
  to hide from a scanner. Keep it that way: sign the player build
  (smashcraft#807), store no credentials Wisp does not need, and never
  inject.
- **Save and load with extended state.** W3CE cannot save because its
  additions keep state outside the game's save format. A Wisp family has to
  avoid that trap. Each family's native store is rebuilt from the
  simulation's state, so a save is a simulation snapshot plus the input
  since it. No family may keep state that the snapshot cannot rebuild.
- **Version and balance sets.** W3CE plans Reign of Chaos as a data set
  inside The Frozen Throne, not as a second engine. Wisp should do the same:
  a balance or version set is a data module chosen in the lobby, built into
  both backends, and included in the lockstep checksum. It is not a fork of
  the game's code.
- **Natives documentation drift.** W3CE's published `common.j` fell years
  behind the shipped one, so map makers copy files out of the archive by
  hand. Wisp's API declarations (`src/game/*.d.ts`) are the contract that
  both backends compile against, and `docs/game-api.md` must be generated
  from them or checked against them. The docs should never be written beside
  the declarations by hand.

### Requests and where they land

Status: **covered** means a family above already has the call. **Planned**
means the native window plan or a later family names it. **Missing** means
no Wisp plan has it. Rank 1 is the most valuable. Ranks 1 to 5 are the
proposed boxes below.

| Request | Source | What it does | Family | Status | Rank |
| --- | --- | --- | --- | --- | --- |
| Create and change doodads at run time | [W3CE#61](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/61), JAPI doodad API | Place, move, rotate, scale, recolour and remove scenery without editor preplacement | new: scenery (`wisp/game/scenery`) | missing (Smashcraft lists about 400 scenery pieces in `game/presentation/*Scenery.ts`, places them as effects in `host/loop/stageScenery.ts`, and moves the matrix stretch into the scale because Warcraft culls by scale) | 1 |
| Model texture swap | `CeSetModelTexturePath`/`CeGetModelTexturePath`/`CeGetModelTextureCount`, `CeSetWar3ImageTexturePath`, [W3CE#55](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/55) (still broken), JAPI unit texture | Replace one texture of a placed model by index | effects and bodies | missing (Reforged declares no texture-swap native, so the Warcraft backend lowers at compile time to a model variant per literal pair) | 2 |
| Model swap and attachments | `CeSetModelPath`, `CeAddModelAttachment`/`CeSetModelAttachment` ([W3CE#53](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/53)), JAPI bind effect, unit model and portrait | Change a placed model's file, and pin a model to another's attachment point | effects and bodies | missing (Warcraft: `AddSpecialEffectTarget`, `BlzSetUnitSkin`) | 2 |
| Queue and index animations | `CeQueueModelAnimation`, `CeSetModelAnimationByIndex`, `...WithRarity` | Play animations in sequence or by index without a timer | effects and bodies | planned in part (`playEffectAnimation`, `setBodyAnimation`); queue is missing | 2 |
| Full keyboard events | `CeTriggerRegisterPlayerKeyEvent` with a meta mask, `CeGetTriggerPlayerChar`, keys held in another window (fixed in 0.3.0) | Modifier-exact keys, the typed character, and no keys from unfocused windows | input | covered for keys with modifiers and focus (`addKeyEvent`, `windowFocused`); the typed character is missing | 3 |
| Mouse and cursor | `CeGetMouseX/Y`, `CeGetMouseRelativeX/Y` ([W3CE#57](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/57)), `CeSetMouseState`, `CeFrameCageMouse` | Relative motion, cursor icon and confining the cursor | input | covered for position, buttons, set and show; relative motion, cursor icon and cage are missing | 3 |
| What is under the pointer | `CeGetMouseHoveredFrame` and hovered or targeted unit, item and destructable, JAPI hovered unit and world-to-screen | Pick a frame or a body under the cursor, and convert between world and screen | input, view | missing (Smashcraft's character select hit-tests the pointer against its roster grid by hand, `tileAt` in `game/menu/selectionDrag.ts`) | 3 |
| Cliffs at run time | [W3CE#64](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/64) | Generate cliffs procedurally in game | new: world (`wisp/game/world`) | missing (the Warcraft backend lowers to `war3map.w3e` at build time through `terrainAuthor`; the native window draws terrain in W4) | 4 |
| Map bounds at run time | [W3CE#65](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/65) | Grow or shrink the playable map in game | world | missing | 4 |
| Terrain tiles and height | `SetTerrainType`, `TerrainDeform*`, and more than 16 tiles (0.3.0) | Paint and deform ground while playing | world | missing | 4 |
| More model formats | [W3CE#50](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/50) (W3CE declined it), SD models up to version 1100 | Load FBX, OBJ and Blend models | effects and bodies (asset build) | missing (the native renderer reads MDX; glTF converted to MDX at build time serves both backends) | 5 |
| Fonts | [W3CE#45](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/45) | Use more fonts than the install's seven | frames | covered (`setFont`; the native window rasterizes any TTF with fontdue) | 6 |
| Text outline and per-state colour | `CeSetFrameTextColorEx`, `CeFrameAddText` | Colour text per button state and append text | frames | missing (Smashcraft draws an outline from four text copies in `game/ui/textOutline.ts`, while the native window already draws stroke) | 6 |
| Frame geometry reads and texture coordinates | `CeGetFrameX/Y`, `CeFrameGetWidth/Height`, `CeFrameGet/SetParent`, `CeSetFrameTexCoord`, `CeGetFrameScale` | Read layout back, reparent, and draw part of a texture | frames | missing (G2 reads visibility, text, name and children only) | 7 |
| Frame widgets | `CeFrameSetValue`/`MinMax`/`StepSize`, `CeFrameSetTooltip`, `CeFrameClick`, `CeFrameSetModel`/`CeGetFrameModel`, backdrop border, tile and alpha mode | Sliders, tooltips, scripted clicks, and models in UI | frames | missing | 7 |
| Hotkeys defined in FDF | [W3CE#32](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/32) | Buttons fire from their declared hotkey | frames, input | missing | 7 |
| Save and load with extended state | Hive known issues, Discord (31 October) | Save games whose script or UI state is outside the engine's save | files, clock | missing (a simulation snapshot plus input, which also lets hot reload jump to a saved moment) | 8 |
| Unlimited command buttons | [W3CE#62](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/62), `CeGetCommandButtonData`, command-button effects | More ability slots than the 12-button card | new: command card, built from frames | missing (Smashcraft has no command card; the native backend builds one from frames and input) | 9 |
| Grid hotkeys | [W3CE#63](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/63) | Keys by grid position, not by letter | command card, input | missing | 9 |
| Build and target mode reads | `CeGetBuildMode*`, `CeGetTargetMode*`, `CeGetCurrentInputMode` | Know what the player is placing or aiming | command card | missing | 10 |
| Switch maps in multiplayer | [W3CE#38](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/38) | Change level without leaving the lobby | clock (`restartMatch`), players | missing (the native session owns its levels) | 11 |
| One-team maps online | [W3CE#39](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/39) | Start a map that has a single force | players | planned (the native lobby fills slots from `src/netcode`) | 12 |
| Server-sent sync messages | `CeTriggerRegisterPlayerSyncEvent` with `fromServer` | Messages from the server, not only from players | sync | missing (the relay can send them; the family has no call) | 12 |
| Balance and version sets | Discord (31 October): Reign of Chaos as a balance set | Several rule sets in one build | new: data sets, chosen in the lobby | missing | 13 |
| Hide Warcraft UI parts one by one | [W3CE#49](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/49), `CeHideOriginFrames`, `CeEnableUIAutoPosition`, [W3CE#17](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/17) | Remove portrait texts and side panels without workarounds | frames | covered (`hideWarcraftUi`; a no-op on native, which draws no Warcraft UI) | 14 |
| Unplayable maps listed with their error | [W3CE#60](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/60) | Explain why a map does not start | build tooling, not the API | covered (a missing call fails to compile against the declarations) | 15 |
| Sound from script | [W3CE#58](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/58) (silent on 1.29 to 1.30) | Script sounds play | sound | covered (the native backend plays through its own cpal mixer) | 15 |
| Damage event details | `CeGetEventDamageTypes`, `CeGetEventAttackFlags`, `CeGetEventIsRanged` | Read and change a hit's types | none | not planned (combat lives in the game's TypeScript simulation) | 16 |
| Instance fields | `Ce{Get,Set}{Ability,Item,Unit,UnitWeapon}*Field` | Change one object's data while playing | bodies (`setBodyObjectFields`) | covered for Warcraft setup; game data is plain TypeScript on native | 16 |
| Jass operation limit | [W3CE#36](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/36) | Raise or remove the op limit | none | not needed (Wisp compiles to Lua, which has no op limit, and the native backend runs on Bun) | 17 |
| Lua, WASM and deterministic Lua | Hive features, `war3map.l64` (0.3.0), [W3CE#21](https://github.com/Warcraft-III-Community-Edition/W3CE/issues/21) | Modern scripting with deterministic numbers | the contract | covered (TypeScript to Lua, binary32 helpers, Bun) | 17 |
| Unlocked frame rate and an FPS readout | JAPI; "models animate at your frame rate" (0.3.0) | Draw above the game's tick rate | native window | planned (render thread and present path, native-window-plan.md) | 17 |
| Attack missile model, arc and speed | JAPI | Restyle attack missiles | effects | covered (Smashcraft's projectiles are effects it moves itself) | 17 |
| Selection control | `CeSetWidgetSelectable`, `CeSetUnitLocalSelectable` | Make units unselectable, or unselectable for one player | input (`lockWarcraftControls`) | covered (no selection exists on native) | 17 |
| Depth of field and minimap icons | `CameraSetDepthOfFieldScale`, `CameraSetFocalDistance`, `CreateMinimapIcon*` | Focus blur, and icons on the minimap | view | missing | 18 |

### Proposed boxes for the next families

Each box becomes its own issue in the same shape as G1 and G2: a Wisp module
for each backend, a Smashcraft codemod where one applies, and both backends
green. The lowering rule stays the same. Where Warcraft has no runtime native,
the call lowers at compile time to data the map already carries, such as a
model variant, `war3map.w3e` or object data, or the contract declares it
native-only.

1. **Scenery** (`wisp/game/scenery`). Calls are `placeScenery(model, x, y,
   z, yaw, scale, matrixScale, colour)`, `moveScenery` and `removeScenery`, plus
   a stage's static list, which the native backend draws as one batch.
   Warcraft lowers to effects and owns the scale-for-culling rule.
   Done when: Smashcraft's `host/loop/stageScenery.ts` places its pieces
   through the family, so `rg -o 'wisp/game/effects|\b(AddSpecialEffect|DestroyEffect|BlzSetSpecialEffect\w+)\(' ts/src/host/loop/stageScenery.ts | wc -l`
   prints 0 (20 effect natives today); the normalized bundle diff is empty;
   and editing a scenery list hot-reloads into a running native window
   without restarting the match.
2. **Model instance calls** on effects and bodies: `setModel`,
   `setTexture(index, path)`, `attach(to, point)` and `queueAnimation`.
   Warcraft lowers `attach` to `AddSpecialEffectTarget`, and `setModel` on
   bodies to `BlzSetUnitSkin`. A `setTexture` with literal arguments
   generates a model variant at build time, from the project's own models
   only. Done when: a fixture map swaps a texture and attaches a model on
   both backends, with an offscreen native capture and a Warcraft capture
   showing the same swap, and a `setTexture` with a non-literal path fails
   to compile on the Warcraft backend with a message naming the rule.
3. **Input completion.** Calls are the typed character, relative pointer
   motion, the cursor icon and cage, the frame under the pointer, and a
   world-to-screen and screen-to-world pair in view. Done when: Smashcraft's
   character select takes the hovered roster tile from the family's
   frame-under-pointer call instead of `tileAt`; a headless Bun test drives
   each call; and the four-client playable journey shows no divergence.
4. **World** (`wisp/game/world`). Calls are terrain height, tile, cliff
   level and playable bounds, with run-time setters on native. On Warcraft,
   the build-time form lowers into `war3map.w3e` through `terrainAuthor`,
   tiles and deformation lower to natives, and run-time cliffs and bounds
   are declared native-only. Done when: a fixture map edits a cliff in its
   source and the running native window shows it after hot reload; the
   Warcraft build of the same source carries the cliff in `war3map.w3e`;
   and calling a native-only setter in the Warcraft build fails to compile.
5. **glTF models at build time.** An effect or body may name a `.glb`
   file. The native renderer loads it directly, and the Warcraft build
   converts it to MDX into the map archive, so Tom's Quaternius library
   (game-design-prototyping) works on both backends. Done when: a fixture
   map shows one Quaternius `.glb` model animating on both backends, the
   Warcraft map archive contains the converted MDX, and the converter
   carries its licence in docs/references.md.

## Mods (later)

Not planned yet (Tom, 31 October 2026); no boxes.

- **Model swaps.** A replacement model works only when it keeps the
  skeleton and sequence names of the model it replaces, as HD remakes of
  the same Classic units do (for example LongbowMan's Warcraft 3 Classic
  HD). Smashcraft authors its own fighter motion on Classic bones, so an HD
  fighter model must match those bones. Art overrides are client-local and
  cosmetic: the sim never reads them, so players with different art stay in
  sync. Wisp would redistribute no pack.
- **Fighter and stage mods** with their own animations wait until the
  roster ships. Before online play they need content-hash matching, the way
  a match already refuses a joiner whose map hash differs
  (`host/play/standalone.ts:283`, `host/net/peer.ts:206`).
- **Smoothed animation, as of today.** Keyframes are interpolated:
  `Track::vector` (`window/wisp-window/src/model/track.rs:75`) blends
  linear, Hermite and Bezier keys, `Track::quaternion` (line 94) slerps
  rotations, and node poses use both (`model/pose.rs:110`). Ticks are not:
  the window draws each 60 Hz scene as it arrived, and a display frame with
  no new tick redraws the last one (`window/wisp-window/src/frame.rs:408`).
  Blending between ticks is the unlanded `wisp-109-motion` lane under
  wisp#109.

## Rejected

- **A runtime wrapper library such as w3ts** (MIT; object classes over
  handles). Each call is a method dispatch on a wrapper object, and each handle
  is a table allocation. That is the per-call Lua cost that the zero budget
  forbids, and it keeps Warcraft's shape.
- **Keep emulating natives and only rename them.** The native engine would
  still implement Blizzard's semantics, so it removes none of the three costs
  under "Why".
- **One big codemod of every family.** A failure in one family would block
  all of them, and the byte-identical diff would be too large to read.
- **Ambient global declarations with `@customName`.** They are free in Lua,
  but they make the contract a set of globals that every file sees. No module
  boundary and no structure gate can hold it.

## Survey

The count above comes from this script, run with the native names from
`src/natives/warcraft.d.ts`
(`grep -oE '^declare function [A-Za-z0-9_]+' src/natives/warcraft.d.ts | awk '{print $3}' | sort -u > natives.txt`).
Families are matched in the order listed (revised after the review to split
events out and move three natives to their owners), so a sync event's player
registration counts under sync, not players:

```ts
const families: [string, RegExp][] = [
  ["sync messages", /Sync/],
  ["events", /^(CreateTrigger|DestroyTrigger|TriggerAddAction)$/],
  ["input", /Key|Mouse|BlzIsLocalClientActive|ChatEvent|ChatString|BlzEnableSelections|EnableUserControl|BlzEnableCursor/],
  ["UI frames", /Frame|TOCFile|^BlzGetLocalClient(Width|Height)$|DisplayText|DisplayTimedText|ClearTextMessages|BJDebugMsg|Quest|BlzConvertColor/],
  ["effects", /SpecialEffect|^DestroyEffect$|Lightning|TextTag/],
  ["sound", /Sound|Music|VolumeGroup/],
  ["camera and world look", /Camera|Fog|Sky|Terrain|DayNight|TimeOfDay|CineFilter|Shadow/],
  ["timers and frame loop", /Timer|GameSpeed|RestartGame|SetMapFlag/],
  ["units and positions", /Unit|Location|Rect|BlzSetAbilityTooltip/],
  ["players", /Player/],
  ["strings and math", /^(I2S|R2S|R2SW|S2I|S2R|I2R|R2I|StringLength|SubString)$/],
  ["files", /Preload/],
  ["handle ids", /^GetHandleId$/],
];
// For each ts file under the root, each match of /(?<![\w.$])([A-Za-z_]\w*)\s*\(/g
// whose name is a declared native counts one site in the first family that matches it.
```

## Review

One fresh reviewer (Sonnet, read-only) tried to break the first draft on 31
October 2026. Each finding and its answer:

1. **The byte-identical Lua diff could not pass.** The source stamp hashes
   every `ts/src` file, `throw` sites carry `file:line`, and `war3map.lua` was
   the wrong file. Answer: the diff is of the compiled bundle
   `build/playable.lua`. It masks exactly those two fields with a stated
   `sed`, and the pin update lands alone before the codemod, so Wisp's
   runtime is the same on both sides.
2. **The Done-when regexes missed most sites** (`rg -w` with a trailing `(`
   matched 4 of 620 lines), and three natives had no owner. Answer: each
   check now lists its family's natives exactly, generated from the survey,
   with a leading `\b`. It is verified to print 623 and 765 sites today.
   `BJDebugMsg` and `BlzConvertColor` are frames', `BlzSetAbilityTooltip`
   is bodies', and `BlzEnableCursor` is input's alone.
3. **`onFrameEvent` was not today's call pattern.** Frames share one trigger
   and dispatch on `GetHandleId`. Answer: there is no composite. A new
   events module (`createEvents`, `onEvents`, `destroyEvents`) takes the
   trigger natives from the clock family, each family adds its sources to an
   events value, and `frameId` lowers to `GetHandleId`. `onFrame` was dropped
   for the same reason (the tick timer is kept and reused).
4. **structure.toml could not hold the stores.** They import headless
   internals, and headless and host need `game`. Answer: the helpers move with
   the stores, headless, host and plugins gain `game`, `copyBlend` is
   shared, beams and text tags move in G1, and text's owner is
   `src/game/native/text.ts`.
5. **"The current world" had no mechanism `game` could import,** and the
   stores must also compile to Lua32. Answer: `src/game/native/world.ts`
   holds the bound world, and its hosts bind it. The stores are plain
   TypeScript under the number rules, so the same code runs in both runtimes.
6. **Parity logs and `localNatives` were unscoped,** and the soak ledger
   uses natives as values. Answer: the native backend logs its row's native
   name and arguments under headless, so `callHash.ts` and every
   `localNatives` list stay as they are. `platform/soakHandles.ts` stays on
   raw natives by rule.
7. **Cross-family handles broke one family at a time,** and the mouse event
   natives were missing. Answer: Wisp handle types alias Warcraft's until
   step 6, so mixed raw and migrated code needs no conversion call.
   `BlzGetTriggerPlayerMouseX/Y` are in input.
8. **The Review section was empty.** Answer: this section.

The reviewer confirmed these claims as they stood:

- the survey's 225 natives at 2,206 sites;
- `perf compare --threshold 0`, which passes an equal run;
- `wisp play --standalone --window native`, `playable-human-four` and the
  native window plan's labels;
- that Smashcraft's sim reads no native, and the line citations.

Writing boxes G3 to G8 against Smashcraft's call sites and G1's lowering format
corrected the first draft of the families:

- `isHuman(slot)`, `worldOrigin`, `placeBody`, `holdGameSpeed`,
  `pointerPosition`, `setBodyObjectFields` and `writeFile(path, lines)` could
  not lower byte for byte. Each needed a local, two statements, an allocation
  or a repeated argument. They became one call per native.
- G1 has no constants and no nested or global template arguments. G4a adds the
  arguments, and G8a adds the constants.
- `bun wisp headless desync` is not the divergence check, because that journey
  plants a desync on purpose, and no perf run checks divergence today, so G4a
  adds the check to `perfLua.ts`.
- Value uses of natives were three files, not one.

On clean-room, the reviewer noted that the lowering table is a new kind of
file. Its rule is above, and G1 records it in clean-room.md.
