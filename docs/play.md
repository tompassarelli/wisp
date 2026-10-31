# One command to a match: `wisp play`

`play` takes the owner from their desktop to a match on their own display.
It is the owner's normal playable path. A consumer such as Smashcraft resolves
current main and builds its matching map and controller helper before calling
Wisp. Experimental candidates use `fresh`, captures or `accept`; they do not
replace the owner's play declaration. Consumer-owned versioned map libraries
can set `GameFiles.layer({ ..., preserveMaps: true })` and install diagnostics
in a `tests/` subfolder; menu hosting accepts nested map folders.
It reports each step on one line and stops at the first problem with a plain
message that says what to do. Native play accepts `--lobby-only [MAP.w3x]` to install the requested map and stop in a hosted Classic offline LOOP lobby. It reuses the running launchers and client, refuses an active or unreported session, never starts the lobby, and prints `LOBBY-READY MAP.w3x screenshot=PATH` only after hosting, the declared controller/readiness checks and a screenshot. Launcher or game updates have a ten-minute wait; credentials are never typed. The consumer reserves its game slice before calling this mode; the lobby launch request runs in `playtest.slice`. A running client must already use the declared graphics mode. Without this flag, native play uses its declared map and starts the match. Games may also
declare [standalone play](#standalone-window).

```text
1/7 Wine prefix: free
2/7 Battle.net: starting the Steam shortcut "Warcraft III (Battle.net)"
2/7 Battle.net: started and signed in (27 s)
3/7 Warcraft III: Battle.net started it
3/7 Warcraft III: running (pid 2852), asked to go fullscreen
4/7 Map: Warcraft III signed in and read its ladder maps (27 s); hosting the map
4/7 Map: "Smashcraft" of Smashcraft 0.0.47 hosted through the menus (joining by name is case-sensitive)
4/7 Map: fighter selection 35 s after launch
5/7 Controller helper: running (pid 41234), log ~/.local/state/smashcraft/play-helper.log
6/7 Match: computer as Player 3
7/7 Fullscreen: Warcraft III is fullscreen and focused. Ready to fight.
```

Before step 1, and once more after a failure, `play` runs
[`doctor`](doctor.md) on its prefix when the game gives it `wisp client watch`'s
ClientWatch (`makePlay`'s fourth argument). Doctor ends a second runtime, a
runtime without Battle.net, a crashed game and its error dialog, a game that
lost Battle.net, sits at the empty login shell, loaded the map without its
imports or is stuck loading, leaves an earlier lobby, or an earlier score screen with Escape in the
game's window, and
restarts a launcher whose connection is failing; when it recovered
something after a failure, `play` runs once more. It leaves launching the game to
the steps below, and stops with one line when the launcher needs its owner
to sign in. Without a watch, step 1 refuses these states and prints the
command that clears them.

1. **Wine prefix.** Separate Steam runtime containers each start their own
   wineserver against one prefix, and a launcher started beside another
   runtime can't start the game. `play` refuses two runtimes, a runtime on
   another display, and a runtime without Battle.net (after allowing it 20 s
   to exit), and prints the `kill` command that clears it. It finds a
   prefix's wineservers by their `WINEPREFIX` and, for one started in another
   namespace, by the server directory Wine names after the prefix's device
   and inode (`server-DEV-INODE`).
2. **Battle.net.** A running, signed-in launcher is reused; otherwise Steam
   starts the game's shortcut: a non-Steam shortcut's URL is
   `steam://rungameid/` followed by its 32-bit app id shifted left 32 bits,
   OR 0x02000000 (`steam -applaunch` takes only Steam's own app ids). Signed
   in means the newest `battle.net-*.log` containing a BNLogin event in `AppData/Local/Battle.net/Logs`
   has `Logged into Battle.net successfully`. Newer `--exec` request logs have
   no login event and are ignored for sign-in and launch confirmation. A
   launcher restarted by doctor cannot reuse a prior session's login log.
   `play` never signs in or out.
   Warcraft III's launch options (Battle.net's "Additional command line
   arguments", `Games.w3.AdditionalLaunchArguments` in the prefix's
   `AppData/Roaming/Battle.net/Battle.net.config`) must not load a map at
   startup (step 4). Earlier Wisp runs set `-loadfile` there for this map;
   Battle.net reads the options when it starts and writes its settings back
   when it exits, so that argument is removed while it isn't running,
   ending a running launcher first. Other options stay in place; a
   `-loadfile` for another map stops `play`.
3. **Warcraft III.** The map is copied in from its declared build when its
   folder lacks it, and the game's `prepare` leaves what the map reads at its
   start. `play` then asks the running launcher to launch Warcraft III with
   Battle.net's own `Battle.net.exe --exec="launch W3"`, run inside the
   launcher's Steam runtime container: `nsenter`, resolved to an absolute host
   path before adopting the launcher's environment, joins the launcher's user
   and mount namespaces (they are the owner's) with its environment and
   folder. Each container has its own `/tmp`, where Wine keeps the
   wineserver's socket, so a Battle.net.exe started outside would start a
   second wineserver on the prefix; inside, it reaches the launcher's. The
   second Battle.net.exe hands the command to the running launcher
   (`Received IPC Message: IPC_COMMAND` in its log) and exits. The request
   runs inside `machine-capacity session --class native --wait-seconds 1800
   --owner wisp-game-<client>` (`play` uses `play`), resolved with `agents path
   machine-capacity` as `lan pool` does, so whatever it starts lives in a
   `native.slice` scope and passes CPU, memory and GPU admission instead of
   joining the calling terminal's scope (`nsenter` keeps its caller's
   cgroup). The helper runs with the host's `PATH`, `XDG_RUNTIME_DIR` and
   `DBUS_SESSION_BUS_ADDRESS`; `env` restores the launcher's values before
   `nsenter`. A deferred launch waits in the helper's arrival-order queue
   rather than asking again on a timer, so a client or GPU job that asks
   later can't take the slot it waits for (wisp#76). It prints `<client>:
   waiting in the capacity helper's queue to launch Warcraft III (<reason>)`
   for each new reason, stops after 30 minutes without admission, and fails
   when Battle.net.exe hasn't exited 30 s after admission. Nothing is
   clicked in the launcher's window, whichever game or page it shows (on 6
   Oct, two main-display runs that clicked through its Games tab and Play
   stopped on a stuck pointer and on a page without them). The launcher
   must be signed in to an account that owns Warcraft III: for one that
   doesn't, it only selects the game (`Selecting game family by id: W3`).
   Before the game starts, `play` saves War3Preferences.txt and a detached helper puts it back when the game exits ([display-settings.md](display-settings.md)).
   Only the log lines written after the request decide: no `LaunchBinary:
   uid=w3` within 15 s means it didn't launch, and `play` stops there;
   `Game is running: w3` is a launch (1.4 s after the request on 6 Oct), and
   `Could not launch ... Warcraft III.exe` or an expired pending launch is a
   failure. On a failure it ends every program of the prefix, waits for
   Steam to see the shortcut end, starts the launcher again alone and asks
   once more. It never starts Warcraft III.exe itself. `play` asks for fullscreen as soon
   as the game's window appears; a game loading takes a while to follow
   (more than 5 s on 6 Oct), so the menus and step 7 wait up to 45 s, and
   once it is fullscreen a capture of its output is the game's frame.
4. **Map.** After the login doors close, Warcraft III opens every map of
   the ladder pools in `Maps/Download/SeasonN/` as its active mod (6 Oct:
   Season1's twelve, then Season9's ten, 8-12 s after
   `[CLoginCallbacks] LoginDoorClose called` in
   `Documents/Warcraft III/Logs/War3Log.txt`). A map that loads during that
   scan can't read its own imported files: each `-loadfile` run on 6 Oct
   logged 326 `model creation failed - war3mapImported/...` lines and drew
   neither stage nor fighters, and the one `--menus` run that created its
   lobby 27 ms after the scan's last map (its map listing ran between the
   two batches) crashed Warcraft III while loading. Maps hosted after the
   scan loaded with no failure. So `play` never loads the map at startup
   and hosts it only once the game's own log (this launch's, not the one
   launch replaces) shows the scan over: a line at least 2 s after its last
   ladder map, or 2 s with nothing new. A game that signed in and opens no
   ladder map within 30 s of its sign-in, by the clock of the log or of
   `play`, is hosted anyway, so a running game that never scanned but played
   since is hosted at once. The menu connection can establish
   sign-in when the log hasn't written its login line. Without either source
   establishing sign-in within 120 s, `play` stops. Warcraft III already past
   its scan is hosted at once. A running match is first left through Game Menu,
   End Game and Quit Mission, retaining the signed-in game; its results screen
   closes with Escape in the game's window: Warcraft III 3.0.0.24268 ignores the
   menus' `ScoreScreenClose`. Hosting goes only through the game's menu page
   on `menuReportPort` ([driving-warcraft.md](driving-warcraft.md)): a
   private game with a random password, then its start. When the page doesn't
   report within 3 s, `play` stops and names `wisp menus install`, which the
   account owner runs once per prefix; it never creates a game by clicks,
   since Battle.net lists a game without a password publicly. The step ends when the game's `started`
   resolves, and prints the time from the launch to fighter selection. Any
   `model creation failed - war3mapImported/` line the log gains from
   hosting on, checked then and again after step 6, stops `play` with the
   count and the first model. While steps 4 and 6 run, a crash report for
   this session or a lost Battle.net ([watch.md](watch.md)) stops `play` at
   once instead of at the step's timeout.
