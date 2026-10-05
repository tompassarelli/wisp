# Headless runtime

Most questions about a map's code don't need the signed-in Warcraft clients.
The headless runtime runs the map in N simulated clients in this process, in
lockstep, with every Warcraft native the map can call emulated per client. It
answers in about a second whether the clients stay synchronized through a
journey, what errors the map reported, whether a hot reload ran in every
client and what a player would see wrong in the scene the map draws.

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
| Triggers | Sync, chat and key events, registered per player. A chat line matches its registered text exactly or as a substring, as registered. |
| Sync messages | `BlzSendSyncData` reaches every client, including the sender, in send order, after the frame or event that sent it and before the next. Warcraft delivers it some frames later. |
| Files | `Preload` writes files the test reads from `client.files`. `Preloader` reads only files the host published (`publish`, `reload`), one chunk per FileIO tooltip level, and keeps the first content it read from a path, as Warcraft does. |
| Units | Position, type, move speed and attack cooldown. |
| Special effects | Model, position, alpha, scale, time scale and a flattened matrix, as `client.effectPoses()` returns them. `AddSpecialEffect` puts an effect on the ground at height 0. |
| Frames | A frame getter returns the same handle for the same frame. The local client is 1920 pixels wide plus 640 per client index, 1080 high. |
| Conversions and math | `I2S`, `R2S`, `R2I`, `I2R`, `S2I`, `S2R`, `SubString`, `StringLength`, `SquareRoot`, `Atan2` and the bit operations, binary32 where Warcraft is. |
| Messages | `DisplayTextToPlayer` for the local player and `DisplayTextToForce` show text in `client.messages`; Wisp's `error in HANDLER: ...` reports also go to `client.errors`. |

Every other declared native returns a new handle, 0, "", false or nothing,
by its declared type, and each `Convert` native returns its argument. Constants of a handle type are their own name, so
comparisons with them work; global variables such as
`bj_mapInitialPlayableArea` are handles. A game supplies `natives` for one its
code needs answered otherwise. The declarations come from
wisp:src/natives/warcraft.d.ts.

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

`reload()` publishes the map's bundle as the next version, as `wisp hot` does:
payload files, then the manifest, in every client's CustomMapData. The map's
own reloader finds it on its next poll, the clients answer through sync
messages, and every client installs it on the same frame. `unappliedReloads()`
names each client whose acknowledgement file doesn't show the latest version,
with its "not applied" message. In Lua the published text is the compiled
bundle; in Bun it names the entry module, which the emulated `load` returns.

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

The map's modules load once for every client. While a client runs, each
global whose name starts with one of the game's prefixes, or `__wisp`, is that
client's; module locals are shared. Map state that must survive a reload is
already in globals; keep all synchronized state there. Lua's `xpcall`,
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

`headless [JOURNEY] [--clients N]` plays the named journey, or the first, in
N clients (2 by default, at most 4, the slots Wisp's per-player files cover)
and prints each client's calls and checksum, the first desync, a reload not
running, each client's error report file and thrown stack, and each client's
latest scene report with what a player would see wrong. It exits 1 when it
printed a problem. The entry module loads when the command runs, so the
project's host type check never reads map code.

## Boundaries

The runtime emulates natives; it is not Warcraft. It has no engine frame
timing, rendering, terrain, pathing, combat, real input devices, Battle.net
or network latency, and it emulates only natives a map has needed. A native
answered by a default value can hide behavior that depends on what Warcraft
would return. A passing journey shows that the clients agree with each other
on these stubs; native desyncs, timing and what reaches the screen keep their
native checks ([desync reports](hot-reload.md#desync-reports),
[player view](player-view.md)).
