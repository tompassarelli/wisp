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

- **Bun** runs the map's TypeScript modules (wisp:host/headless/headless.ts).
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
| Players | Player N is the number N. The journey's player slots are playing humans with a client each; every other slot is empty. `GetLocalPlayer` is the client's slot. `GetPlayerName` reads `playerNames`, a map declaration keyed by slot, with `Player N` (one-based) for unnamed slots. |
| Timers | 60 frames a second over Warcraft's timer clock: binary32 deadlines whose sums round toward zero (native reads one 1/65536 s unit lower in 280 of 4,000 1/60 s readings from callback 3,364, wisp#134). A frame runs every callback due by its end, earliest deadline first and equal deadlines in `TimerStart` order, so a period shorter than a frame fires several times in it (1/1024 s: 17 or 18). A period is at least 0.0001 s (a zero period: 10,002 times in the first second) and a one-shot timeout at least 1/1024 s. A timer started inside a callback is timed from its deadline and fires in the same frame when due. Inside a callback, timers read its deadline as the game time; a periodic timer's elapsed time restarts each period, an expired one reads its timeout and a paused one keeps its value. [Rules](warsmash-notes.md#timers-and-frame-stepping). |
| Triggers | Sync, chat, key and frame events, registered per player or frame. A chat line matches its registered text exactly or as a substring, as registered. |
| Sync messages | `BlzSendSyncData` reaches every client, including the sender, in send order, after the frame or event that sent it and before the next, its data cut to 255 characters as Warcraft 3.0.1 cuts it. Warcraft delivers it some frames later; a [delivery](network-model.md) gives the measured latency. |
| Files | `Preload` writes files the test reads from `client.files`, each string cut to its first 259 bytes as Warcraft cuts it ([Preload line length](warsmash-notes.md#preload-line-length-wisp77)). `Preloader` reads files the host published (`publish`, `reload`), or another program wrote in a client's [CustomMapData folder](#input-from-another-program), one chunk per FileIO tooltip level, and keeps the first content it read from a path, as Warcraft does. |
| Units | Position, type, move speed and attack cooldown. |
| Special effects | Model, position, alpha, scale, time scale and a flattened matrix, as `client.effectPoses()` returns them. `AddSpecialEffect` puts an effect on the ground at height 0. |
| Frames | Created frames keep their type, parent, text, visibility, enabled state, level, text limit, size and absolute points; `BlzFrameIsVisible` is false under a hidden parent, and once a frame has a text limit `BlzFrameSetText` keeps that many characters (no limit reads -256); `client.frames.shownText()` lists the text a player sees (frames shown with every parent). A frame getter returns the same handle for the same frame; `BlzFrameGetChildrenCount` and `BlzFrameGetChild` see the map's own frames under a parent, in creation order, not Warcraft's. A frame whose level was never set draws and takes clicks at its nearest leveled ancestor's level; the renderer wraps text at its frame's width and centres the text of a button type that sets no alignment. The local client is 1920 pixels wide plus 640 per client index, 1080 high. |
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

### Standalone profile

Standalone mode emulates only the natives a game declares in its standalone
profile, not Warcraft's unit simulation: movement, pathing, orders, combat
and buffs stay Warcraft's. A game that needs Warcraft to move, path, order,
fight or buff its units is a Warcraft-only map; it builds and plays in the
game with Wisp's toolchain but has no standalone mode. Warcraft's API stays
the one seam: the same compiled map runs in Warcraft and in Wisp's host, and
Wisp adds no API of its own for standalone games. Every newly emulated
native moves Wisp toward a Warcraft engine, so the profile is the contract
and grows only when a game shows it calls a native.

A game generates its profile from the natives its compiled map bundle names
and commits it:

```sh
bun node_modules/wisp/host/headless/standaloneProfile.ts build/map.lua > standalone-profile.json
```

and declares it as `standaloneProfile` in `HeadlessMap` or `LuaHeadlessMap`.
A name the declarations don't have is refused when the clients start. A
call to a native outside the profile fails the journey even when Wisp
models it, recorded once per client with its frame as an `outside-profile`
finding, `native NAME is outside the standalone profile`; a standalone run
(`runStandalone`, Chrome or the native window) stops on it with
`pN frame F: native NAME is outside the standalone profile`. Inside the
profile, an unmodeled native still fails as above. `bun test
test/headless-coverage.test.ts` checks both the generator and the failure.

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
    { frame: 100, player: 0, mouse: { x: 640, y: 360, left: true } },
    { frame: 105, player: 1, playerMouse: { x: 512, y: -256, button: "right", down: true } },
    { frame: 110, player: 0, click: { x: 0.4, y: 0.3 } },
  ],
};
```

A key event is a press and a release with its modifiers (2 is Ctrl).
A mouse event moves that player's pointer to screen pixel `x`, `y`
(`BlzGetMouseScreenPosX/Y`) on their client only, and `left` holds or
releases the left button (`BlzIsMouseButtonPressed`); it stays where the last
event left it, so a drag is a press, moves and a release.
A player mouse event is that player's synchronized mouse event at world
`x`, `y`: a move, or with `button` (`left`, `middle`, `right`) and `down` a
press or release. Like a key event it reaches every client's
`TriggerRegisterPlayerEvent` triggers on one frame, with `GetTriggerPlayer`,
`BlzGetTriggerPlayerMouseX/Y`, `BlzGetTriggerPlayerMousePosition` and
`BlzGetTriggerPlayerMouseButton` set; `test/player-mouse67/` checks it in Bun
and Lua32.
A click event is `Lockstep.click` at Warcraft UI coordinates (see Typing and
clicks); the journey fails when no frame there takes clicks.
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
Warcraft and reads the files the map writes. wisp:host/headless/headlessInput.ts
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

### Pause and drawn-frame timing

Bun and emitted-Lua clients supply `os.clock()` from the client's local
presentation clock. A deterministic journey uses its frame clock; a
`RealtimeClients` run uses wall seconds since start, including a stopped
game's wall-time gap. The real input helper continues reading and typing
through that gap, and its pause commit and resume acknowledgments still go
through the map's normal files, edit box and synchronized messages.

`advance()` can run several due callbacks before one picture appears. Unit
and effect animation clocks advance once per picture; a model with time
scale zero keeps both its sequence time and its global-sequence time.
The sixth `RealtimeClients` argument is `afterDraw(timing)`, called once
after those callbacks. `timing` reports the draw number, wall milliseconds,
last callback frame and callback count. Capture `captureScene(client)` there
to report the first visible resumed fighter positions and animation times.
The fifth argument remains a callback observation and should be used for
simulation diagnostics rather than a visible-frame comparison.

A three-second
pause and a resume batch through real timers, units, effects and the local
clock. A consumer's pad check must retain the native pause capture's helper
acknowledgments and use this draw observation with its actual map and helper;
callback pose equality alone cannot decide visible pose equality (#86).

The native #86 reference is the Classic capture of Smashcraft
`0911b5dac` on Warcraft 3.0.1.24342, retained privately at
`~/.local/state/wisp/ref-86-pause/` and linked from
[the native result](https://github.com/tompassarelli/wisp/issues/86#issuecomment-6066025581).
Its producer and helper monotonic stamps give these measured intervals:

| Interval | Classic (helper 0) |
| --- | ---: |
| Start injection → PAUSE_COMMIT | 584.670528 ms |
| PAUSE_COMMIT → RESUME | 2538.985246 ms |
| Resume Start injection → RESUME | 123.680774 ms |
| Helper PREPARE / PAUSE / RESUME frame | 168 / 168 / 168 |

The map trace acknowledges PREPARE at callback 196, PAUSE at 205 and
RESUME at 356. During the pause, callbacks 240 and 300 still run with
simulation frame 168; native map pause therefore freezes presentation and
simulation through the map's own state, rather than calling
`RealtimeClients.hold()`. The focused native-reference test uses the measured
committed pause interval to check that the local clock and timer callbacks
continue while a fighter with time scale zero stays frozen.

The video contains every drawn picture under the capture's load. Classic
frames 498 and 647 have zero changed fighter pixels across resume. Movement
begins on the next changed picture, 649. These video indices are pictures, not callback
numbers; the recording does not identify the exact callback of each picture.

The existing real-helper headless run at
`~/.local/state/smashcraft/wisp-pause86-current-helper/` matches PAUSE/RESUME
168/168 and the first resumed fighter pose on both clients, but its measured
Start-to-commit delay is 403.881069/405.436109 ms with `syncDelivery()`. The
gap is in the control messages' delivery, not in the map or helper: natively
the Start's pause request took 109 ms to leave client A (typed text reaching
the map) against 22 ms headless, client B read PREPARE 101 ms after client A,
and the last PREPARE acknowledgment took 183–187 ms from client B's send to
the PAUSE_COMMIT read against 107–108 ms headless. The capture's 585–588 ms is
therefore not a universal pause delay.

Smashcraft's `pad SCRIPT --headless --replay-arrivals NATIVE_DIR` replays the
capture's measured arrivals, from each Start press, through the real map and
helpers ([Replayed arrivals](network-model.md#replayed-arrivals)): the pause
request at the first PREPARE read (+219.214 ms), both PREPARE acknowledgments
at the first PAUSE_COMMIT read (+584.671 ms) and the resume request at the
first RESUME read (+123.681 ms). Its run of Smashcraft's
`test/native/pads/206/pause-dash.pad` with the reference's helper commits
the pause 600.912/603.108 ms after Start (native 584.671/588.481, within one
frame on both clients) and resumes 128.746 ms after the second Start (native
123.681/124.726), PAUSE/RESUME 168/168, under a load average of about 24.

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
file and restore after. The globals go in at the first `clients()` call, so a
file whose tests a `-t` filter skips (and whose `afterAll` Bun then skips too)
installs nothing. A test can also drive the `Lockstep` directly:
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

Warcraft also flushes a subnormal binary32 result, one below 2^-126, to zero,
keeping its sign. In Smashcraft 0.0.273 the match camera eased its x toward 0
by `f32(x + f32(f32(0 - x) * rate))`; natively x stopped at
1.1940069608864212e-37, where the step's product fell below 2^-126, while Bun
and Lua32 kept decaying through the subnormals, so three of four native
matches missed their replay checkpoints for a few hundred frames after each
down smash or down air (smashcraft#25). `f32()` and the exact helpers flush
such a result. Whether Warcraft also reads a subnormal operand as zero is not
known.

wisp:native/toward-zero.h makes a LUA_32BITS Lua 5.3.6 round its raw float
`+ - * /` and its decimal numerals toward zero, and flush a subnormal raw
`+ - * /` result to zero, so a raw operation that reaches the subnormal range
differs from a stock Lua32 there too.
`bun node_modules/wisp/host/compile/lua32.ts toward-zero` prints its path,
and `bun node_modules/wisp/host/compile/lua32.ts` the stock Lua32's; each is
built on first use from lua.org's release tarball, committed at
wisp:vendor/lua-5.3.6.tar.gz and checksummed before each build, with gcc and
make (or `nix` when they are missing) and no network, into a per-user cache,
`~/.cache/wisp/lua32/KEY/lua`, keyed by the source checksum, flags, headers
and source edits. Both builds fix their table layout with
wisp:native/fixed-layout.h: stock Lua seeds its string hash with the time
and addresses, places table, function and userdata keys by address, and
caches strings pushed from C by their address, which for `debug.getinfo`'s
`short_src` is on the C stack and moves with the environment's size. So the
same program's iteration order, table resizes, garbage and allocation per
frame varied from run to run with equal instruction counts. The build seeds
the hash with a constant, keeps a one-entry string cache that hits on
content alone, and on Linux re-executes the interpreter once with address
randomization off; wisp:test/fixed-layout.test.ts holds the order and
allocation across seconds and environment sizes. A Lua named by `LUA` keeps
its own layout. Both builds also take wisp:native/requested-bytes.h, which
adds `collectgarbage("requested")`: the bytes the program has asked for, as
an integer that wraps, so a difference of two readings is exact. It counts
each allocation's growth, each table resize at its parts' net growth, and
each interned-string hit at the string's size,
and leaves out the string table, stacks and call frames, which the collector
resizes; [runLuaPerf](frame-cost.md) charges frames from it. A lock lets
parallel worktrees share one build.
`lua32(variant)` does the same in a host program, and `luaRounding(lua)` tells which rounding a Lua has. Wisp's
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
(wisp:host/commands/headless.ts), naming its map, its entry module's
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
Wisp never writes to or traps a native game process
([Principles](../README.md#principles)).

### Rendered frames and sound cues

`wisp headless [JOURNEY] --render PRIVATE_DIR --frames 64 132 206` writes
`p0-frame-64.png` (and one image per requested frame and client), the captured
scene JSON, and `render.json` naming the GPU, counts of models and textures,
and each asset's attempted and selected location.
Each image in `render.json` also lists `ui`: one row per drawn frame, in
drawing order, from `uiReport(scene, width, height)` in
wisp:host/render/screen.ts. A row names the frame, its type, level and
texture, the texture's selected layer and sha256, its texture region (UV
`[0, 0, 1, 1]`: a texture set with `BlzFrameSetTexture` is drawn whole), its
`[left, top, right, bottom]` in UI units, its pixel rectangle, and
`outside43` when an edge leaves the 0.8 x 0.6 area of the 4:3 screen. Pixels
follow the renderer's rule: the 4:3 area is centred and scaled by the screen
height, so x = W/2 + (left − 0.4)·H/0.6 and y = (0.6 − top)·H/0.6. Frame
scale and the 4:3 cut of `GAME_UI` children apply as under
[Screen bounds](#screen-bounds).

Without `--resolution`, client i reports a (1920 + 640·i) × 1080 screen to
`BlzGetLocalClientWidth/Height`, `BlzPixelToFrame*` and `BlzFrameToPixel*`,
and frames render at the map's `render.width`/`height` (default 1280x720).
`--resolution WxH` gives every client and the render canvas that size, so a
map's layout and its picture agree, such as `--resolution 800x600` for a 4:3
Classic pool client.
`--focus MODEL` frames one body: in every captured scene, the one drawn effect
or unit whose model path contains `MODEL` (at nonzero alpha, so a hidden
fighter doesn't count) takes the camera, which keeps its rotation, angle of
attack and field of view and moves until the box its drawn vertices span
over every focused frame is centred and spans three quarters of the frame,
so a strip keeps one zoom; `--render` and `--bounds` both
see the focused camera. A scene with no match or more than one fails, naming
the count, so hide or move the others first.
Unit and effect alpha fades opaque material layers; alpha 140 blends the body with the background, as in a roll.
Frame numbers are headless client frames after that frame's journey events.
`--match-frames N...` in place of `--frames` names the map's own match frame
instead: the frame its scene report's `frame()` returns (Smashcraft's
`simulationFrame`, the counter its native captures stamp), captured on the
first client frame that reads it, with images named `p0-match-N.png`. A
journey that starts its match at client frame 30 reaches match frame 410 at
client frame 440; one that ends first fails, naming the frames it never
reached (wisp:test/headless-observations.test.ts).
`--journey FILE.json` replaces the named journey with `{ frames, events }`;
key events may include `down: true` and a later `down: false` to hold a key.

Chrome renders hold a `gpu` machine-capacity lease. On a machine with the
machine-capacity helper (`agents path machine-capacity`, or
`WISP_CAPACITY_HELPER`), `--render` started outside a lease exits 1 before the
journey runs, naming the command that reruns it inside one and waits for a free
gpu slot: `bun HELPER run --class gpu --owner wisp-render -- ARGV...`. The
check reads the run's cgroup, which shows a lease but not its class, so any
capacity lease lets the render start. Without the helper, as on CI and cloud
machines, `--render` runs as before. `runStandalone` applies the same check to a headless, scripted or capturing run, never to the window a person plays
([Standalone window](play.md#standalone-window)); the refusal, the inside-lease
start and the no-helper start are covered by wisp:test/gpu-lease.test.ts
(wisp:host/render/gpuLease.ts).

The map supplies `HeadlessProject.render.readAsset(path, graphics)`, returning the actual
imported or stock asset bytes, or `undefined` when absent. `--graphics classic`
is the only graphics mode and the default. Projects that read map imports and
stock files separately also supply `resolveAsset(path, graphics)`, returning
`resolveRenderAsset` from `host/render/renderAssets.ts` through their Effect
runtime. It tries the map's import, then the stock file; `war3mapImported`
paths stay within the map. All of a model's nonreplaceable DDS textures
decode their top image directly (DXT1, DXT3, DXT5 and ATI2), including DDS
bytes supplied under a model's TIF path. PNG conversion by the project's
asset reader is optional. All of a model's nonreplaceable textures are
requested before a missing texture refuses the model.
The selected source, layer and path and every attempted location appear in
`render.json`; byte-only readers record the supplied project path.
`render.json` also records the mode and its profile's levers. Keep these assets and
the output outside public repositories. MDX and MDL models, BLP1, TGA and PNG
textures are supported, including raw version-1800 SKIN records
with four UINT16 bone IDs and four UINT16 weights per vertex. Host silhouette
and motion readers use `parseModelMDX` from `host/models/models.ts` to read
the same skin. A resolver can return decoded PNG bytes for a stock
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
Under [M5](https://github.com/tompassarelli/wisp/issues/75), these frames give
visibility, pose, geometry and HUD-layout verdicts. A look lever whose fidelity
gate passes gets its verdict on Wisp within its calibrated range, when the
verdict is outside the gate's error margin. Native truth runs on the Warcraft
VM: take one spot check per lever per build when the verdict is inside that
margin, the settings fall outside the calibrated range, or the appearance
depends on PopcornFX particles. An unstable reference makes the gate
inconclusive; it never widens the error bound. The laptop runs only product
proofs, such as performance on Tom's machine, trailers and listening clips.

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

### Screen bounds

`wisp headless [JOURNEY] --bounds DIR --frames N...` (or `--match-frames N...`,
with `--resolution WxH` and `--graphics classic`) writes
`DIR/bounds.json` without starting Chrome: `{ graphics, width, height, images }`,
one image per requested frame and client with its `frame` (and `matchFrame`),
`client`, `ui` rows and `models` rows. `--render` adds the same model rows
to each image in `render.json` as `bounds`. Both need the map's `render.readAsset`; the
command reads models and UI textures through `render.resolveAsset` when the
map supplies it (wisp:host/commands/headless.ts, checked end to end by
wisp:test/headless-bounds.test.ts).

- **Screen size.** Rows are measured at `--resolution WxH`, the size every
  client also reports to `BlzGetLocalClientWidth/Height`; without it, at the
  render canvas (`render.width`/`height`, default 1280x720), while client i
  lays out for (1920 + 640·i) × 1080.
- **Projection.** `camera(scene, aspect)` (wisp:host/render/screen.ts),
  which the renderer and posed bounds share, spreads the camera FOV across the
  full width and then widens the half-tangent by 1.0472 and raises the picture
  by 0.00633 of the half-height, because native draws the world at a uniform
  0.9549 about the screen centre and 3.42 px higher at 1080. Measured on build
  3.0.0.24268, Classic 1920x1080, FOV 62.92-62.95° and camera distances
  859-1037, from the deck edges of 40 hidden captures (wisp#125 box 3). The
  scale doesn't change with distance, so it isn't the eye placement; native's
  target z read equals `CAMERA_FIELD_ZOFFSET` and the offset doesn't scale
  with 1/distance, so it is a viewport offset, not a target height. Native
  reports target y 256 below the map's `SetCameraPosition` y, but draws at the
  map's y. Other FOVs, aspects and sizes are unmeasured, so a fixed half-tangent
  factor and a fixed FOV offset are not told apart (checked by
  "[reference wisp#125] world projection matches native at 1920x1080",
  wisp:test/screen.test.ts).
- **The pixel rule.** `ui` rows are `uiReport(scene, width, height, textures)`
  (wisp:host/render/screen.ts): the 0.8 x 0.6 UI area is centred and scaled
  by the screen height, so x = W/2 + (left − 0.4)·H/0.6 and
  y = (0.6 − top)·H/0.6, with `outside43` when an edge leaves that area.
- **Texture regions.** A frame's texture region is UV `[0, 0, 1, 1]`, because
  a texture set with `BlzFrameSetTexture` is drawn whole. Its `layer` is the
  resolved asset's selected layer (`base` from `readAsset` alone) and its
  `sha256` hashes the bytes, so a row names exactly which picture it drew.
- **Posed bounds.** `models` rows are `sceneBounds(sceneWithUnits(scene),
  models, width, height)` (wisp:host/render/screenBounds.ts): every effect
  and unit the renderer would draw, posed at its sequence, elapsed time, blend
  and global sequences as `drawEffect` poses it, skinned on the CPU and
  projected through the scene's camera. Each row has the model's pixel `box`
  (origin top left, y down), `offFrame`, `behindEye`, `farCulled`, each
  geoset's alpha, filter mode and whether it is drawn, and each posed node's
  box and pivot. Its `body` is the same drawn-pixel box over only the
  geosets with an opaque (None) layer, so it leaves out team glow and every
  see-through geoset (Transparent, Blend, Additive, AddAlpha or Modulate
  layers only), left out when none of them draws. A model
  whose bytes are absent has no row.
- **Drawn pixels.** The box counts only pixels the model draws (wisp#125).
  A geoset with a None (opaque) layer, or a solid team-colour layer that
  passes its cut, counts its whole surface by its vertices. Otherwise each
  triangle is rasterized (pixel centres, perspective-correct texture
  coordinates, within one canvas size of the canvas) and a pixel counts when
  some layer's bilinear sample of its texture's top mip level, read from the
  map or the install through `render.resolveAsset`/`readAsset` (PNG or BLP),
  draws there: alpha-keyed (Transparent) when texel alpha × opacity reaches
  the renderer's 0.75 cut, Blend when it exceeds 24/255, Additive and
  AddAlpha when the largest channel × alpha × opacity exceeds 24/255, the
  silhouette threshold, where opacity is geoset alpha × layer alpha × the
  pose's alpha. A layer without the `TwoSided` shading flag draws only
  front faces, those whose projected corners turn counter-clockwise on
  screen with y up, as the renderer culls back faces; on the 20e Warden's
  one-sided cape-edge geoset this took the box from 5 of 12 to 10 of 12
  frames within 4 px of native (wisp#125). The team glow (`ReplaceableId` 2) is the same additive rule
  on the install's `ReplaceableTextures\TeamGlow\TeamGlowNN.blp` for the
  pose's team colour, whose texels carry that colour, so a pixel counts when
  texel × layer opacity exceeds 24/255, and the row says `teamGlow:
  "texture"`. Without that texture (no install), a geoset whose every layer
  adds the team glow counts only the part of each triangle within 1/2.8 of
  the texture's centre, the Wisp renderer's black edge, and the row says
  `teamGlow: "disc"`; another texture the bounds can't read (DDS, an
  animated texture or texture coordinates) counts the whole surface.
  Particle and ribbon emitters are not counted. Checked by a property
  (wisp:test/screen-bounds.test.ts): an alpha-keyed quad with a transparent
  border bounds its opaque texels within 1 px, one-sided it bounds nothing
  when its back faces the eye, and a radial glow texture bounds at its
  threshold radius.
- **In-frame verdict.** A map that renders portraits into HUD textures gives
  `render.portraits` a receipt per texture path: the portrait `scene` (camera
  and effects), its render `width` and `height`, the `crop` of that render the
  texture holds, the `texture` size, and `parts`, mapping the game's part names
  (head, face, weapon, gripping hand) to node names. Each `ui` row whose
  texture has a receipt gets `inFrame`, from `inFrame(portrait, models,
  row.pixels)` (wisp:host/render/screenBounds.ts). It poses the portrait as
  posed bounds do and rasterizes its triangles with a depth buffer at the
  render size, labelling each pixel with the nearest named node at or above
  the node its nearest vertex weights most: a part takes its named nodes and
  their descendants, down to a node another part names, so a head mesh skinned
  to the head bone's children counts as head and a weapon under the hand
  counts as weapon only. Each screen pixel whose centre lies in the frame shows the texel at its
  place in the texture (drawn whole), and that texel shows the render pixel at
  its centre within the crop. A texel under half opacity (alpha below 128)
  shows the HUD behind more than the portrait, so its pixels count toward no
  part: a bust's faded bottom edge hides what it fades. The headless report
  reads that alpha from the texture file (TGA or BLP); a caller of
  `inFrame` passes it as `texture.alpha`. Per part, `inFrame.parts` counts the visible
  pixels and gives their pixel `box`; `crownMargin` is the rows between the
  frame's top row and the head's top visible row; `headHiddenByWeapon` counts
  pixels where the weapon is nearest and the head would show without it;
  `handGap` is the pixel distance between the hand's and the weapon's boxes
  (0 when they touch or overlap, absent unless both show). A shown receipt
  whose scene names a model the render project can't read fails the run,
  naming the texture and model, rather than counting 0 px: a portrait
  rendered on models the map no longer imports measures nothing. A declared
  part node absent from all portrait models also fails, naming the texture,
  part, missing nodes and model paths; a node that exists but shows no pixels still measures 0. The
  rows are numbers only: the game declares the pass rules and thresholds.
  Checked by a property over random cubes (wisp:test/screen-bounds.test.ts):
  coverage equals the projected polygon's area within 1 px per edge, the box
  matches the pixel centres that polygon holds, a cube skinned to a named
  node's child counts toward that node's part, texels under half opacity
  count exactly as a crop ending above them, a cube behind another
  reports the overlap as hidden, and the hand gap between two cubes is their
  boxes' distance (0 when they overlap).
- **Native silhouette.** `wisp headless silhouette SHOWN HIDDEN
  LEFT,TOP,RIGHT,BOTTOM` measures the native side of a posed box. `SHOWN` and
  `HIDDEN` are two captures of the same held frame, the model shown and then
  hidden, as PNG (`decodePng`, wisp:host/fidelity/image.ts; RGBA keeps
  its RGB) or 8-bit binary PPM (`decodePpm`, wisp:host/contract/services.ts),
  and the box is Wisp's posed `box` for that frame in pixels.
  `silhouetteBounds(shown, hidden, near)` (wisp:host/render/screenBounds.ts)
  marks each pixel whose largest per-channel |Δ| is above 24, keeps the
  8-connected regions with a pixel overlapping `near` (the command passes
  Wisp's box grown by 20 px), and returns their box in pixel edges, or none.
  `compareEdges(wisp, native)` gives native minus Wisp per edge and `within`
  when all four are within 4 px, the per-frame test of wisp#125 box 3 (at
  1920x1080, 19 of 20 frames). The command prints the native box and the
  edges, or one JSON object with `--json`. Checked by a property over random
  backgrounds (wisp:test/screen-bounds.test.ts): with noise of |Δ| up to 24 on
  every pixel and a distractor blob outside `near`, the box equals the drawn
  connected blob's exactly.

- **Frame scale.** A frame's rectangle (wisp:src/headless/frames.ts) uses
  its size times its scale, where the scale is its own `BlzFrameSetScale`
  times every ancestor's, so children inherit it. Relative-point offsets
  (`BlzFrameSetPoint`, template points) are scaled the same way; absolute
  points (`BlzFrameSetAbsPoint`) are not, so the frame grows from its anchor:
  a scale-2 TOPLEFT frame keeps its corner, a CENTER frame stays centred.
- **The 4:3 cut.** A child of `BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, i)`
  whose left edge is below x 0 or right edge above x 0.8 has no rectangle,
  so `uiReport` gives it no row and it takes no clicks, at every screen
  width: native draws nothing outside the centred 4:3 area for those
  frames. Children of other frames, such as `ConsoleUIBackdrop`, are not
  cut. Native was measured only for frames wholly outside; a frame crossing
  an edge is cut by the same rule, unmeasured.

Both rules reproduce every native box of
[the frames125 fixture](#frame-scale-and-the-43-area-read-from-a-screenshot)
at 800x600 and at 1280x720 (client area 1276x716) within 1 px
(wisp:test/screen.test.ts, wisp#125).

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
  upstream tone mapping. Layers flagged Unshaded take no light. Each
  geoset's animated colour tints its texels first, lit or Unshaded, as
  native Classic does whatever the geoset animation's flags say. Unit vertex
  colour and effect colour multiply that tint and team colour; white leaves
  the model unchanged. Particles and ribbons retain their emitter colours. Lights are
  parsed from the whole file, including the 1200, 1300 and 1600 light fields.
  A day/night light with no ambient (intensity 0 or below) fills instead
  with the stock `ReplaceableTextures\EnvironmentMap`'s mean linear
  radiance (rows weighted by solid angle), and Classic materials then light
  in linear colour, texture × clamp(ambient + key × max(N·L, 0))^(1/2.2).
  The headless clock does not advance the time of day. Before the map sets
  day/night models, models draw unlit, as before.
- **Fog.** Linear fog by eye depth from `zStart` to `zEnd` in the fog colour.
  A height fog (style 3) draws its linear range, `linearStart` to
  `linearEnd`, capped at its maximum linear density. Additive layers fade to
  black, and Unfogged layers skip fog. Exponential styles are drawn as linear.
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
- **HUD text.** A text frame draws at its font height (`BlzFrameSetFont`, or
  the `font` a frame template declares) in UI units, 0.6 to the screen's
  height, times `BlzFrameSetScale`, placed by `BlzFrameSetTextAlignment` (or
  the template's `justify`) inside its rectangle, outlined when the font
  flags hold 1 (`OUTLINE`). A frame made by `BlzCreateFrameByType` with no
  template that has a `BlzFrameSetScale` draws at 0.0085 times that scale
  instead: Classic ignores the font height on such a frame (measured on
  build 24268), so Smashcraft's `sizeText` countdown, which sets a scale of
  `size / 0.0085` beside a font of `size`, is `size` tall in the Chrome window
  and the native window, not `size` squared over 0.0085 (`uiTextSize`,
  wisp:host/render/screen.ts; `font_size` in the native window's
  `ui/layout.rs`). A map declares a TEXT template from its own FDF in
  its headless `frames`, such as Smashcraft's `SmashcraftDamage` (`MasterFont`,
  0.036, `OUTLINE`). A `.ttf` or `.otf` file loads through the asset server;
  a font name such as `MasterFont` draws sans-serif. A frame with no font
  keeps the old 10-22 px, top-left text.
- **Text tags.** `CreateTextTag` and its setters (text and height, position or
  unit, colour, velocity, visibility, permanence, suspension, age, lifespan
  and fadepoint) are simulated; `captureScene` saves the shown ones as
  `textTags`. A tag that isn't permanent fades from its fadepoint and ends at
  its lifespan; velocity follows `TextTagSpeed2Velocity` (0.071 is 128 world
  units a second). A tag draws outlined over the world, its text's
  bottom-left at its place, under the UI.
- **Lightning.** `AddLightning`, `AddLightningEx`, `MoveLightning`,
  `MoveLightningEx`, `SetLightningColor`, its colour reads and
  `DestroyLightning` are simulated; `captureScene` saves live bolts as
  `lightnings` (code name, both endpoints, colour 0-1). A bolt with alpha
  above 0 draws as a 3 px line in its colour over the world, under text tags;
  its code name's texture isn't drawn.
- **World bounds.** With `render.terrain` (the map's `war3map.w3e`, or only
  its `bounds`, and `origin`, the map point the headless world's 0,0 stands
  on), an effect whose origin lies outside the world bounds is not drawn;
  units are not culled this way. The bounds run from the terrain's first
  point to its last: `columns - 1` and `rows - 1` cells of 128 from its
  origin, read from w3e versions 11 and 12 (wisp:host/terrain/terrain.ts).
  Native Classic, Smashcraft 56fb5249 on a base ending at y 4,096, Stratholme
  near view (8 Oct): the ruined cathedral at map y 5,944, 7,948 from the eye
  and in frame, isn't drawn, nor are Tomb's Temple of Tides and waterfall
  (y 5,344); the city gate at y 3,544 is.
- **Models that fail.** A model the renderer can't load or draw is left out
  of the frame and named on stderr and in `render.json`'s `notDrawn`; the
  rest of the frame still draws. The render command exits with a failure after
  saving its images, scene JSON and report. Standalone play stops with the
  same named drawing failure.
- **Placed doodads.** Give `render.doodads` the map's `doo` bytes and `models`,
  keyed by four-character object or skin ID. Each value is a model path or
  an array indexed by the placement's variation. Resolve these paths from
  the map's object data and the user's installed data tables. Version 8/11
  placements draw with their stored height,
  rotation, three-axis scale and visibility; `render.terrain.origin` shifts
  their X/Y coordinates. They use the same world-bounds and far cull as
  effects. Skin IDs are present by default; set `skinIds: false` for the
  older layout without skin fields. Missing model entries fail by name. Format fields follow the
  [doodad specification](https://github.com/ChiefOfGxBxL/WC3MapSpecification/blob/master/Doodads/8_11.md).
- **Special terrain doodads.** The trailing `war3map.doo` records draw their
  installed models when `render.terrain.w3e` is
  supplied. Their integer X/Y cells start at the terrain's south-west corner;
  the supporting point supplies height. Model fields come from the user's
  `Doodads\\Doodads.slk` and `Doodads\\DoodadSkins.txt`, with explicit
  `render.doodads.models` entries overriding paths. Stored variations select
  model suffixes, and installed fixed rotation and scale position the model.
  The shared effect world-bounds and far cull apply after shifting the origin.
  A model texture named `ReplaceableTextures\\Cliff\\CliffN` draws the
  `texDir\\texFile` of the map's first cliff type whose
  `CliffTypes.slk` `overrideTexture` names `CliffN`
  (wisp:host/terrain/terrainCliffs.ts).
  The record layout follows the [current HiveWE format documentation](https://github.com/stijnherfst/HiveWE/wiki/war3map.doo-Doodads).
  Terrain replacement under their footprint and matching native height and
  rotation references are still pending in #82.
- **Popcorn emitters.** External `.pkb`/`.pkfx` particle effects are recognized
  in Classic. Each saved
  frame's scene JSON has `popcornEmitters`: model path, model handle, emitter
  name, external `effect` path, world `position` and three-axis `scale`. These
  use the renderer's sampled node pose, including parents, pivots, animation,
  model rotation and scale. Emitters whose sampled visibility or alpha is zero
  are omitted, as are models culled by the renderer. The external effect's
  particle reach is unknown; an emitter with visible tracks is reported even
  when its current emission rate is zero. Wisp does not simulate these effects
  or decode the external file: a visible Popcorn emitter is reported present at
  its world position and scale and is no render failure. Its appearance is a
  native spot check.
  Each frame in `render.json` also carries `popcornEmitters` and an
  `unsupportedEmitters` inventory of every Popcorn and version-1 model
  particle emitter in the drawn models, including hidden emitters. Entries
  record `kind`, node `objectId`, sampled `visible`, `supported` (true for Popcorn presence, false for
  version-1 model particles), model, handle, name, external path, position and scale. An empty MDX name
  uses its kind and node ID. Visible version-1 model emitters still fail by
  name; hidden entries remain inventory only. A Popcorn record asserts
  presence and position, never fidelity.
- **Terrain.** Supply `render.terrain.w3e` to draw the map's ground grid.
  W3E corner heights and the map origin position the
  triangles; the last row and column stop at the map's world bounds. The
  camera projection clips these triangles, including ground outside camera
  bounds. `BlzShowTerrain(false)` hides them. The shared standalone renderer
  uses the same path. Ground IDs resolve through the user's
  `TerrainArt\\Terrain.slk`; its `dir` and `file` select tile textures using
  `render.readAsset`/`resolveAsset`. Mixed cells draw the lowest ID's full tile
  then higher IDs' corner masks. Extended atlases select variations left to
  right, then top to bottom; square atlases use their two full-tile variants.
  UVs stay half a pixel inside each tile to avoid sampling its neighbour.
  A blighted corner replaces its ground ID with the highest ground layer.
  Blight texture paths come from the map tileset's entry in the installed
  `UI\\WorldEditData.txt`, through the same asset callbacks.
  Cliff cells select installed models and
  textures through `TerrainArt\\CliffTypes.slk`, deforming their vertices by
  the corner heights. Stock model letters follow north-west, south-west,
  south-east, north-east; checked against the four single-high-corner meshes
  in 3.0.0.24268. CliffTypes' `groundtile` replaces ground and blight in a
  cliff's surrounding point neighborhood. Nothing from the install is included in Wisp.

  This terrain path is initial drawing support, pending the visible-terrain
  native reference in [#82](https://github.com/tompassarelli/wisp/issues/82).
  `--look terrain` still fails. Ramp model joins, special doodad terrain replacement and
  terrain lighting are unfinished.
  Ground variation, corner-mask and cliff filename facts come from the
  [HiveWE format documentation](https://github.com/stijnherfst/HiveWE/wiki/war3map.w3e-Terrain)
  (16 September 2025 revision); Wisp copies no implementation code from it.
- **Water.** Terrain water draws with `render.terrain.w3e`, over everything
  already drawn and hidden with the terrain (`BlzShowTerrain(false)`). A cell
  draws when any corner has the water flag (4); each corner's surface stands
  at its stored water level (low 14 bits of the second word, 0x2000 as zero,
  four steps a unit) plus the tileset's `height` in cells from
  `TerrainArt\\Water.slk` (row `{tileset}Sha`, from the install). Its colour and alpha by depth
  over ground run from `Smin` to `Smax` up to 64 units deep, then `Dmin` to
  `Dmax` at 128 (thresholds unmeasured), and dry corners are clear. Its
  texture is `{texFile}NN`, frame `floor(match frame × texRate / 60) mod
  numTex`, so a frame always draws the same one, repeating every `cells`
  cells. Fog applies. Not drawn: shorelines,
  lighting, `SetWaterBaseColor` and per-tileset texture folders.
  `render.json` records `water` per frame, and `milliseconds` each frame took.
  No native terrain-water reference exists yet; Smashcraft hides terrain and
  draws its sea as a model.
- **Sun shadows.** The day/night key light casts shadows: every
  drawn model's depth from the sun, an orthographic 4096² map over the
  camera's view out to 2.5 target distances and reaching 6,000 units toward
  the sun beyond it, sampled 3 × 3 with a two-texel bias. A shadowed fragment
  loses only the key light; ambient light stays. Layers that write no
  depth (blended, additive, particles, ribbons) cast none. `render.json`
  records `shadows.sun` per frame.
- **Colour pipeline.** Scene colour and resolve targets are `RGBA16F`;
  WebGL2 requires `EXT_color_buffer_float` and a shared colour/depth
  multisample count. Colours stay in display (sRGB-encoded) values from
  texture to output, so fog mixes, alpha blending and additive layers combine
  display values as Classic does; the output pass only clips to the display
  range. Running Classic flames confirm it
  ([wisp#22](https://github.com/tompassarelli/wisp/issues/22),
  wisp:docs/warsmash-notes.md, "ParticleEmitter2 emission area and
  blending"). UI and cinematic filters overlay
  this display output.
- **Not drawn.** Terrain lighting; `--look terrain` fails
  ([Graphics profiles](#graphics-profiles)).

| Check | Can close headless when | Still needs native |
| --- | --- | --- |
| A strike's model and pose on its first active frame | The same input replay and frame have a matched native comparison for that fighter/clip | Warcraft animation blending or a newly unsupported clip |
| A spell, projectile or passive pip is present and follows the declared state | Its models/textures or UI frames render and the declared look check matches native | Unsupported emitter behavior, lighting, occlusion or shader appearance |
| The game starts a named sound cue | The frame-stamped cue log passes the expected label/source/count assertion | Volume as heard, mixing, device output, automatic engine/model event sounds |
| Pause/resume clock and first drawn fighter positions | The real helper and map run with wall-time delivery, draw observations and a matching native pause reference | A pause capture whose helper or render timing has not been reproduced |
| General input latency, frame cost and native desync | — | Native outside a separately calibrated model |

Keep native and headless frames tied to the same map inputs, camera, replay
and match frame. A keyboard journey is not an analog pad replay. Consumers
with an existing headless pad path can call `captureScene(client)` at that
path's recorded match frame and `renderScenes(render, scenes, PRIVATE_DIR)`
after the run; no new input simulator is required.

### Graphics profiles

`--graphics classic` (the default and only mode) is the named profile of
Warcraft III 3.0.1's `[Misc] hd=0` (wisp:host/render/graphicsProfiles.ts).
Reforged (`hd=1`) is not a profile (Tom, 9 Oct). The profile says, per lever, whether Wisp draws it as that
mode does, whether that mode draws nothing for it either (absent), or
whether Warcraft draws it and Wisp does not (unsupported):

| Lever | Classic |
| --- | --- |
| `day-night-light` | drawn |
| `fog` (linear range, density cap, over sky) | drawn |
| `height-fog-falloff` | absent |
| `sky` | drawn |
| `cinematic-filter` | drawn |
| `point-lights` (model omni lights) | absent |
| `pbr` (HD materials) | absent |
| `point-light-shadows` | absent |
| `bloom` | absent |
| `ambient-occlusion` | absent |
| `shadows` | drawn (sun shadow map) |
| `water` | drawn (terrain water, Water.slk) |
| `terrain` | unsupported |

`--look LEVER,...` names the levers a frame's look check asks for. A render
asking for an unsupported lever fails before drawing, naming each one
("the look check asks for terrain, which Wisp does not draw in
classic"), so a check can't pass on a frame that lacks what it
judges. `render.json` records the profile's levers and the `--look` list.

#### Smashcraft's stage matrix

The levers Smashcraft's stage plan asks for per stage
(smashcraft:docs/design/visual-quality.md, "3.0.1 and Forsaken Kingdom"),
plus its #170 rubric's day/night light, fog and sky and "record any change
to shadows", for each of its 11 stages. Drawn levers are
listed first, then absent ones, then unsupported ones in bold:

| Stage | Classic |
| --- | --- |
| 0 Sky Deck | light, fog, sky, shadows; AO absent |
| 2 Frozen Throne | light, fog (height fog's linear range, cap, over sky), sky, shadows; falloff, bloom absent |
| 3 Durotar | light, fog, sky, shadows; falloff, bloom absent |
| 4 Naxxramas | light, fog, sky, shadows; omni light, point-light shadow absent; NaxxDeco0 absent |
| 6 Stratholme | light, fog, sky, shadows; omni lights absent; 2 models naming the missing `TerrainArt\Misc\misc_CharredEarth.blp` not drawn |
| 7 Tomb of Sargeras | light, fog, sky, ordinary waterfall, shadows; falloff absent (HD water skipped: terrain hidden) |
| 10 Nordrassil | light, fog, sky, shadows; bloom, falloff absent |
| 11 Gryphon Aerie | light, fog (GA-4 linear range, over sky), sky, shadows; falloff absent |
| 12 Blackrock | light, fog, sky, shadows; omni lights, bloom, AO absent |
| 13 Ahn'Qiraj | light, fog, sky, shadows; falloff absent |
| 14 Hellfire | light, fog, sky, shadows; omni lights, bloom absent |

#### Measured against Warcraft

Rubric: smashcraft#170's stage-light check, "neither |ΔL| nor ΔE00 falls
against stock", measured with `bun tools/stage/contrast.ts MASK STOCK STAGE`
(Smashcraft) on a stock / mask / stage triple. Headless triples: Smashcraft
main fe3fc382 with Wisp 86d2e37, `-dev quick stage N`, `-dev view off`, then at
frame 350 `-dev lighting stock`, `-dev lighting stock` with
`-dev backdrop off`, or `-dev lighting stage`, each its own run and drawn at
frame 410, so all three hold the same pose (the deterministic simulation in
place of the native pause, whose menu now covers the scene). Native
references: Warcraft 3.0.1.24342, Classic (`hd=0`), 8 Oct, client clone-a
(stages 2, 3, 12, 13, 1920×1080) and clone-d (4, 11, 1280×720); private.
Absolute values differ (other fighters, camera build and lighting
renderer); the verdict is what is compared.

| Stage | Classic native abs ΔL, ΔE00 stock → stage | verdict | Classic Wisp | verdict |
| --- | --- | --- | --- | --- |
| 0 Sky Deck | no reference | — | 0.6, 10.7 → 4.0, 11.4 | pass |
| 2 Frozen Throne | 3.9, 3.8 → 5.0, 5.5 | pass | 3.1, 7.9 → 4.8, 8.4 | pass |
| 3 Durotar | 7.6, 11.9 → 6.4, 11.7 | fail | 1.7, 31.5 → 5.0, 31.2 | fail |
| 4 Naxxramas | 5.6, 21.1 → 16.1, 23.7 | pass | 10.0, 16.8 → 12.4, 17.7 | pass |
| 6 Stratholme | no reference | — | 0.1, 13.6 → 2.3, 12.9 (2 models not drawn) | fail |
| 7 Tomb of Sargeras | no reference | — | 8.7, 24.1 → 12.2, 24.6 | pass |
| 10 Nordrassil | no reference | — | 15.6, 32.0 → 19.2, 32.3 | pass |
| 11 Gryphon Aerie | 0.7, 7.3 → 0.7, 7.3 | pass | 1.5, 17.6 → 9.5, 20.1 | pass |
| 12 Blackrock | 4.9, 9.6 → 5.0, 10.2 | pass | 14.2, 26.4 → 17.2, 26.6 | pass |
| 13 Ahn'Qiraj | 10.4, 14.5 → 9.9, 14.2 | fail | 1.7, 30.2 → 1.5, 28.7 | fail |
| 14 Hellfire | no reference | — | 12.3, 32.8 → 15.1, 32.6 | fail |

With sun shadows (wisp#79,
9 Oct; Smashcraft b859da4f with this Wisp, the same journeys and frame 410),
the Classic triples on the six stages with a native reference, abs ΔL, ΔE00
stock → stage: 2 Frozen Throne 2.0, 7.6 → 4.3, 8.2 pass; 3 Durotar 1.2, 31.6
→ 4.5, 31.3 fail; 4 Naxxramas 10.4, 16.9 → 13.1, 17.6 pass; 11 Gryphon Aerie
2.2, 19.4 → 9.4, 21.7 pass; 12 Blackrock 10.8, 26.1 → 14.5, 26.1 pass; 13
Ahn'Qiraj 1.5, 30.2 → 1.2, 28.8 fail. **6 of 6 agree with native, 0
disagree.** The frames that would confirm the rest are
native stock / mask / stage triples with the capture profile (shadows on)
for Classic stages 0, 6, 7, 10 and 14.

Classic: Wisp's verdict agrees with Warcraft's on 6 of the 6 stages that
have a native reference (2, 3, 4, 11, 12, 13), 0 disagreements. Drawing the
three frames at different match frames instead (one run, 60 frames apart)
flipped Blackrock to a false fail: its lava and platforms move between the
frames, so same-frame triples are the method. Missing references (5 of
11): Classic 0, 6, 7, 10 and 14. Stratholme (6) draws without the 2
models that use its missing texture (`notDrawn`), so its verdicts are
provisional.

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
the write. Setting yaw, pitch, roll or orientation after a matrix scale resets
that matrix scale to 1, as Warcraft does (wisp#118). `test/effects59/cases.ts` authors seven cases shared by Bun, Lua32
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

### Frame scale and the 4:3 area, read from a screenshot

`test/frames125/` ([#125](https://github.com/tompassarelli/wisp/issues/125))
draws flat team-colour BACKDROPs: two at `BlzFrameSetScale` 2 placed by an
absolute TOPLEFT and CENTER point, one at scale 2 placed relative to an
unscaled anchor with an offset, an unscaled child of a scaled frame, two
`GAME_UI` children at x -0.05 and 0.82, and one child of
`ConsoleUIBackdrop`. One second after start it writes `frames125-p0.txt`
(`ready=8` and the client's width and height). `read.ts` prints each
colour's largest pixel box and its top-left and size in UI units under the
4:3 rule; `expected.ts` keeps the native boxes.

```sh
bun test/frames125/build.ts BASE.w3m PRIVATE_OUT.w3x
bun wisp lan solo PRIVATE_OUT.w3x --pair K
bun test/frames125/read.ts CAPTURE.png
```

Measured at 800x600 on 3.0.0.24268 (11 October 2026): scale multiplies a
frame's size and its relative-point offsets, and the scaled frame's children
inherit it (size and offsets). An absolute point is not scaled: the frame
grows from that point (TOPLEFT stays put, CENTER stays centred). Frames
wholly outside x 0..0.8 are not drawn at 4:3.

Measured at 1280x720 (client area 1276x716, the visual profile): the UI is
the 4:3 area centred on the screen, one UI unit being 716/0.6 px and x 0
falling at (1276 - 0.8 × 716/0.6) / 2 = 160.7 px; every drawn box lands
there to the pixel. The `GAME_UI` children at x -0.05 and 0.82 would sit on
screen (at 101 px and 1139 px) and are still not drawn: a `GAME_UI` child
outside x 0..0.8 is not drawn on a wide screen either.

### Team glow drawn on a flat quad, read from a screenshot

`test/glow6/` ([#6](https://github.com/tompassarelli/wisp/issues/6)) draws
one flat quad facing the camera with an additive ReplaceableId 2 layer, as an
effect coloured by a red Player 0, and then its twin, the same quad with our
own 32×32 radial texture (`textures.ts`, written as a grey-palette BLP), and
then neither, 12 s each on a black board. The camera looks 15° off straight
down, so screen up is world +y in both Warcraft and Wisp. Each phase writes
`glow6-p0.txt` (phase, client size, Player 0's colour, camera fields, target
and eye). `oracle.ts` runs the map headless and predicts each quad's added
light per pixel with Wisp's texel rule (top mip, bilinear,
perspective-correct, colour × alpha × layer opacity) through `camera()`;
`read.ts` compares shown minus hidden with it: per channel the largest and
95th-percentile level difference, the gain, the radii where each profile
falls to half and to 2 levels, and the 1 px radial profile.

```sh
bun test/glow6/build.ts BASE.w3m PRIVATE_OUT.w3x
bun wisp lan solo PRIVATE_OUT.w3x --pair K
bun test/glow6/oracle.ts TEAMGLOW00.png PRIVATE_ORACLE [DX,DY]
bun test/glow6/read.ts PRIVATE_CAPTURES PRIVATE_ORACLE
```

Measured on 3.0.0.24268, Classic `capture-classic-1080`, 25 October 2026:
both quads match the rule. The team-glow quad differs by at most 3.9 levels
(95th percentile 1.8), its twin by at most 2.8 (1.8), each about 2% brighter
in sum with half-maximum radii 1 px wider, and every 24-level box edge within
1 px. With these camera fields read back unchanged, native draws both quads
169.6 px higher than `camera()` places them and no wider, so the oracle is
registered by the twin's centroid (`DX,DY` 0,-169.6).

### Team-glow plane replicas and the real body at Smashcraft's camera

`test/glow6e/` ([#6](https://github.com/tompassarelli/wisp/issues/6)) holds
W2's Warden forward-air frames 57, 58, 60 and 61 at the camera and place the
W2-flat headless scenes record. It shows each frame's glow three ways as our
own models, built from Wisp's pose of the glow geoset: its 8 planes on
billboarded bones (`planes`), the same planes frozen where Wisp turns them
(`flat`), and the billboarded planes with the 3 static floor quads (`all`).
It also shows the real body with and without the glow geoset, and a
billboarded twin of our own texture at the camera target for angles of
attack 350°, 330°, 310° and 285° and at C1's camera. Phases last 6 s on a
black floor and wall. `build.ts` takes the glow-free body and the model its
glow geoset comes from as private inputs. `oracle.ts` predicts each phase's
added light per pixel by Wisp's texel rule summed over overlapping
triangles, and `read.ts` compares shown minus hidden (the body with glow
minus without) with it.

```sh
bun test/glow6e/build.ts BASE.w3m GLOW_FREE_BODY.mdx GLOW_SOURCE.mdx PRIVATE_OUT.w3x
bun wisp lan solo PRIVATE_OUT.w3x --pair K
bun test/glow6e/oracle.ts TEAMGLOW00.png build/glow6e/assets PRIVATE_ORACLE
bun test/glow6e/read.ts PRIVATE_CAPTURES PRIVATE_ORACLE
```

Measured on 3.0.0.24268, Classic `capture-classic-1080`, 25 October 2026:
every replica matches Wisp's prediction on all four frames (light sums
within 0.2%, centroids within 0.13 px, 24-level boxes within 1 px), so
native orients, sizes and adds billboarded team-glow planes as Wisp does.
With the body's timeline time set again every 1/32 s, its glow ends within
1 px of Wisp's prediction on the right, top and bottom of every frame. The
twin sits where `camera()` puts it at 350°, but higher at steeper angles:
27.8, 79.9 and 169.4 px at 330°, 310° and 285°, and 169.65 px at C1's
camera, whatever the distance or field of view.

## Warcraft 3.0 natives

The typed API is generated from the installed 3.0.1 build 24342 `common.j`
and `Blizzard.j`. The nineteen equipment natives renamed in 3.0.1 are
declared only with their `Blz` names. The installed script names the music
native `BlzSetThematicMusicAbsoluteVolume`. No dedicated Ability Amp, Crit,
or Resolve stat native or unit field is exposed there; the new ability
level fields are declared as the script defines them.

```bash
bun host/toolchain/natives.ts /private/common.j /private/blizzard.j src/natives/warcraft.d.ts
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
The Warcraft 3 native fixture (wisp:test/headless-warcraft3.test.ts) exercises 92
scenery native calls in Bun and Lua32, with zero missing-native reports.

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