5. **Controller helper.** One helper for this game: a running helper whose
   `--pid` is this game's is kept; any other running copy stops `play`. The
   helper starts in its own session, so it outlives `play` and its terminal,
   and must print its ready line within 10 s. It starts before the match, so
   the player's pad plays from the first frame. A game whose controller
   runs as an always-on service declares `helper: { service }` instead:
   play starts no helper and waits on `service(game)`, which resolves with
   what the service says once it serves this game.
6. **Match.** The game's own step: it sets up and starts the match, its
   opponent included, by calling the map's code, not its menus.
7. **Fullscreen.** The game's window is fullscreen and focused, so the
   compositor's focus-follows-mouse has no other window to move to.

## Declare it

The game declares its playtest (wisp:host/play/play.ts,
`PlayDeclaration`) and adds the command with `makePlay`
(wisp:host/commands/play.ts); its own steps may use services that
`layer` provides:

```ts
export const play = makePlay({
  prefix: join(homedir(), ".local/share/Steam/steamapps/compatdata/3516115571/pfx"),
  display: ":0",
  shortcut: { appId: 3775098022, name: "Warcraft III (Battle.net)" },
  map: { folder: "00-Smashcraft", file: "Smashcraft 0.0.47.w3x", title: "Smashcraft 0.0.47", source: BUILT_MAP },
  gameName: "Smashcraft",
  menuReportPort: 47124,
  prepare: (documents) => /* the map's request file in CustomMapData */,
  cleanup: (documents) => /* removes it when a run stops */,
  started: (game, since) => /* the map's first-screen file, newer than since */,
  match: (game) => /* the go-ahead the map waits for, then its receipt; "computer as Player 3" */,
  helper: { binary, args: (game) => /* game.pid, game.window, game.xWindow.id, ... */, ready: /waiting_for_match/, log },
  // or, with an always-on controller service: helper: { service: (game) => /* waits until it serves game.pid */ },
}, gameFilesLayer, tools);
```

