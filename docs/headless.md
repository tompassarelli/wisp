# Headless runtime

Most questions about a map's code don't need the signed-in Warcraft clients.
The headless runtime runs the map in N simulated clients in this process, in
lockstep, with every Warcraft native the map can call emulated per client. It
answers in about a second whether the clients stay synchronized through a
journey, what errors the map reported, whether a hot reload ran in every
client and what a player would see wrong in the scene the map draws. With
[input from another program](#input-from-another-program) the clients also
run in real time, typed into and read by a game's own input helper.

It runs the map two ways, from one plain TypeScript implementation
(wisp:src/headless/):

- **Bun** runs the map's TypeScript modules (wisp:scripts/wisp/headless.ts).
  Tests and `wisp headless` use it.
- **32-bit Lua** runs the map's compiled bundle, each client in its own Lua
  environment (wisp:src/headless/lua.ts). The runtime itself is compiled with
  TypeScriptToLua beside the journey.

A game declares what is its own: which natives its code calls on one client
only, the prefixes of its globals, its journeys and, for scene checks, its
[scene expectations](player-view.md#expectations).

## What a simulated client emulates

Each client has its own handles, units, timers, triggers, files and special
effects, and logs every native call except the local-only ones.

| Natives | Emulation |
| --- | --- |
| Players | Player N is the number N. The journey's player slots are playing humans with a client each; every other slot is empty. `GetLocalPlayer` is the client's slot. |
| Timers | 60 frames a second over Warcraft's timer clock: binary32 deadlines whose sums round toward zero. A frame runs every callback due by its end, earliest deadline first and equal deadlines in `TimerStart` order, so a period shorter than a frame fires several times in it (1/1024 s: 17 or 18). A period is at least 0.0001 s (a zero period: 10,002 times in the first second) and a one-shot timeout at least 1/1024 s. A timer started inside a callback is timed from its deadline and fires in the same frame when due. Inside a callback, timers read its deadline as the game time; a periodic timer's elapsed time restarts each period, an expired one reads its timeout and a paused one keeps its value. [Rules](warsmash-notes.md#timers-and-frame-stepping). |
| Triggers | Sync, chat, key and frame events, registered per player or frame. A chat line matches its registered text exactly or as a substring, as registered. |
| Sync messages | `BlzSendSyncData` reaches every client, including the sender, in send order, after the frame or event that sent it and before the next, its data cut to 255 characters as Warcraft 3.0.1 cuts it. Warcraft delivers it some frames later; a [delivery](network-model.md) gives the measured latency. |
| Files | `Preload` writes files the test reads from `client.files`. `Preloader` reads files the host published (`publish`, `reload`), or another program wrote in a client's [CustomMapData folder](#input-from-another-program), one chunk per FileIO tooltip level, and keeps the first content it read from a path, as Warcraft does. |
| Units | Position, type, move speed and attack cooldown. |
| Special effects | Model, position, alpha, scale, time scale and a flattened matrix, as `client.effectPoses()` returns them. `AddSpecialEffect` puts an effect on the ground at height 0. |
| Frames | Created frames keep their type, parent, text, visibility, enabled state, level, text limit, size and absolute points; `BlzFrameIsVisible` is false under a hidden parent, and once a frame has a text limit `BlzFrameSetText` keeps that many characters (no limit reads -256); `client.frames.shownText()` lists the text a player sees (frames shown with every parent). A frame getter returns the same handle for the same frame; `BlzFrameGetChildrenCount` and `BlzFrameGetChild` see the map's own frames under a parent, in creation order, not Warcraft's. The local client is 1920 pixels wide plus 640 per client index, 1080 high. |
| Conversions and math | `I2S`, `R2S`, `R2SW`, `R2I`, `I2R`, `S2I`, `S2R`, `SubString`, `StringLength`, `SquareRoot`, `Atan2` and the bit operations, binary32 where Warcraft is. `R2S` and `R2SW` round exact ties away from zero, and only `S2I` skips leading spaces, as Warcraft 3.0.1 does, the same in Bun and Lua ([script rules](warsmash-notes.md#script-rules-outside-the-six-families)). |
| Messages | `DisplayTextToPlayer` for the local player and `DisplayTextToForce` show text in `client.messages`; Wisp's error reports go to `client.errors` as `error in HANDLER: ...` when the map writes them to its error file, shown or not ([error text](hot-reload.md#error-reports-on-screen)). |

An unmodeled declared native fails the journey. Each client records its first
call with the native name, client slot and frame, including local-only calls.
The runtime continues with the declared type's default so the report can name
all missing behavior; equal defaults and equal checksums cannot make it pass.
Each `Convert` native returns its argument. Constants of a handle type are their own name, so
comparisons with them work; global variables such as
`bj_mapInitialPlayableArea` are handles. A game supplies `natives` for one its
code needs answered otherwise. The declarations come from
wisp:src/natives/warcraft.d.ts.

### Intentional no-ops

For behavior a particular journey deliberately ignores, declare exact native
names and a concrete reason in `HeadlessMap` or `LuaHeadlessMap`:

```ts
intentionalNoops: {
  StopMusic: "this logic journey has no music playback",
}
```

These calls retain their declared defaults and synchronized call logging.
Empty reasons and undeclared names (including wildcards) are rejected.
`localNatives` only controls synchronization logging; it does not suppress
missing-native failures. A function supplied through `natives` counts as
modeled in both runtimes. Prefer supplied behavior when the return value
matters, as the sample declares its playable rectangle's center at zero.

## Synchronized and local-only calls

Clients that took the same events must make the same native calls in the
same order. `firstDivergence()` names the first call where two clients'
logs differ, with the calls around it. Handles compare by kind and number,
callbacks all compare equal, numbers by value. `checksum()` hashes a client's
log; equal logs hash alike in Bun and Lua.

A native a client may call when the others don't is local-only and is not
logged. Wisp declares the ones its own runtime calls that way
(`WISP_LOCAL_NATIVES`, wisp:src/headless/client.ts): the local player, sync
sends, Preload files and FileIO tooltips, local messages, timer reads and the
scene report's position getters. A game declares the rest with why each keeps
the clients synchronized, such as its local UI and input polling:

```ts
export const MAP: HeadlessMap = {
  filePrefix: "mygame",
  globalPrefixes: ["__mygame"],
  localNatives: { BlzFrameSetText: "changes an existing frame's text on this client" },
};
```

## Hot reload

`reload()` publishes the map's modules as the next version, as `wisp hot` does
([what a reload sends](hot-reload.md#what-a-reload-sends)): the host marker,
payload files, then the manifest, in every client's CustomMapData, with a delta
from the previous version when every client acknowledged it.
`reload(modules)` publishes another module set, such as a later compile's;
wisp:test/modules.test.ts plays full and incremental reloads that way, and
`client.preloadedFiles()` shows which payload each client read. `start()` has already put the marker there, as `wisp fresh` does
before a match, so the map's own reloader finds the manifest on its next poll;
`start({ hostFolder: false })` simulates clients no host has touched, which
look for files only twice a second until `prepareHostFolder()` or `reload()`
publishes the marker ([what polling costs](hot-reload.md#what-polling-costs)).
`client.missedLookups` counts a client's Preloader lookups of files nobody
published, each a folder read under Wine. The clients answer through sync
messages, and every client installs it on the same frame. `unappliedReloads()`
names each client whose acknowledgement file doesn't show the latest version,
with its "not applied" message. In Lua the map's modules are its compiled
bundle as one module; in Bun they are one module whose text names the entry,
which the emulated `load` returns. `runtime.modules(entry)` is the module set
that installs another entry, so `reload(runtime.modules(entry))` moves the
clients to it, such as the map imported from a copy of its sources with other
values ([live tuning](tune.md#headless)).

## Journeys

A journey is data, so one declaration runs in Bun and Lua: the frames the
match runs after start, and events after a number of frames.

```ts
export const JOURNEY: Journey = {
  frames: 120,
  events: [
    { frame: 30, player: 0, chat: "-ping" },
    { frame: 60, reload: true },
    { frame: 90, player: 1, key: 0x54, meta: 2 },
  ],
};
```

A key event is a press and a release with its modifiers (2 is Ctrl).
`runJourney` starts the map in every client, plays the events and returns each
client's call count, checksum and error reports, the first divergence and any
reload not running.

## Typing and clicks

`Lockstep.type(player, text)` is a player's keyboard typing: into the
`EDITBOX` frame that has their keyboard (BlzFrameSetFocus) while they see it,
on their client only and up to its text limit if it has one, as Warcraft drops the rest;
without one, each letter, digit or space is a key press and release every
client sees (a capital adds Shift). `Lockstep.click(player, x, y)` clicks at
Warcraft's UI coordinates (0.8 by 0.6 over the 4:3 area): the highest-level
shown, enabled frame there with a click event, placed by its absolute points
and size, takes the keyboard, and every client runs its click event with the
clicker. It returns false when no frame there takes clicks.

## Input from another program

A game's input helper, such as one that reads controllers, types into
Warcraft and reads the files the map writes. wisp:scripts/wisp/headlessInput.ts
lets the same program drive headless clients:

- `customMapData(directory)` is a client's CustomMapData as a real folder:
  each file the map writes is written there when the map writes it, byte for
  byte as Warcraft writes Preload files, and Preloader reads the FileIO chunks
  (`call BlzSetAbilityTooltip('$wsl', "CHUNK", LEVEL)` lines) of files the
  program writes there. Pass it as `files` when making the clients.
- `typedFile(path)` reads what the program appends to `path`: each line is one
  typing of its text.
- `RealtimeClients` runs the clients at 60 frames a second of wall time.
  Before each frame, each player's typed lines reach their client through
  `type`. `hold(slot)` is a stopped game: no client runs a frame, as in a
  lockstep game, and the text typed for it waits; after `release` frames go on
  without catching up the held time. `advance()` runs the frames due and
  returns the milliseconds until the next, for the host's loop; a hook given
  after the clock runs after every frame, as the [soak's detectors](soak.md#through-a-games-own-input-helper) do.

```ts
const clients = installHeadless(MAP).clients(entry, [0, 1], {
  files: (slot) => customMapData(dataFolder(slot)),
  // Warcraft's measured sync-message latency (wisp:docs/network-model.md).
  delivery: syncDelivery(),
  keepCalls: 64,
});
const realtime = new RealtimeClients(clients, new Map([[0, typedFile("typed-0.txt")], [1, typedFile("typed-1.txt")]]));
realtime.start();
// The host's loop: run what is due, sleep until the next frame.
```

A long run keeps every native call unless the clients are made with
`keepCalls`: then they compare their calls after every frame and keep only
the last `keepCalls` of each, for a later desync's context; the first desync
is kept with the frame it was found after, and the checksum and
`callCount()` still cover every call. Without it, Smashcraft's two-client
match grew the process by about 10 MB a second, measured on its development
build.

With `cost`, a clock such as process CPU milliseconds, `clients.costs` holds
what each client's last frame took: its arriving messages and its callbacks.

## In Bun tests

```ts
import { afterAll } from "bun:test";
import { installHeadless } from "wisp/scripts/wisp/headless";
import { runJourney } from "wisp/src/headless/journey";
import { install, start } from "../src/main";

const headless = installHeadless(MAP);
afterAll(headless.restore);

const clients = headless.clients({ start, install }, [0, 1]);
const result = runJourney(clients, JOURNEY);
```

`installHeadless` makes every declared native, constant and global variable a
global of the process that reads the running client's; call it once per test
file and restore after. A test can also drive the `Lockstep` directly:
`start()`, `frames(n)`, `chat(player, text)`, `press(player, key, meta)`,
`reload()`, and `everywhere(body)` to run code, such as an `install()`, in every
client on one frame. `client.run(body)` runs code in one client.

`client.key(player, key, modifiers, down)` delivers that player's key event.
For the player's own client it also updates the held state read by
`BlzIsKeyPressed`, even if no trigger registered the key. Other clients receive
the event without acquiring the local held key. A press and release entirely
between callbacks leaves polling neutral, as in Warcraft; hold across a frame
when testing callback polling.

The map's modules load once for every client. While a client runs, each
global whose name starts with one of the game's prefixes, or `__wisp`, is that
client's; module locals are shared. Map state that must survive a reload is
already in globals; keep all synchronized state there. The runtime learns a
global's name when it is first assigned, so create one by assignment, not
with `Object.defineProperty`; from then on it reads and writes the running
client's value, and assigning it outside a client throws. A global that
exists when the runtime is installed is every client's starting value. Lua's `xpcall`,
`pcall`, `load`, `setmetatable` and `string.byte`, which Wisp's runtime calls,
are emulated, and a thrown error's JavaScript stack, with TypeScript lines, is
kept in `client.thrown`.

## In 32-bit Lua

Compile a Lua entry that calls `runLuaJourney(map, journey, bundlePath,
declarationsPath)` with a tsconfig like wisp:examples/sample/tsconfig.headless.json
(the warcraft-numbers plugin, lua-types and a bundle), compile the map's bundle,
and run the entry with both paths:

```sh
lua build/headless/headless.lua build/map.lua node_modules/wisp/src/natives/warcraft.d.ts
```

It prints each client's call count and checksum, then each problem, and
returns how many problems it found; the sample's entry exits 1 on any. Each client loads the bundle into its own environment
over Lua's globals, so clients share nothing, and the bundle's module scope
runs once per client and once per reload. wisp:examples/sample/test/headless.test.ts
requires the Lua run to print exactly what the Bun run does.

`runLuaPerf(map, journey, bundlePath, declarationsPath)` plays the journey the
same way and measures each client's frames: Lua instructions, Lua time and
native calls ([frame cost](frame-cost.md#headless)).

### Raw float rounding

Warcraft's Lua numbers are binary32, and its raw float `+`, `-`, `*` and
`/`, and its decimal numerals, don't always round to nearest as Bun and a
stock Lua32 do. In Smashcraft
0.0.48 a product was the exact result truncated toward zero, and the native
moments diverged from their headless replay from that ulp on
(smashcraft#59). In Smashcraft's 7 October native
match a camera quotient was an ulp above the nearest, and the numeral
`0.016666667` read as the binary32 below the nearest. Toward zero is the
nearest model found, not the exact rule: a Lua rounding so replayed one of
five native moments exactly. Code that
must equal the host uses Wisp's exact helpers and `f32()`, which the
compiler emits as exact operations, and the compiler prints every
non-integer literal as an exact hexadecimal float.

wisp:native/toward-zero.h makes a LUA_32BITS Lua 5.3.6 round its raw float
`+ - * /` and its decimal numerals toward zero.
`bun node_modules/wisp/scripts/wisp/lua32.ts toward-zero` prints its path,
and `bun node_modules/wisp/scripts/wisp/lua32.ts` the stock Lua32's; each is
built on first use from lua.org's release tarball, committed at
wisp:vendor/lua-5.3.6.tar.gz and checksummed before each build, with gcc and
make (or `nix` when they are missing) and no network, into a per-user cache,
`~/.cache/wisp/lua32/KEY/lua`, keyed by the source checksum and flags. A lock
lets parallel worktrees share one build. `lua32(variant)` does the same in a
host program, and `luaRounding(lua)` tells which rounding a Lua has. Wisp's
`bun test` sets `LUA` and `TOWARD_ZERO_LUA` to these when they are unset
(wisp:test/lua32.preload.ts), and the CI template does the same.

Run a game's Lua replays and numeric checks in both a stock Lua32 and this
one: results that agree rely on no raw float `+ - * /` and no inexact
numeral, whatever Warcraft's exact rule is; a difference names an operation that leaked past the exact
helpers. wisp:test/toward-zero.test.ts holds the build to an exact integer
oracle. Wisp's binary32 helpers make infinity by overflowing a product,
which rounds to the largest finite value toward zero, so their infinity and
NaN edge cases differ in this Lua.

## `wisp headless`

A project adds the command to its program with `makeHeadless`
(wisp:scripts/wisp/commands/headless.ts), naming its map, its entry module's
path, its journeys and, when that entry starts the scene recorder, its scene
expectations:

```ts
headless: {
  usage: "[JOURNEY] [--clients N]",
  load: async () => (await import("wisp/scripts/wisp/commands/headless")).makeHeadless(async () => ({
    map: MAP, entry: join(sourceDirectory, "main.ts"), journeys: { "quick-match": JOURNEY }, scene: SCENE,
  })),
},
```

`headless [JOURNEY] [--clients N] [--step N] [--runs N] [--cost]` plays the named journey, or the first, in
N clients (2 by default, at most 4, the slots Wisp's per-player files cover)
and prints each client's calls and checksum, the first desync, a reload not
running, each client's error report file and thrown stack, and each client's
latest scene report with what a player would see wrong. It exits 1 when it
printed a problem. With `--cost` and the game's perf program (`makeHeadless(load,
perf)`), it then plays the journey in 32-bit Lua and prints each client's
predicted native cost per frame ([frame cost](frame-cost.md#predicted-native-cost)).
The entry module loads when the command runs, so the
project's host type check never reads map code.

### Scripted driver and fast-forward

Under [M1](https://github.com/tompassarelli/wisp/issues/75), the supported
replacement for #38's offline native driver and #39's native fast-forward is
`headless`. Journey key events go straight into the running map's registered
callbacks; chat events invoke its registered map handler directly. Neither
uses an OS keyboard, a chat window, a lobby, or a Warcraft process.
`--journey FILE.json` accepts a game's scripted journey, including held-key
events with `down: true` and `down: false`.

`--step N` advances at most N simulation frames per call, preserving every
input and observation frame. Without it, the driver advances straight to the
next event. Both modes run without waiting for wall time or drawing frames.
For interactive stepping, `Lockstep.start()`, `key()`, and `frames(N)` give
the same control: between calls the simulation is paused. `RealtimeClients`
is the separate real-time adapter for a live input helper.

`--runs N` creates fresh clients for each start, compares their call counts
and checksums with the first run, and stops at the first failed run. JSON
mode emits one result per run plus a `benchmark` record with `runs`,
`requestedRuns`, total `frames`, failed-run count, `elapsedMs`, `cpuMs`, and
`speedMultiple` (simulated seconds divided by wall seconds). CPU is for the
whole Wisp process, including all simulated clients; it is not native-client
CPU. Rendering captures use one run.

The sample map supplies a runnable command from the Wisp checkout:

```sh
bun examples/sample/scripts/sample.ts headless ping-reload --step 1 --runs 50 --json
bun examples/sample/scripts/sample.ts headless ping-reload --runs 20 --json
```

Compare the result clients' checksums between those commands to check stepped
and normal execution. These are Wisp determinism and setup measurements.
Warcraft now supplies fidelity reference captures, replayed through the
consumer's `parity corpus`; [timer rules](warsmash-notes.md#timers-and-frame-stepping)
and [network timing](network-model.md) describe the current references.
This driver does not measure Warcraft's engine loop or native LAN protocol.
The legacy `engine drive` vocabulary entry describes an opted-in native map
bridge, not this command. Native process writes or traps remain restricted
to verifiably offline loopback clients; M1 checks do not require them.

### Rendered frames and sound cues

`wisp headless [JOURNEY] --render PRIVATE_DIR --frames 64 132 206` writes
`p0-frame-64.png` (and one image per requested frame and client), the captured
scene JSON, and `render.json` naming the GPU and counts of models and textures.
Frame numbers are headless client frames after that frame's journey events.
`--journey FILE.json` replaces the named journey with `{ frames, events }`;
key events may include `down: true` and a later `down: false` to hold a key.

The map supplies `HeadlessProject.render.readAsset(path)`, returning the actual
imported or stock asset bytes, or `undefined` when absent. Keep these assets and
the output outside public repositories. MDX and MDL models, BLP1, TGA and PNG
textures are supported; a resolver can return decoded PNG bytes for a stock
BLP path backed by DDS or BLP2. Missing visible assets fail the render. The
Maps drawing units also supply `render.unitModels`, mapping object type IDs to
their model paths; a visible unit without a mapping fails the render. The
optional `width` and `height` default to 1280×720; `chrome` or `CHROME` selects
Chrome, otherwise `google-chrome-stable` is used. Chrome runs privately in
headless mode, with the GPU's ANGLE OpenGL backend, falling back to SwiftShader
only if GPU initialization fails. No Warcraft client is opened.
The renderer draws the map's sky model first, centred on the camera's eye with
a far plane beyond any sky model, then clears depth, so the stage draws over it
("Lighting, fog and sky" below). On Smashcraft's Durotar near camera
(Warcraft III 3.0.1.24342, Reforged) the drawn horizon sits 12 rows of 720
above the native capture's.

The renderer uses the declared MIT `war3-model` 4.0.1 package with the HD
sampling precision fix recorded in `vendor/README.md`,
Copyright 2017–2023 4eb0da; its package retains the license. Wisp calls its
public model/texture parsers and `ModelRenderer` API, and sets its frame,
global-sequence clocks and node poses directly. Positions, model scales,
animation times, rotations, camera fields and visible frame art come from the
map's native calls. Particle and ribbon clocks advance to the captured time.
Sequence selection, loop ends, Birth before Stand, blending and global
sequences follow Warcraft's playback rules in wisp:src/headless/animation.ts,
listed in [Animation playback](warsmash-notes.md#animation-playback); the
headless runtime keeps each unit's and effect's clock, seek and blend.
This is a scene renderer for look checks, not pixel-identical Warcraft shading.

Every sound/music start, stop and playing-volume change is printed with its
client, frame, source or label, loop flag, volume and effective volume.
`--sound-cues FILE.json` writes the complete event log;
`--json` emits each playback change as a `type: "sound"` row. See
[Audio events](audio.md) for event meanings, music mute and the exact
`bun wisp headless audio-acceptance` and game acceptance commands. A map test can call
`assertSoundCue(client.soundLog, { label: "LABEL", frame: 64, count: 1 })`
from `wisp/src/headless/client`. Creating a sound without starting it fails a
"plays the cue" assertion. This checks the game's calls, not audibility.

A sound handle has one voice: `StartSound` on a handle that is still playing
neither restarts it nor logs a cue; `StopSound` then `StartSound` restarts it.
Pitch and position are stored as binary32, as Warcraft's `real` arguments are
([rules](warsmash-notes.md#sound-start-stop-and-channel-limits)).

`KillSoundWhenDone` drops an idle sound's retained state immediately. Playing
sounds retain it until their `SetSoundDuration` milliseconds have elapsed at
the current pitch; a loop waits for `StopSound`. Stopping with `killWhenDone`
also releases the state. Duration starts at zero when no duration was supplied,
because the cue-only emulator does not decode sound assets. This models release
of declared playback and preserves the event log. Music playback, stop,
loop mode and map gain (including zero) are recorded from the actual calls;
audible mixing and fade envelopes use Warcraft references.

### Lighting, fog and sky

The renderer draws each frame in the light the map last set. The headless
client records `SetSkyModel`, `BlzShowSkyBox`, `BlzShowTerrain`,
`SetDayNightModels`, `SetTimeOfDay`, `SetTerrainFogEx`, `SetTerrainFogExV`,
the `BlzSetTerrainFog*` setters and `ResetTerrainFog`, and `captureScene`
saves them as the scene's `environment`.

- **Day/night light.** The unit day/night model's first directional light,
  sampled at the time of day: its one sequence spans the day from midnight.
  Its key colour times intensity, its ambient colour times ambient intensity,
  and its direction (the light node's rotation applied to +Z, toward the
  light) light every model. Classic (SD) materials take Warcraft's
  fixed-function rule, texture × clamp(ambient + key × max(N·L, 0)). HD
  materials take the same key and ambient in their PBR shader, without the
  upstream tone mapping. Layers flagged Unshaded take no light. Lights are
  parsed from the whole file, including the 1200, 1300 and 1600 light fields.
  The headless clock does not advance the time of day. Before the map sets
  day/night models, models draw unlit, as before.
- **Fog.** Linear fog by eye depth from `zStart` to `zEnd` in the fog colour.
  A height fog (style 3) draws its linear range, `linearStart` to
  `linearEnd`, capped at its maximum linear density; the height falloff is
  not drawn. Additive layers fade to black, and Unfogged layers skip fog.
  Exponential styles are drawn as linear.
- **Sky.** The sky model around the eye, behind everything else, unlit, and
  fogged only when the fog draws over the sky. `BlzShowSkyBox(false)` hides it.
- **Far cull.** A model whose origin lies farther from the eye than the
  camera's `FARZ` is not drawn, even where part of it reaches nearer. At
  Smashcraft's `FARZ` 8000, native captures show neither Nordrassil's World
  Tree (origin 8054 from the eye) nor the Frozen Throne landmark (8049-9300).
- **Cinematic filter.** The client records the `SetCineFilter*` setters and
  `DisplayCineFilter`, and `captureScene` saves the filter showing at that
  frame as the scene's `filter`: its texture tinted by the start colour moved
  toward the end colour by the elapsed share of its duration. It draws over
  the world and under the UI in its blend mode; `BLEND_MODE_MODULATE_2X` is
  twice the scene times the filter. Smashcraft's KO flash (#289, a white mask
  at grey 185-255) on Classic, 8 Oct, frames 300-367: the headless curve
  tracks the native one frame for frame, the flash on at KO, its peak at
  KO+1 and off at KO+37; at grey 185 native lifts the scene 1.42 times and
  headless 1.41.
- **Not drawn.** Terrain, shadows, point lights from models, bloom and other
  post-processing.

| Check | Can close headless when | Still needs native |
| --- | --- | --- |
| A strike's model and pose on its first active frame | The same input replay and frame have a matched native comparison for that fighter/clip | Warcraft animation blending or a newly unsupported clip |
| A spell, projectile or passive pip is present and follows the declared state | Its models/textures or UI frames render and the declared look check matches native | Unsupported emitter behavior, lighting, occlusion or shader appearance |
| The game starts a named sound cue | The frame-stamped cue log passes the expected label/source/count assertion | Volume as heard, mixing, device output, automatic engine/model event sounds |
| Timing, input latency, frame cost and native desync | — | Always native |

Keep native and headless frames tied to the same map inputs, camera, replay
and match frame. A keyboard journey is not an analog pad replay. Consumers
with an existing headless pad path can call `captureScene(client)` at that
path's recorded match frame and `renderScenes(render, scenes, PRIVATE_DIR)`
after the run; no new input simulator is required.

## Unit states

The Bun and emitted Lua runtimes retain a unit's owner and facing, and model
`GetOwningPlayer`, `GetUnitFacing`, `SetUnitFacing`, `BlzSetUnitFacingEx`,
life and mana through `GetUnitState`/`SetUnitState`, `GetWidgetLife`/
`SetWidgetLife`, `BlzGetUnitMaxHP`/`BlzSetUnitMaxHP`,
`BlzGetUnitMaxMana`/`BlzSetUnitMaxMana`, `KillUnit`, and `RemoveUnit`, as
Warcraft 3.0.1 does ([Warsmash notes](warsmash-notes.md#native-results-for-44)):

- Life and mana writes apply a binary32 change from the current value; halfway
  changes round toward zero. A resulting life of binary32 0.405 or below kills
  a living unit and leaves life 0. A dead unit takes life writes and stays dead.
  `KillUnit` leaves life 0. Life doesn't regenerate.
- `SetUnitState` ignores maximum life and mana writes; `BlzSetUnitMaxHP` and
  `BlzSetUnitMaxMana` set them.
- `RemoveUnit` takes the unit out of the world and the rendered poses at once.
  Its handle keeps its type, life and mana, and takes life writes, until the
  frame ends; then its type ID and life read 0.

Declare initial object-data values in `unitStates`, keyed by numeric unit
type ID, on the map passed to `installHeadless` or `luaLockstep`:

```ts
unitStates: {
  [0x68666f6f]: { life: 100, maxLife: 100, mana: 80, maxMana: 80 },
},
```

These are fixture values, not guessed defaults for the stock footman. For a
native comparison, establish the same values with `BlzSetUnitMaxHP`,
`BlzSetUnitMaxMana`, `SetWidgetLife`, and `SetUnitState(UNIT_STATE_MANA)`
immediately after creation. Without a fixture, set each field before reading
it; a missing field throws an error naming the unit type and field.

`test/unit-states/cases.ts` authors the cases shared by Bun, Lua32 and the
native map. Twelve cover owner, facing, life, mana, both maximums, the exactly
representable life values 0.40625 and 0.3984375 around the death cutoff,
killing, two writes after death, and removal; 3.0.1 wrote all twelve on 8
October 2026, and `EXPECTED` holds its rows. The rows after them pin the
cutoff, low writes to a corpse, the exact facing read, exact life and mana
reads, life after a new maximum, and when a removed unit's handle empties. All
24 rows match the 8 October native capture in Bun and Lua32. The two-client
journey took 14.3 ms in Bun; its injected different life write is reported by the
existing call comparison.

Run the shared cases and build their native measurement map:

```sh
bun test test/headless-unit-states.test.ts
bun test/unit-states/build.ts BASE.w3m PRIVATE_OUT.w3x
```

The native map writes `unit-states-p0.txt` and `unit-states-p1.txt` to
CustomMapData 1.3125 game seconds after start. Each named row contains
integers equal to the observed values multiplied by 128 and wrapped to 32 bits
as Warcraft's Lua integers wrap, so a unit type ID reads 859289472 for
`hfoo`; `facing-writes-exact` gives the facing exactly as `MpE`. Compare the
rows with the `EXPECTED` list in the test.

### Unit position and facing

Unit coordinates and fly height are stored as binary32 when set; reads in
the same callback see the write. Facing is kept as 3.0.1 keeps it: in radians
with products rounded toward zero, wrapped by its own rule, so 180 reads
179.99998 and 360 reads 359.99997. An effect attached to a unit reads 0, 0
from the local position getters, as on 3.0.1. `test/unit-motion57/cases.ts`
authors the cases shared by Bun, Lua32 and a native measurement map, with
bodies set up as Smashcraft's fighter bodies are (pathing off, Crow Form,
Locust, paused): position, height, 43 exact facing reads
(`facing-ex-exact-*` after `BlzSetUnitFacingEx`, `facing-created-exact-*`
after `CreateUnit`) and a dash. All 49 rows equal the 3.0.1 capture. The
rules and their evidence are in
[Warsmash notes](warsmash-notes.md#unit-position-and-facing).

```sh
bun test test/headless-unit-motion.test.ts
bun test/unit-motion57/build.ts BASE.w3m PRIVATE_OUT.w3x
```

The native map writes `unit-motion-p0.txt` and `unit-motion-p1.txt` to
CustomMapData about 1.8 game seconds after start. Most rows are ×128
integers; an `exact` row gives the read value exactly as `MpE`, the odd
integer M times 2^E. The dash moves a body 20 units a tick at 60 ticks a
second, reads an effect attached at its origin with
`BlzGetLocalSpecialEffectX` before each move, and counts the ticks it read the
drawn body more than three ticks of travel behind its set position
(`dash-ticks-drawn-behind`); its raw reads go to `unit-motion-dash-p0.txt`
and `-p1.txt`. On 3.0.1 the attached effect reads 0, 0 on every tick, so the
count is 26 and shows nothing about drawing.

### Unit movement: fly height and move speed

`SetUnitFlyHeight` applies to any unit, with or without Crow Form: on 3.0.1 a
ground footman set up as a fighter body (pathing off, Locust, paused) took the
write without it. `SetUnitMoveSpeed` stores the speed as binary32. `test/unit-movement61/cases.ts` authors the cases shared by
Bun, Lua32 and a native measurement map; the rules, and why Smashcraft relies
on nothing else in collision, pathing or orders, are in
[Warsmash notes](warsmash-notes.md#collision-pathing-and-orders).

```sh
bun test test/headless-unit-movement.test.ts
bun test/unit-movement61/build.ts BASE.w3m PRIVATE_OUT.w3x
```

The native map writes `unit-movement-p0.txt` and `unit-movement-p1.txt` to
CustomMapData at start, in the same ×128 integer form.

### Effect positions and lifetime

Effect coordinates, scale, matrix scale, orientation, time scale, time and
blend time are stored as binary32 when set; reads in the same callback see
the write. `test/effects59/cases.ts` authors seven cases shared by Bun, Lua32
and a native measurement map. `DestroyEffect` stops later setters from
changing the effect; position reads keep returning its last position until
removal. The drawn effect starts Death immediately, at its last time scale;
without Death it keeps its current animation. Warcraft's default
`EffectDeathTime` removes it five game seconds after destruction, including
a frozen effect or one whose Death is longer than five seconds. A shorter
Death holds its final pose until cleanup. Clients learn Death sequences from
`effectDeaths(model)` (seconds, or `undefined` for none) in
`runtime.clients(..., { effectDeaths })` or `LuaHeadlessMap.effectDeaths`;
without it a destroyed effect keeps its current animation until cleanup. `--render` reads them from
the destroyed models with `render.readAsset` and plays the journey a second
time to capture its scenes. The rules
and their evidence are in
[Warsmash notes](warsmash-notes.md#effects-attachment-scale-and-lifetime).

```sh
bun test test/headless-effects.test.ts
bun test/effects59/build.ts BASE.w3m PRIVATE_OUT.w3x
```

The native map writes `effects-p0.txt` and `effects-p1.txt` to
CustomMapData 0.25 game seconds after start, in the same ×128 integer form.

### Animation and effect lifetime, read from a screenshot

Warcraft has no getter for an animation's frame, so `test/animation58/`
draws each case as a ruler seen from straight above: a flat, team-colored
model whose red needle stands at the sampled frame along X (a unit a
millisecond) in a lane along Y that names the sequence, with a second red
marker at the global sequence's frame, a larger still red square as the
origin both are read from, and two yellow marks at the ruler's 0 and 1000,
all on a dark board. Its 30 rulers are wisp#58's animation playback cases
(columns one and two) and wisp#59's Death, teardown and matrix scale cases
(column three). Every case starts 3 game seconds after the map, clear of
the first second, when 3.0.1 runs several timers in one frame before effects
animate. The models are MDL text compiled to MDX with war3-model
(`models.ts`), as Smashcraft's stage models are.

```sh
bun test test/headless-animation.test.ts
bun test/animation58/build.ts BASE.w3m PRIVATE_OUT.w3x
bun test/animation58/read.ts SCREENSHOT.png
bun test/animation58/render.ts PRIVATE_DIR
```

11 game seconds after start the native map writes `animation-p0.txt` and
`animation-p1.txt`: `ready=30`, then where each ruler unit stands
(`NAME-at=X×128,Y×128`). Take the capture within a few seconds of it: rulers
destroyed 3, 2 and 1 s earlier tell how long a destroyed effect stays drawn.
`read.ts` finds the marks (any scale, rotation or mirroring: one extra mark
left of the first ruler tells which way up), reads every ruler from its
drawn origin as `needle X,needle Y,global marker X` in world units, or
`gone`, and compares it with `test/animation58/expected.ts`, within each
ruler's timing allowance where a clock ran before it froze. Effect global
markers share a renderer starting phase; the reader measures it from the
effect frozen in its creating call (`global-frozen`) and compares all effect
clock deltas modulo their length. Unit clocks start at zero. Raw marker
positions and the measured starting phase stay in the output. Reading from the
drawn origin keeps a model drawn away from its unit's position readable. It
also prints the overshoot a 1002 ms loop lost in 4.5 s against a reference
clock, when the capture was taken, how much later each destroyed ruler's
Death started than the reference's (or that it was gone), and any ruler
drawn more than 3 units from its slot. `render.ts` draws the headless view
of the same moment; its reading matched all 30 rows on 8 October 2026.
The retained native capture 2 confirms all 20 animation rows after the
same-callback selection/seek fix; effect lifetime and scale belong to #59.

The 0.405 cutoff was identified in WurstScript's Apache-2.0
[UnitProvider at 9913e1b](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/de.peeeq.wurstscript/src/main/java/de/peeeq/wurstio/jassinterpreter/providers/UnitProvider.java).
Wisp's TypeScript implementation is independently authored; no Wurst source
was copied or adapted.

## Warcraft 3.0 natives

The typed API is generated from the installed 3.0.1 build 24342 `common.j`
and `Blizzard.j`. The nineteen equipment natives renamed in 3.0.1 are
declared only with their `Blz` names. The installed script names the music
native `BlzSetThematicMusicAbsoluteVolume`. No dedicated Ability Amp, Crit,
or Resolve stat native or unit field is exposed there; the new ability
level fields are declared as the script defines them.

```bash
bun scripts/natives.ts /private/common.j /private/blizzard.j src/natives/warcraft.d.ts
bun test test/headless-warcraft3.test.ts
```

Attack reset clears the selected weapon's remaining wait while retaining
its configured attack period. Ability cooldowns track each unit and ability
independently and advance with the headless clock. The aura toggle tracks
both aura operation and its optional UI change. Removing a unit releases its
ability state and ability handles, including their fields and IDs. Input
queries read the client's held keys, modifiers, mouse buttons and screen position. Effect
animation controls retain the blend duration and requested animation queue;
`BlzRemoveEffect` removes the effect immediately.

Scenery natives retain fog and HD water settings, camera types and blockers,
input control, hotkey target lock, HUD scale, cinematic state, thematic music
settings, doodad colors and animations, and all 24 destructable creation
variants. `SceneryFixtures` supplies map doodads, cinematic shot durations,
terrain pathing cells and HUD scale. Queries for missing cinematic or terrain
facts fail with the needed fixture name.
`bun test test/warcraft3-scenery.test.ts` exercises 92
native calls in Bun and Lua32, with zero missing-native reports.

Set `scenery` and `inventory` on `HeadlessMap` or `LuaHeadlessMap`; both are
passed to every client. `inventory.items` declares item types, levels,
equipment types and tags. `inventory.units` declares bag, inventory and
extended inventory capacities, supported equipment slots, animation
durations, talent defaults and healing multipliers. Missing animation,
equipment or healing-bonus facts ask for their fixture instead of making up
a value. `BlzUnitHeal` reads and writes the same life as `GetWidgetLife`.

The combined fixture executes all 145 added native names in Bun and Lua32,
checks zero unmodelled calls, and exercises the default client's inventory,
healing and scenery clock. `WARCRAFT3_NATIVES` in
`wisp:src/headless/warcraft3Natives.ts` is the checked list.

## Native table iteration order

`test/table-order/main.ts` walks a 1,000-key string table and a 1,000-key
sparse integer table with Lua `pairs`. Each client writes `table-order.txt`
in its CustomMapData folder, with the key count, an order checksum and every
key in traversal order. The integer keys start above 1,000,000 so they use
the table's hash part. The checksum folds each key's unique value in order;
the full rows let the host compare the orders directly too.

Build the two-player measurement map, then host it on an offline LAN pair:

```sh
bun test/table-order/build.ts BASE.w3m OUT_DIR/TableOrder.w3x
bun examples/sample/scripts/sample.ts lan fresh OUT_DIR/TableOrder.w3x --pair K
```

The output folder must already exist and stay outside the checkout. Compare
the `string` and `sparse-integer` rows from both clients, excluding the local
`player=` row. This measurement uses the native Lua table traversal; the
Bun headless runtime's JavaScript object order cannot decide this check.

## Effect visibility comparison (#72)

Smashcraft's `f9d0fbf3` Classic batch on 8 October 2026 has 14 graded
cases and 42 held screenshots. The same revision's `82-effects.pad` was
replayed through the native driver to obtain 42 headless scenes. Both images
are 1920 × 1080. Counts below use the native rubric: changed RGB pixels in
the rectangle `(0.44, 0.36, 0.58, 0.72)`, with a channel difference greater
than 20, relative to that case's +20 screenshot. Consequently +20 is zero
by definition. A case passes when either +2 or +8 reaches 1,000 pixels.
The native batch passes 12 cases and fails both electric cases.

| Case | Native +2/+8/+20 | Original headless +2/+8/+20 | Agreement |
| --- | --- | --- | --- |
| Electric hit | 889/256/0 | 5634/538/0 | Fail |
| Slash spark | 4034/0/0 | 4386/0/0 | Pass |
| Ice spark | 19072/0/0 | 31517/0/0 | Pass |
| Shield hit | 2950/0/0 | 3682/0/0 | Pass |
| Electric shield | 424/0/0 | 3982/0/0 | Fail |
| Shield break | 11686/0/0 | 12325/0/0 | Pass |
| Floor tech | 1518/1789/0 | 121/166/0 | Fail |
| Wall tech | 1365/1660/0 | 1806/2128/0 | Pass |
| Ceiling tech | 1365/1656/0 | 1868/2202/0 | Pass |
| Ledge catch | 1811/1430/0 | 2362/2904/0 | Pass |
| Ledge dust | 6313/61246/0 | 0/0/0 | Fail |
| Double jump | 3604/0/0 | 4274/5285/0 | Pass |
| Wall jump | 2292/0/0 | 2735/3141/0 | Pass |
| Landing | 7841/8799/0 | 14125/13189/0 | Pass |

Floor tech was overpainted by the opaque platform: pooled cues were drawn
first because they were created first. Drawing opaque models before blended
models increases its counts to 1970/2260/0 and agreement to 11/14. The
native-pinned regression is `test/draw-order.test.ts`.

The renderer now multiplies each layer's alpha by its geoset's animated
alpha and blends additive layers with source alpha, so fades scale what an
additive layer adds. Particle texture cells repeat past the grid's last cell:
ledge dust's 1×1 Dust5A grid had been sampled outside the texture and drew
nothing. Emitters run one frame behind animation time. On all 42 frames:

| Case | Native +2/+8/+20 | Headless +2/+8/+20 | Agreement |
| --- | --- | --- | --- |
| Electric hit | 889/256/0 | 4625/538/0 | Fail |
| Slash spark | 4034/0/0 | 4414/0/0 | Pass |
| Ice spark | 19072/0/0 | 24303/0/0 | Pass |
| Shield hit | 2950/0/0 | 3727/0/0 | Pass |
| Electric shield | 424/0/0 | 3223/0/0 | Fail |
| Shield break | 11686/0/0 | 13060/0/0 | Pass |
| Floor tech | 1518/1789/0 | 1970/1934/0 | Pass |
| Wall tech | 1365/1660/0 | 1870/1794/0 | Pass |
| Ceiling tech | 1365/1656/0 | 1868/1774/0 | Pass |
| Ledge catch | 1811/1430/0 | 2365/1793/0 | Pass |
| Ledge dust | 6313/61246/0 | 5137/35843/0 | Pass |
| Double jump | 3604/0/0 | 4274/0/0 | Pass |
| Wall jump | 2292/0/0 | 2779/0/0 | Pass |
| Landing | 7841/8799/0 | 6934/8242/0 | Pass |

Agreement is 12/14. Both electric cases still pass headless: the stock
ForkedLightningTarget's additive Blue_Glow2 halo (effect alpha 113) is
visible headless and absent natively. Headless also clears to a dark
backdrop where native draws the stage sky; a sky-coloured clear brings
electric hit's +8 from 538 to 269 (native 256) but leaves +2 at 4356.

The effect's alpha is the renderer's model alpha (`setInstanceAlpha`) and
fades every layer once; the three rules are pinned in
`test/effect-opacity.test.ts`. With the map's sky drawn, two further
variants were measured on all 42 frames:

- Fading additive colour by the effect alpha a second time: electric hit
  2383/269, electric shield 1595, still 12/14, and floor, wall and ceiling
  tech and ledge catch +8 fall to 0 against native ~1,700. Native fades
  additive layers once.
- Sampling effect meshes two frames earlier (emitters unchanged): electric
  shield 741 agrees, electric hit 1274/269 does not, and ice spark +2 falls
  from 23088 to 10786 (native 19072): 13/14.

ForkedLightningTarget grows on a Bezier scaling track from 0.165 at Birth's
start to about 0.325 at +2's 33 ms, so the electric counts depend on when
native samples Birth; which engine rule sets that time is not yet measured.

Only measured numbers and authored code are kept here. Screenshots, stock
models and textures stay in private local storage under the clean-room rules.

## Boundaries

The runtime emulates natives; it is not Warcraft. It has no engine frame
timing, terrain, pathing, combat, real input devices or Battle.net
beyond the [measured sync latency](network-model.md), and it emulates only
natives a map has needed. A program that reads real devices can type into
it, but focus belongs to the map's own frame calls, not to a window;
edit-box text-changed and Enter events are not emulated, and a click reaches
only frames placed by absolute points. Explicit no-ops use the map's stated
assumptions about behavior it ignores. A passing
journey shows that the clients agree with each other on these stubs; native
desyncs, timing and rendering beyond the matched checks above keep their
native checks ([desync reports](hot-reload.md#desync-reports),
[player view](player-view.md)).

## JSON results

`wisp headless [JOURNEY] --json` writes JSON Lines to stdout; step timings
and the final error message stay on stderr. Without `--json`, output stays
as described above. `--cost` adds a `type: "cost"` record with the measured
prediction.

Each journey writes one `type: "result"` record with `journey`, `ok`,
`frames`, and `clients` (each client's slot, native call count, checksum,
and errors, plus `missingNatives`). Each problem writes a `type: "failure"` record with `kind`
(`desync`, `error`, `scene`, `check-fail`, or `missing-native`), `frame`, `client`, and `message`.
Missing-native records also include `native`, its exact declared name.
Unavailable frame or client values are `null`. JSON mode compares calls on
every frame so a desync names the first differing frame and client.

The last line is always a `type: "summary"` record with `ok`,
`counts: { results, failures }`, and monotonic `elapsedMs`. All records have
`schema: 1` and `command: "headless"`. A failed run retains its nonzero exit
code, including a load or usage error before any result.

The missing-native CLI fixture (`bun test test/headless-coverage.test.ts`)
reported both clients and exited 1 in 1.51 s on 7 October 2026, below the 2 s
target and the approximately 24 s native-check baseline in #38. The focused
fixture also runs built-in, supplied and intentional no-op behavior in Bun
and emitted 32-bit Lua.
