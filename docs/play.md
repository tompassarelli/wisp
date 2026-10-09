# One command to a match: `wisp play`

`play` takes the owner from their desktop to a match on their own display.
It is the owner's normal playable path. A consumer such as Smashcraft resolves
current main and builds its matching map and controller helper before calling
Wisp. Experimental candidates use `fresh`, captures or `accept`; they do not
replace the owner's play declaration. Consumer-owned versioned map libraries
can set `GameFiles.layer({ ..., preserveMaps: true })` and install diagnostics
in a `tests/` subfolder; menu hosting accepts nested map folders.
It reports each step on one line and stops at the first problem with a plain
message that says what to do. Native play takes no arguments. Games may also
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
   runs inside `machine-capacity session --class native --owner
   wisp-game-<client>` (`play` uses `play`), resolved with `agents path
   machine-capacity` as `lan pool` does, so whatever it starts lives in a
   `native.slice` scope and passes CPU, memory and GPU admission instead of
   joining the calling terminal's scope (`nsenter` keeps its caller's
   cgroup). The helper runs with the host's `PATH`, `XDG_RUNTIME_DIR` and
   `DBUS_SESSION_BUS_ADDRESS`; `env` restores the launcher's values before
   `nsenter`. A DEFER prints `<client>: waiting: the capacity helper defers
   launching Warcraft III (<reason>); trying again in 45 s` and retries for
   up to 30 minutes before stopping. Nothing is
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

The game declares its playtest (wisp:scripts/wisp/play.ts,
`PlayDeclaration`) and adds the command with `makePlay`
(wisp:scripts/wisp/commands/play.ts); its own steps may use services that
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
`render.preloadModels` lists any additional models the map creates later.
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
play skips that work. `recordChecksums` can explicitly enable or disable
recording, including for scripted performance runs. Recorded runs write
`checksums.jsonl`. The output contains `standalone.json` with
frame timing (each frame's callback work, loop-start interval with its p50,
p95 and p99, the interval between the display frames each step was drawn for
(`presentedMs`, from rAF timestamps), frames per second, request and draw
duration, plus rAF timestamp/deadline and HTTP readiness), graphics adapter,
audio event/ready/playback counts and missing
sounds, and a scene JSON and PNG for each chosen frame. Without `frames`,
the window stays open after the match so the game's own menus can continue.
