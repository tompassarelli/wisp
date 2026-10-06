# One command to a match: `wisp play`

`play` takes the owner from their desktop to a match on their own display.
It reports each step on one line and stops at the first problem with a plain
message that says what to do. It takes no arguments.

```text
1/7 Wine prefix: free
2/7 Battle.net: starting the Steam shortcut "Warcraft III (Battle.net)"
2/7 Battle.net: started and signed in (27 s)
3/7 Warcraft III: Battle.net's Play started it
3/7 Warcraft III: running (pid 2852), asked to go fullscreen
4/7 Map: Warcraft III signed in and read its ladder maps (27 s); hosting the map
4/7 Map: "Smashcraft" of Smashcraft 0.0.47 hosted through the menus (joining by name is case-sensitive)
4/7 Map: fighter selection 35 s after Play
5/7 Controller helper: running (pid 41234), log ~/.local/state/smashcraft/play-helper.log
6/7 Match: computer as Player 3
7/7 Fullscreen: Warcraft III is fullscreen and focused. Ready to fight.
```

Before step 1, and once more after a failure, `play` runs
[`doctor`](doctor.md) on its prefix when the game gives it `wisp watch`'s
ClientWatch (`makePlay`'s fourth argument). Doctor ends a second runtime, a
runtime without Battle.net, a crashed game and its error dialog, a game that
lost Battle.net, sits at the empty login shell, loaded the map without its
imports or is stuck loading, leaves an earlier lobby or score screen, and
restarts a launcher whose connection is failing; when it recovered
something after a failure, `play` runs once more. It leaves pressing Play to
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
   in means the newest `battle.net-*.log` in `AppData/Local/Battle.net/Logs`
   has `Logged into Battle.net successfully`. `play` never signs in or out.
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
   start. `play` makes the launcher's window fullscreen and reads it.
   Battle.net opens on the game it last showed or features (on 6 Oct,
   WoW: Forever), and every game's page has its own Play, so `play` clicks
   Play only under a game version box that names Warcraft III; otherwise it
   opens the Games tab and clicks Warcraft III's tile on its art, above the
   label found in the grid (below its "My Games" and "Sort by" header, with
   the install state, such as "Installed", under it; once two reads agree;
   a "Warcraft" logo in another tile's art is no label). The label itself
   takes no clicks; when the page doesn't change within 6 s it
   clicks the art once more, then stops. Then it puts the window back.
   Before the game starts, `play` saves War3Preferences.txt and a detached helper puts it back when the game exits ([display-settings.md](display-settings.md)).
   Only the log lines written after the click decide: no `LaunchBinary:
   uid=w3` within 15 s means the click wasn't taken, and `play` stops there;
   `Game is running: w3` is a launch, and `Could not launch ... Warcraft
   III.exe` or an expired pending launch is a failure. On a failure it ends
   every program of the prefix, waits for Steam to see the shortcut end,
   starts the launcher again alone and presses Play once more. It never
   starts Warcraft III.exe itself. Battle.net's `--exec="launch W3"` would
   need a second Battle.net.exe inside the launcher's own Steam runtime
   container; started from outside, Wine would start a second wineserver on
   the prefix, so `play` presses Play. `play` asks for fullscreen as soon
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
   Play replaces) shows the scan over: a line at least 2 s after its last
   ladder map, or 2 s with nothing new. A game that signed in and opens no
   ladder map within 30 s is hosted anyway; one whose log shows no sign-in
   within 120 s stops `play`. Warcraft III already past its scan is hosted
   at once. Hosting goes through the menu socket when the game declares
   `menuReportPort` and its installed page reports within 3 s
   ([driving-warcraft.md](driving-warcraft.md)); otherwise through the
   menus: Multiplayer, Custom Games, Create Game, the map's folder, the
   map, the game's name, Create, Start. Each control is found by the text
   Warcraft shows, so any screen size works. Warcraft's menus slide in (on 6
   Oct Battle.net's tabs moved 32 px down within 0.3 s of appearing, and a
   click read before the move missed), so a control is clicked only when two
   reads in a row put it in the same place. Each click then waits up to 10 s
   for the next screen's text; without it, the control is found and clicked
   once more, then `play` stops with the pictures. The game name field is
   just below a "Game Name" label when there is one, and otherwise where it
   is on a 2560x1440 frame scaled by the frame's height; the name typed into
   it must read back beside it. A click aimed outside the screen is refused
   before the pointer moves. The step ends when the game's `started`
   resolves, and prints the time from Play to fighter selection. Any
   `model creation failed - war3mapImported/` line the log gains from
   hosting on, checked then and again after step 6, stops `play` with the
   count and the first model. While steps 4 and 6 run, a crash report for
   this session or a lost Battle.net ([watch.md](watch.md)) stops `play` at
   once instead of at the step's timeout.
5. **Controller helper.** One helper for this game: a running helper whose
   `--pid` is this game's is kept; any other running copy stops `play`. The
   helper starts in its own session, so it outlives `play` and its terminal,
   and must print its ready line within 10 s. It starts before the match, so
   the player's pad plays from the first frame.
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
  debugDirectory: join(homedir(), ".local/state/smashcraft/play-debug"),
  prepare: (documents) => /* the map's request file in CustomMapData */,
  cleanup: (documents) => /* removes it when a run stops */,
  started: (game, since) => /* the map's first-screen file, newer than since */,
  match: (game) => /* the go-ahead the map waits for, then its receipt; "computer as Player 3" */,
  helper: { binary, args: (game) => /* game.pid, game.window, game.xWindow.id, ... */, ready: /waiting_for_match/, log },
}, gameFilesLayer, tools);
```

## What it needs

The owner's niri session (`niri msg`), `grim`, `tesseract`, `wlrctl`,
`xdotool` and `steam`; each is looked up on PATH unless the game passes its
path in `tools`. The game runs on the declared X display under niri's
Xwayland (xwayland-satellite). Every wait has a bound (`PLAY_TIMEOUTS`); none
is a readiness delay.

Clicks move the compositor's own pointer with `wlrctl pointer move` (niri's
virtual pointer) and click with `wlrctl pointer click`, as a mouse does. On
the owner's desktop the X pointer stays where the compositor's pointer is, so
XTEST motion doesn't move it: on 6 Oct an XTEST move to 2075,1518 left the X
pointer at 1194,882. A target is read in the capture's pixels (2880x1920 on a
1440x960 output at scale 2) and checked in the X root's pixels, which match
the capture there. How far the X pointer moves per logical pixel depends on
the window under it: 2 X pixels over the launcher, as the scale says, but 1
over fullscreen Warcraft III from its Battle.net screens on (6 Oct). Each
move starts from the scale's gain and divides the next by the gain the last
one showed, until the X pointer is within 2 pixels, at most 8 moves. Targets
and the initial gain use the captured output's size, so a letterboxed launcher
does not rescale or offset the point read from that capture. Games is clicked
only after two reads put its tab in the same place. Typed
text and keys are XTEST (`xdotool`) into the focused game window.

Each run prints a folder under the game's `debugDirectory`, named by its
start time. It holds a picture of the output before and after every click
(`NN-what-before.jpg`, `NN-what-after.jpg`) and `clicks.log`: each click's
target in the capture, in logical and in X root pixels, where the X pointer
was, each `wlrctl` move and where the X pointer then was.

The fakes in wisp:test/play.test.ts cover each step's success and failure
messages with the recorded window, log and process shapes. Reading the menus
at the owner's resolution and the buttons taking the compositor's clicks are
properties of the real desktop, which only a native run checks.