The 9 October 2026 Warcraft 3.0.1 reference for #35 ran `TableOrder.w3x`
in one healthy match on clients B and C. Both returned all 1,000 string keys
and 1,000 sparse integer keys, with order checksums 19,332 and 59,101.
The two 106,725-byte outputs are identical after excluding `player=0` versus
`player=1`: zero differing lines. Every key and value matches the fixture,
and folding the recorded values reproduces both checksums. No desync report
was written. This measured result requires no unordered-iteration rule.
The reference files are private at
`~/.local/state/wisp/table-order-35-20261008/client-{A,B}.txt`;
[the native run](https://github.com/tompassarelli/wisp/issues/35#issuecomment-6064849160)
records the session. The launcher reported a selection-screen timeout after
the game started because this fixture has no Smashcraft selection screen;
both clients nevertheless completed the fixture and wrote their output.

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
models increases its counts to 1970/2260/0 and agreement to 11/14.

The renderer now multiplies each layer's alpha by its geoset's animated
alpha and blends additive layers with source alpha, so fades scale what an
additive layer adds. Particle texture cells repeat past the grid's last cell:
ledge dust's 1×1 Dust5A grid had been sampled outside the texture and drew
nothing. Emitters run one frame behind animation time, and each step poses
the model at that step's own time (wisp:host/browser/emitters.ts).
A squirt fires only when emitter time reaches its key: Frost Nova's ring,
keyed at 33 ms, is absent two frames in, as natively. On all 42 frames:

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
fades every layer once. With the map's sky drawn, two further
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

Re-rendered on 9 October 2026 with the renderer of that day (sky drawn,
terrain hidden), all 42 frames give the same 12/14. The electric
disagreement is the halo geoset: ForkedLightningTarget's geoset 0 holds three
Blue_Glow2 quads (one billboarded, two flat) and geoset 1 the LightningBall
star and its flat quad. The native +2 frame shows the star and its flat
quad's thin line but no halo. Electric hit / electric shield +2 counts by
headless variant:

| Variant | Electric hit +2 | Electric shield +2 |
| --- | --- | --- |
| Native | 889 | 424 |
| Headless | 4352 | 3223 |
| Without geoset 0 (halo) | 1019 | 469 |
| Halo's billboarded quad and star removed | 2504 | 1791 |
| Birth sampled at 0 ms | 1232 | 756 |
| Birth sampled at 0 ms, without halo | 445 | 110 |
| Additive opacity squared | 2419 | 1651 |
| Additive blended in linear light (estimate) | 1751 | 1318 |

Squaring additive opacity takes floor, wall and ceiling tech and ledge
catch +8 to 0, against native ~1,700. Blending additive layers in linear
light drops ledge catch +8 to 27, against native 1,430. Neither rule is
the engine's. Both layers share filter mode (Additive), shading flags,
layer alpha, geoset alpha track and texture flags, so filter mode,
material alpha, geoset alpha and the additive blend rule are not what
separates the halo from the star. The two differ only in texture
(Blue_Glow2's opaque 32 × 32 colour peaks at blue 132, LightningBall reaches
white) and in bone. Without the halo, the electric hit +2 count is still
19 pixels over the 1,000 threshold. The cause stays "other" until one
native frame of a Blue_Glow2-only model is captured.

On 9 October 2026 both electric cases were retaken on the offline Classic
pool (lan1a, 3.0.0.24268, `capture-classic`, 1280 × 720 game area), with the
stock model, a halo-only copy (geoset 1 alpha 0, emitters off) and a
star-only copy (geoset 0 alpha 0). The captures are +2, +8 and +20 frames
after the spawn frame, and the sample time below comes from the picture. Counts use the same
rubric at 1280 × 720, where 1,000 pixels at 1920 × 1080 is 444:

| Case | Variant | Native +2/+8/+20 | Headless +2/+8/+20 |
| --- | --- | --- | --- |
| Electric hit | Stock | 755/353/0 | 1989/0/0 |
| Electric hit | Halo only | 726/353/0 | 1989/0/0 |
| Electric shield | Stock | 611/0/0 | 1432/0/0 |
| Electric shield | Halo only | 499/0/0 | 1432/0/0 |

Native draws the halo. In native electric hit, 353 of the +2 pixels are
two stage-edge rows that also differ at +8, and in electric shield 197 are
the dev receipt text; headless has 179 stage-edge pixels in hit and no
receipt. The halo's own pixels are 373 (hit) and 302 (shield) natively,
against 1,810 and 1,253 headless. The star-only copy changes no pixel
between +2 and +8 natively, while headless draws about 72 star pixels. The
native halo matches headless with Birth sampled at 0 ms (418 and 335 halo
pixels; 8 ms gives 590 and 472). So at the +2 hold native shows
ForkedLightningTarget at the start of Birth, where headless has advanced it
33 ms. The same read shows the native sim running frames in bursts (frames
81 to 87 within 33 ms after a resume), which suggests the effect's clock
follows drawn frames rather than sim frames; that rule is not yet measured,
so the renderer is unchanged. Under the scaled threshold, native Classic
passes both electric cases on its stage-edge and receipt pixels, while the
halo alone (373 and 302) would fail.

### The effect clock

Wisp models no step rule for effect clocks. They advance once per drawn
frame, which the 3.0.1 #58 rulers pin. They advance lazily: each pose takes
the drawn frames it missed when the map changes its animation, time scale or
time, or something reads it (`effectPoses`, renders, scenes), with the same
binary32 additions per frame, so every read matches per-frame stepping bit
for bit (`settleAnimation`, wisp:src/headless/animation.ts; #126).

An outside measurement of a stepped clock on Classic 3.0.0.24268 was
attempted ([wisp#72](https://github.com/tompassarelli/wisp/issues/72);
captures `w4b-ruler-a` and `w4d-ruler-a`) and read no usable pose, so no
step rule is kept ([Principles](../README.md#principles)).

The f9d0fbf3 frames above were also graded by the 8 October native batch's
1,000-pixel rubric against headless scenes whose +2 frame sampled each
effect 0 ms into Birth. That sampling came from the removed step rule;
drawn once per frame, headless samples +2 at 33 ms, as in the 9 October
table above. The comparison stays as outside evidence of how the pictures
differ:

| Case | Native +2/+8/+20 | Headless, +2 at 0 ms |
| --- | --- | --- |
| Electric hit | 889/256/0 | 1271/269/0, disagree |
| Ice spark | 19072/0/0 | 11331/0/0, agree |
| Electric shield | 424/0/0 | 775/0/0, agree |
| Other 11 cases | as above | agree |

That is 13/14 agreeing. Electric hit's remaining 271 pixels over the
threshold are the Blue_Glow2 halo and the stage-edge rows above. The capture
maps are private in `~/.local/state/wisp/ref-72-clock/`.

Only measured numbers and authored code are kept here. Screenshots, stock
models and textures stay in private local storage under the clean-room rules.

## Boundaries

The runtime emulates natives; it is not Warcraft. It has no engine frame
timing, terrain, pathing, combat, real input devices or Battle.net
beyond the [measured sync latency](network-model.md), and it emulates only
natives a map has needed. A standalone game is held to its
[standalone profile](#standalone-profile). A program that reads real devices can type into
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
(`desync`, `error`, `scene`, `check-fail`, `missing-native` or `outside-profile`), `frame`, `client`, and `message`.
Missing-native and outside-profile records also include `native`, its exact declared name.
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