## What it needs

The owner's niri session (`niri msg`), `grim`, `tesseract`, `xdotool` and
`steam`, and Wisp's menu page installed in the prefix; each is looked up on PATH unless the game passes its
path in `tools`. The game runs on the declared X display under niri's
Xwayland (xwayland-satellite). Every wait has a bound (`PLAY_TIMEOUTS`); none
is a readiness delay.

Keys are XTEST (`xdotool`) into the focused game window, only to leave a
running match.

The fakes in wisp:test/play.test.ts cover each step's success and failure
messages with the recorded window, log and process shapes. Hosting goes through a
fake menu page there; the real page's answers are covered by
wisp:test/menus.test.ts and native runs.

## Standalone window

A game can route `wisp play --standalone` to `runStandalone` from
`wisp/scripts/wisp/standalone`. It opens Chrome in a separate window and runs
the map's headless callbacks once per frame, paced at 60 steps per second.
Models, textures, camera and UI use the same renderer as headless captures.
The asset reader supplies private map imports and installed Warcraft assets.
Live frames copy only visible effects and UI, including each frame's parent visibility;
requested captures retain the full scene snapshot.
The window loads the visible scene's models and textures before its first input
step. Hidden pooled effects and UI load when shown, so an unused stage's assets
cannot block startup. A live frame draws the models that have loaded and loads a
newly shown model between frames, so a first appearance never stalls the window;
captures wait for every model. Instances share each texture's decoded pixels,
and every renderer shares one compiled shader program per shader pair. A model
without particles or ribbons keeps nothing between frames, so when its effect
leaves the scene its instance waits for the next effect with that model instead
of being rebuilt. Each frame poses a model once, for its shadow pass and its
draw, and poses only the bones and emitters that place something. Model initialization leaves animation clocks and particles unchanged;
`render.preloadModels` lists any additional models the map creates later, and
`render.preloadTextures` any texture files it shows outside a model, such as
interface images, so the native window remasters both while the player is in the menus.
`standalone.json` records startup time and the prepared asset counts separately
from the match's frame timing.
The page is cross-origin isolated (`isolated` in `standalone.json`), so its
timers and frame timestamps are precise to 5 µs rather than 100 µs with random
jitter. In live play the browser keeps one frame request ahead of the scene it
draws: at each display frame it reads the input, sends it, and draws the scene
stepped from the previous frame's input while the map steps, so each scene shows
input read one display frame earlier. A script has no live input, so its run
keeps three requests ahead and a slow step doesn't miss a display frame.
Frame requests and scenes travel over one WebSocket (`/frames`); a fetch per
frame spent about 10 ms in the browser's request handling under load. Each
request advances one step, in request order, and the page requests no step past `frames`.
It keeps animation callbacks registered throughout drawing and waits for a fresh
callback to deliver each scene. Idle callbacks do not count as delivered frames.
Sound labels resolve through the installed sound tables. Sound downloads run
four at a time so slow asset loading leaves connections available for game
frames. Decoded sound assets are reused by resolved file path, preserving each
handle's selected variation. Assets remain outside Wisp. Closing the window
closes the game session.
Press-to-pixel latency and frame-time stalls against the Warcraft build are measured in
[Input-to-display latency](online-plan.md#input-to-display-latency); `wisp perf latency --window chrome|warcraft|native`
(wisp:host/play/pressLatency.ts) repeats the press timing for any window, to within one display frame; `wisp perf latency --check` proves that against a page of known delay.
Like `headless --render`, `runStandalone` refuses a headless, scripted or capturing run (`--headless`, `--script`, `--out`, `--capture-frames`) outside a gpu
machine-capacity lease where the helper is installed, naming the lease command
to rerun it under ([Rendered frames and sound cues](headless.md#rendered-frames-and-sound-cues)).
The window a person plays opens without a lease, and `gpuLease: false` in `StandaloneOptions` skips the check for a scripted run that holds none.


### Native window

`play --standalone --window native` opens `wisp-window` (the Rust library in
`window/`, planned in [native-window-plan.md](native-window-plan.md)) instead of
Chrome, and `chrome` stays the default. A game reads the flag with
`standaloneWindowArgument` and passes `window` in the options of
`runStandalone`. Bun loads the library with `bun:ffi` from
`WISP_WINDOW_LIBRARY`, else beside the executable, else `window/target/release`, else
the build of the package's `window/` source in `~/.cache/wisp/window`, which the command builds on
its first run ([Where a consumer gets the library](native-window-plan.md#where-a-consumer-gets-the-library-wisp130)). The library runs the
window and a render thread; the render thread acquires the next `Fifo` image and
samples the held keys onto a queue of 8. The game's thread takes the samples in
order with `wisp_window_next_event`, which blocks on a Rust condvar until one is
queued, the window closes or fails, or `wisp_window_stop` is called, so it
waits without running JavaScript and no callback crosses into Bun. The native
window requires `nativeGame` in the options (the module path and export name
that a worker thread imports the game from, because a game object cannot cross
threads) and refuses `--net` until the netcode moves onto it (wisp#107). The
worker owns the frame loop: it blocks in `next_event`, steps the map once,
gives the scene back as JSON in one call, then yields one `setImmediate` turn so
timers and `readAsset` completions run; Bun's main thread only opens the window
and waits for the worker's `completed`, `closed` or `failed`. The worker holds
its own counted reference to the window (`wisp_window_attach` and
`wisp_window_release`), so closing the window never frees it under a worker
that is still running. The render thread sleeps from each acquire to the sample point (T minus the p99 of the
last 120 frames' sample-to-scene and scene-to-present times, minus a margin that starts at
1 ms, grows 0.5 ms on a late scene or missed present and gives it back after 600 clean
frames), samples there, and waits for the scene until the scene deadline (T minus the p99
scene-to-present time, the p99 lateness of the render thread's own wakes (at most 2 ms) and the margin). Each frame's timing is anchored to a vblank extrapolated from the display's learned phase, so a late wake from the acquire does not push the deadline past the next vblank. It draws the newest
scene that has arrived and redraws the last one when none has, so a late game
never makes a present miss its vblank; a scene that missed its deadline is
counted in `lateScenes` and drawn on a later frame. Above 60 Hz the game still steps 60 times a second: a step runs on the first vblank whose
acquire is at or after its due time and the vblanks between redraw the last scene. The due time advances by exactly 1/60 s from the first step, so 120 Hz steps every second vblank, 144 Hz every second or third and a display a little off its rate (119.88 Hz) still averages 60. A frame that comes later than one step (a missed vblank, or a display or GPU that cannot hold 60 Hz) queues one sample for every step that came due, up to six (a frame rate as low as 10 Hz), so the game keeps its speed and drops frames instead of playing in slow motion; after a stall of more than six steps the clock restarts one step ahead of the acquire instead of stepping to catch up. The tests in `pacing.rs` hold 600 steps (plus or minus 1) in ten simulated seconds at 120 and 144 Hz, 600 less at most the last frame's steps at 50, 40, 30, 20 and 10 Hz, and one step per vblank at 60 Hz. Every five seconds the window prints its presented frames per second with the frame time's p50 and p99, the game's ticks per second, the acquire and draw p99 and the late scenes and dropped samples to standard error, so a slow window says which of them is short. A game linked against a Wisp from before this gate (Smashcraft's pin until it moves) steps once per display frame and runs at double speed on a 120 Hz panel.

`--emulated-calls FILE` (read with `standaloneEmulatedCallsArgument`, passed as `emulatedCalls` in `StandaloneOptions`) works in either window: when the run ends it writes the headless client's emulated-native call counts to FILE, a JSON object of Warcraft native name to count with the names in order and a native never called absent. A migrated game API family reads zero there ([game-api-plan.md](game-api-plan.md#warcraft-backend-lowering-and-the-lua-cost-rule)).

`WISP_WINDOW_PRESENT` (`Fifo`, the default, `Mailbox` or `Immediate`) and
`WISP_WINDOW_FULLSCREEN=1` (borderless fullscreen) set the present path of an `openNativeWindow`
that names neither. A mode the surface does not offer falls back to `Fifo`; `standalone.json`
reports the mode granted and `imageCount`, the distinct images `Fifo` handed back, because
wgpu clamps `desiredMaximumFrameLatency` and does not report the swapchain's size. Under
`Mailbox` and `Immediate` the acquire does not wait, so the window sleeps to the vblank
extrapolated from the phase a `Fifo` acquire learned. Box W1 draws only a clear colour and the step as 24 lit squares, and it
shows the loading and ready text in the window's title. The scene is parsed in
the library on every frame, so the cost of encoding and parsing it is measured
before the renderer is ported. Keyboard and pads (box W5: the left stick and the standard-layout buttons of the
first connected pad, or `gamepadIndex`, read at the sample point and cleared with
the keys when the window loses focus); captures and
`--headless` stay with Chrome (`--capture-frames` with the native window is
refused). Sound plays through cpal: the game's cues resolve as the page's do, decode once per resolved file (Vorbis, MP3, FLAC and PCM WAV) and play at `volume / 127` and the cue's pitch as a playback rate; `standalone.json` carries the page's `audioEvents`, `audioReadyEvents`, `audioPlayed`, `audioDecodedAssets` and `missingSounds`, with `audioOutput` naming the device (or `none`). `standalone.json` keeps the page's fields and adds `adapter`,
`backend`, `presentMode`, `desiredMaximumFrameLatency`, `wakeMs`, `encodeMs`,
`parseMs`, `inputToPresentMs` (the present time minus the sample time of the scene
drawn), `missedPresents` (an acquire interval over 1.5 T, with
`missedPresentsAfterLateScene` for those that follow a late scene), `lateScenes`
and `droppedSamples`; `presentedMs` is the interval between two images the
display handed back. Closing the window ends the session.

An agent that opens the window for a person to play starts it in that person's slice, not under `run-bounded` or a machine-capacity lease, which put it in `agent.slice` (CPU weight 20, pinned to the agent cores) beside every build: at a load near 30 a match there fell to 47 ticks a second with a sim step p50 of 12 ms, where in `app.slice` the same match ran its step in 6 ms. From an agent's shell on Linux:

```bash
env XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus \
  systemd-run --user --scope --quiet --slice=app.slice --unit=wisp-play-$(date +%s) -- \
  env -u AI_AGENT bun wisp play --standalone --window native --map MAP.w3x
```

Leave `WISP_WINDOW_PRESENT` unset there. Under `Fifo` a window that is not on screen presents about once a second, because the compositor (niri, for one) throttles the frame callbacks of a hidden surface, so a frame rate read while the player looks at another window says nothing about play; `Mailbox` keeps drawing at full GPU cost while hidden.

Press F10 in the window for the options screen: a Low, Medium, High or Ultra graphics preset and an Original or Remastered art choice (Remastered sharpens textures and rounds silhouettes, see [Remaster at load](native-window-plan.md#remaster-at-load)), saved per player and applied at once; see [Graphics settings](native-window-plan.md#graphics-settings). `WISP_REMASTER=off|standard|high` is a developer override of the art choice.

A SPRITE frame (`BlzCreateFrameByType("SPRITE", ...)` with `BlzFrameSetModel` and
`BlzFrameSetSpriteAnimate`) shows its model in the native window: the model is drawn into a
target the size of the frame's rectangle in screen pixels, with four-sample antialiasing,
and the UI pass draws that picture at the frame's level, so a portrait is as sharp as the
window. The camera fits the sequence's box front-on, turned 20 degrees, and the key light
comes from the camera's upper left with the scene's light colours (a neutral light when the
scene has none). A game that scrubs a model's timeline calls `WispFrameSetSpriteTime(frame,
seconds)`, a Wisp native the Warcraft build does not have, so it calls it only from native-window
code. A sprite is drawn again only when its pose, size or light changes. A map tells the native window that a match is on with `WispSetPlaying(true)` and that it is back in its menus with `WispSetPlaying(false)`; the window bakes remastered art only while not playing and never changes the art mid-match (native-window-plan.md, "Remaster at load"). Chrome does not draw
SPRITE frames.

`bun wisp window probe [--baseline] [--frames N] [--out DIR]` runs the sample map's scene
through the production player and window on a display, for N frames after 120
warm-up frames, and writes `probe.json` with the counts `missedPresents`,
`lateScenes` and `droppedSamples` and a `gates` object that holds their bounds
(0, at most 6 and 0), and beside them p50, p95, p99 and max for the wake
(the render thread's sample to the worker returning from `next_event`), the step, the scene (encode plus parse), the
`readAsset` calls, the present interval and the collection pauses. The pauses
come from JavaScriptCore's collector log (`BUN_JSC_logGC`), because Bun 1.3.13
reports no `gc` entries to `PerformanceObserver`; the run is a child process so
its stderr can carry the log. It builds the library when it is missing.
A process opens one native window, because winit builds one event loop per
process. Measured with the callback wake that W1c replaced, on the private desktop's NVIDIA adapter (30 October 2026): the
wake p99 is 0.7 ms when the machine is quiet and 3 to 4 ms under other load, the
scene p99 under 1.6 ms, the present interval p95 17.5 to 18 ms, and Bun
collects about once per frame while the sample map steps (650 collections in 630
frames, p50 about 1 ms, max 6 to 60 ms); the scene deadline, not the collection
count, is what keeps a present on time (box W1b).

### Assets from a player's own files

A player has no source tree or private asset store: the map is the `.w3x` they
downloaded and stock art is their Warcraft install. `extractMapImports(map,
packager)` (`wisp/scripts/wisp/mapImports`, wisp:host/play/mapImports.ts)
unpacks every file the archive lists into `$XDG_CACHE_HOME/wisp/map-imports/<sha256 of the map>`
once, with the map packager, and returns `{ entry, source }` rows a game's
`readAsset` serves as map imports before it falls back to stock files. Smashcraft
turns this on with `play --standalone --map MAP.w3x --player-assets-only`.
The native window reads assets the same way, models, textures and sounds alike, because every one goes through the game's `readAsset`. A game that steps on the worker thread (`nativeGame`) exports a function from `arguments` to the game instead of the game, and passes the player's flags in `arguments`, so the worker's `readAsset` serves the map's imports first and the Warcraft install after, as the main thread's does; a sound the map imports then plays from the map.

```ts
import { runStandalone, type StandaloneGame } from "wisp/scripts/wisp/standalone";

const game: StandaloneGame = {
  title: "My game",
  render: { readAsset, unitModels, width: 1280, height: 720 },
  create: async (options) => ({
    client,
    step: (input) => advanceMap(input),
    checksum: () => currentChecksum(),
    frame: () => currentSimulationFrame(),
    finished: () => matchFinished(),
    close: () => restoreHeadless(),
  }),
};
// The consumer's play command returns this Effect when --standalone is set.
runStandalone(game);
```

`create` receives optional `{ script }`, containing the text read from
`--script FILE`. Each `step` receives `{ buttons, axisX, axisY }`;
axes run from -1 to 1, with positive Y pointing up. Button names are `left`,
`right`, `up`, `down`, `attack`, `special`, `jump`, `grab`, `shield`, `walk`,
`start` and `view`. The game maps these names to its own actions.

Keyboard controls: arrows or WASD move, J attacks, K uses special, Space
jumps, L grabs, Shift shields, Ctrl walks, Enter starts or pauses and V
selects view. A standard gamepad uses its left stick and directional pad,
A attack, X special, B/Y jump, left shoulder walk, right shoulder grab,
triggers shield and the menu buttons. Input is cleared when the window loses
focus; browser input stays in the window.
`gamepadIndex` optionally selects one browser gamepad index; the default uses
the first connected pad.

For a recorded run, games can expose:

```bash
bun wisp play --standalone --script test/journey.pad --headless --frames 1070 --out build/standalone --capture-frames 200,600,1000
```

The generic options are `script` (file path), `frames` (step count), `out`
(folder), `headless` (hidden Chrome) and `captureFrames` (simulation frame
numbers). Scripted runs record a checksum after every step; ordinary live
play and networked play skip that work (a networked match's peers compare
checksums themselves, and a checksum per display request starves their link). `recordChecksums` can explicitly enable or disable
recording, including for scripted performance runs. Recorded runs write
`checksums.jsonl`. The output contains `standalone.json` with
frame timing (each frame's callback work, loop-start interval with its p50,
p95 and p99, the interval between the display frames each step was drawn for
(`presentedMs`, from rAF timestamps), frames per second, request and draw
duration, plus rAF timestamp/deadline and HTTP readiness), graphics adapter,
audio event/ready/playback counts and missing
sounds, and a scene JSON and PNG for each chosen frame. Without `frames`,
the window stays open after the match so the game's own menus can continue.

## Host and join

Two players on two machines play one match through the standalone window,
with no server and no account. One hosts, the other joins:

```sh
bun wisp play --standalone --host [--port N | --relay REGION]
bun wisp play --standalone --join CODE
bun wisp play --standalone --join ADDRESS:PORT
```

The host prints a join code such as `R2M6-WDYR-7MQC-S0ZA` as soon as its UDP
socket is bound, then each direct address and port. The code packs the host's
LAN IPv4 address, its UDP port and the first 8 hex digits of the map hash
(wisp:host/net/joinCode.ts). A player on another network joins by
direct address after the host forwards that UDP port; Wisp does no hole
punching on that route.

`--host --relay REGION` opens a room on that region's relay instead and
prints a relay code such as `sgp-7K2M-QX9D-R3TB-4`: the region and the room.
`--join CODE` reaches the same room, through any NAT and with no port
forward; both players send to the relay first, which forwards each datagram
to the other (wisp:docs/relay.md, "Peer room"). `--relay` also takes a
relay's `ADDRESS:PORT`, which prints `ADDRESS:PORT/ROOM`. The published region list
is `sgp`, Nexus in Singapore (wisp:host/net/joinCode.ts); `WISP_RELAYS="eu=ADDRESS:PORT,..."`
adds to it. `--relay nearest` takes the region with the lowest round trip.
Before it hosts, the window pings every region and prints each round trip
with the nearest marked; a joiner prints its own round trip to the relay its
code names before it joins (`bun wisp net regions` prints the list alone). A relay code
carries no map hash: the host refuses a joiner whose map differs. The same
flags work on `net host` and `net join`, which print the reports (bytes sent,
bytes received and the largest datagram, a relay's framing included).

A game opts in with `StandaloneGame.net`: `mapHash()` names its build and
`create(link, slot, { script })` returns one slot's `StandaloneNetSession`
over Wisp's transport (wisp:docs/network-model.md). A joiner whose map hash
differs from the code's stops before sending anything with `MapMismatch`,
naming both hashes; a direct join sends the full hash and the host refuses it.
Closing either window sends a goodbye, so the other side ends at once with
`PeerLeft`; a side that goes quiet ends the other after 3 s with `PeerSilent`.
`--script`, `--headless`, `--frames` and `--out` work as above, one script per
player. To try it through delay and loss on one machine, put
`net proxy --listen P --to 127.0.0.1:HOSTPORT --rtt 120` between them and join
`127.0.0.1:P`.
