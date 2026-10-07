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
| Timers | 60 frames a second. A timeout runs on the nearest frame, at least one frame after it starts; periodic timers repeat. Each frame runs the due timers in creation order. |
| Triggers | Sync, chat, key and frame events, registered per player or frame. A chat line matches its registered text exactly or as a substring, as registered. |
| Sync messages | `BlzSendSyncData` reaches every client, including the sender, in send order, after the frame or event that sent it and before the next. Warcraft delivers it some frames later; a [delivery](network-model.md) gives the measured latency. |
| Files | `Preload` writes files the test reads from `client.files`. `Preloader` reads files the host published (`publish`, `reload`), or another program wrote in a client's [CustomMapData folder](#input-from-another-program), one chunk per FileIO tooltip level, and keeps the first content it read from a path, as Warcraft does. |
| Units | Position, type, move speed and attack cooldown. |
| Special effects | Model, position, alpha, scale, time scale and a flattened matrix, as `client.effectPoses()` returns them. `AddSpecialEffect` puts an effect on the ground at height 0. |
| Frames | Created frames keep their type, parent, text, visibility, enabled state, level, text limit, size and absolute points; `client.frames.shownText()` lists the text a player sees (frames shown with every parent). A frame getter returns the same handle for the same frame. The local client is 1920 pixels wide plus 640 per client index, 1080 high. |
| Conversions and math | `I2S`, `R2S`, `R2I`, `I2R`, `S2I`, `S2R`, `SubString`, `StringLength`, `SquareRoot`, `Atan2` and the bit operations, binary32 where Warcraft is. |
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
on their client only and up to its text limit, as Warcraft drops the rest;
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
`bun node_modules/wisp/scripts/wisp/towardZeroLua.ts DIR` builds one in DIR
with `nix` (nixpkgs' Lua source, checked against lua.org's checksum) and
prints its path; `towardZeroLua(DIR)` does the same in a host program, and
`luaRounding(lua)` tells which rounding a Lua has. Without nix:

```sh
make -C lua-5.3.6 generic "MYCFLAGS=-DLUA_32BITS -include /path/to/toward-zero.h"
```

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

`headless [JOURNEY] [--clients N] [--cost]` plays the named journey, or the first, in
N clients (2 by default, at most 4, the slots Wisp's per-player files cover)
and prints each client's calls and checksum, the first desync, a reload not
running, each client's error report file and thrown stack, and each client's
latest scene report with what a player would see wrong. It exits 1 when it
printed a problem. With `--cost` and the game's perf program (`makeHeadless(load,
perf)`), it then plays the journey in 32-bit Lua and prints each client's
predicted native cost per frame ([frame cost](frame-cost.md#predicted-native-cost)).
The entry module loads when the command runs, so the
project's host type check never reads map code.

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

The renderer uses the already declared `war3-model` 4.0.1 package, MIT,
Copyright 2017–2023 4eb0da; its package retains the license. Wisp calls its
public model/texture parsers and `ModelRenderer` API. Positions, model scales,
animation times, rotations, camera fields and visible frame art come from the
map's native calls. Particle and ribbon clocks advance to the captured time.
This is a scene renderer for look checks, not pixel-identical Warcraft shading.

Every started sound is printed with its client, frame, source or label, volume
and pitch. `--sound-cues FILE.json` writes the complete creation/play log;
`--json` emits each playback as a `type: "sound"` row. A map test can call
`assertSoundCue(client.soundLog, { label: "LABEL", frame: 64, count: 1 })`
from `wisp/src/headless/client`. Creating a sound without starting it fails a
"plays the cue" assertion. This checks the game's calls, not audibility.

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
`BlzGetUnitMaxMana`/`BlzSetUnitMaxMana`, `KillUnit`, and `RemoveUnit`.
Removal drops the unit from rendered poses; its type ID and life read zero.
Life at or below the binary32 value of 0.405 marks a unit dead. Life writes
to a dead unit cannot revive it; `KillUnit` leaves zero life.

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

`test/unit-states/cases.ts` authors twelve cases shared by the Bun, Lua32,
and offline native map. They cover owner, facing, life, mana, both maximums,
the exactly representable life values 0.40625 and 0.3984375 around the death
cutoff, killing, two attempted writes after death, and removal. The two-client
journey took 25.1 ms in Bun on 7 October 2026; its injected different life
write is reported by the existing call comparison.

Run the shared cases and build their native measurement map:

```sh
LUA=PATH_TO_LUA32 bun test test/headless-unit-states.test.ts
bun test/unit-states/build.ts BASE.w3m PRIVATE_OUT.w3x
```

The native map writes `unit-states-p0.txt` and `unit-states-p1.txt` to
CustomMapData. Each named row contains integers equal to the observed values
multiplied by 128, retaining every bit of the selected fractional values.
Compare the twelve rows with the `EXPECTED` list in the test.

The 0.405 cutoff was identified in WurstScript's Apache-2.0
[UnitProvider at 9913e1b](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/de.peeeq.wurstscript/src/main/java/de/peeeq/wurstio/jassinterpreter/providers/UnitProvider.java).
Wisp's TypeScript implementation is independently authored; no Wurst source
was copied or adapted.

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
