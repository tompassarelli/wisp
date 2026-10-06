# One command to a match: `wisp play`

`play` takes the owner from their desktop to a match on their own display.
It reports each step on one line and stops at the first problem with a plain
message that says what to do:

```text
1/7 Wine prefix: free
2/7 Battle.net: starting the Steam shortcut "Warcraft III (Battle.net)"
2/7 Battle.net: started and signed in (16 s)
3/7 Warcraft III: Battle.net's Play started it
3/7 Warcraft III: running (pid 2852), fullscreen
4/7 Custom game: "Smashcraft" of Smashcraft 0.0.47 started (joining by name is case-sensitive)
5/7 Opponent: computer in slot 2
6/7 Controller helper: running (pid 41234), log ~/.local/state/smashcraft/play-helper.log
7/7 Fullscreen: Warcraft III is fullscreen and focused. Ready to fight.
```

1. **Wine prefix.** Separate Steam runtime containers each start their own
   wineserver against one prefix, and a launcher started beside another
   runtime can't start the game. `play` refuses two runtimes, a runtime on
   another display, and a runtime without Battle.net (after allowing it 20 s
   to exit), and prints the `kill` command that clears it. It finds a
   prefix's wineservers by their `WINEPREFIX` and, for one started in another
   namespace, by the server directory Wine names after the prefix's device
   and inode (`server-DEV-INODE`).
2. **Battle.net.** A running launcher is reused. Otherwise Steam starts the
   game's shortcut: a non-Steam shortcut's URL is
   `steam://rungameid/` followed by its 32-bit app id shifted left 32 bits,
   OR 0x02000000 (`steam -applaunch` takes only Steam's own app ids). Signed
   in means the newest `battle.net-*.log` in the prefix's
   `AppData/Local/Battle.net/Logs` has `Logged into Battle.net successfully`.
   `play` never signs in or out.
3. **Warcraft III.** `play` makes the launcher's window fullscreen and reads
   it. Battle.net opens on the game it last showed or features (on 6 Oct,
   WoW: Forever), and every game's page has its own Play, so `play` clicks
   Play only under a game version box that names Warcraft III; otherwise it
   opens the Games tab and clicks Warcraft III's tile on its art, above the
   label found in the grid (below its "My Games" and "Sort by" header, with
   the install state, such as "Installed", under it; once two reads agree;
   a "Warcraft" logo in another tile's art is no label). The label itself
   takes no clicks; when the page doesn't change within 6 s it
   clicks the art once more, then stops. Then it puts the window back.
   Only the log lines written after the click decide: no `LaunchBinary:
   uid=w3` within 15 s means the click wasn't taken, and `play` stops there;
   `Game is running: w3` is a launch, and `Could not launch ... Warcraft
   III.exe` or an expired pending launch is a failure. On a failure it ends
   every program of the prefix, waits for Steam to see the shortcut end,
   starts the launcher again alone and presses Play once more. It never
   starts Warcraft III.exe itself. Battle.net's `--exec="launch W3"` would
   need a second Battle.net.exe inside the launcher's own Steam runtime
   container; started from outside, Wine would start a second wineserver on
   the prefix, so `play` presses Play. The game's window becomes fullscreen as
   soon as it appears, so a capture of its output is the game's frame.
4. **Custom game.** It installs the map when its folder lacks it (from the
   declared build). From the main menu: Multiplayer, Custom Games, Create
   Game, the map's folder, the map, the game's name, Create, Start. Each
   control is found by the text Warcraft shows, so any screen size works.
   Warcraft's menus slide in (on 6 Oct Battle.net's tabs moved 32 px down
   within 0.3 s of appearing, and a click read before the move missed), so a
   control is clicked only when two reads in a row put it in the same place.
   Each click then waits up to 10 s for the next screen's text; without it,
   the control is found and clicked once more, then `play` stops with the
   pictures. The game name field is just below a "Game Name" label when
   there is one, and otherwise where it is on a 2560x1440 frame scaled by
   the frame's height; the name typed into it must read back beside it. It
   ends when the game's `started` resolves. A click aimed outside the screen
   is refused before the pointer moves.
5. **Opponent.** The game's own step. `game.clickUi(x, y)` clicks a map frame
   placed at Warcraft's UI coordinates: the 4:3 area spans the window's
   height, centred, with x from 0 to 0.8 and y from 0 at the bottom to 0.6.
6. **Controller helper.** One helper for this game: a running helper whose
   `--pid` is this game's is kept; any other running copy stops `play`. The
   helper starts in its own session, so it outlives `play` and its terminal,
   and must print its ready line within 10 s.
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
  started: (game, since) => /* the map's first-screen file, newer than since */,
  opponent: (game) => /* clicks with game.clickUi, confirms, returns "computer in slot 2" */,
  helper: { binary, args: (game) => /* game.pid, game.window, game.xWindow.id, ... */, ready: /waiting_for_match/, log },
}, gameFilesLayer, tools);
```

When `Maps/FOLDER/FILE` of the prefix's Documents/Warcraft III is missing, step
4 copies it from `map.source`; without a source it stops. An installed map is
left as it is.

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
one showed, until the X pointer is within 2 pixels, at most 8 moves. Typed
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
