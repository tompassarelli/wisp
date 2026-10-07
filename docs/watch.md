# Watching clients: `wisp watch`

`wisp watch` tells you what each Warcraft III client is doing without looking
at its screen. Before you click, read or wait on a client, run it to find out
whether the client is signed in, in a lobby, in a match, signed out, or
crashed, and whether its map loaded.

```sh
wisp watch              # every client in the clients file, one line per change
wisp watch a --once     # client a's current state, then exit
wisp watch --json       # the same events as JSON lines
wisp watch --record socket.jsonl   # also save every menu socket message (test fixtures)
wisp client state a     # one client's state
wisp client wait b lobby --seconds 20   # until b is in a lobby; a crash or lost Battle.net fails at once
```

A line looks like this:

```text
20:35:21 a signed in  [log: LoginDoorClose]
20:35:21 a ladder scan done  [log]
20:35:21 a load errors: 7 models failed, first war3mapImported/ImpactHit-....mdx  [log]
21:02:10 b lobby (host)  [socket: GameLobbySetup isHost=true]
21:02:19 b in match  [receipt: match start receipt]
20:30:35 a crashed: ACCESS_VIOLATION (Failed to read address ...)  [log: Errors/2026-10-06 13.30.33 f80136c8/Crash.txt]
```

The project composes the command with `makeWatch(clientsFile, { filePrefix })`
(wisp:scripts/wisp/commands/watch.ts). The clients file is the same one
`wisp client` reads; watching needs each client's `documents` and, for menu
screens, its `menuReportPort`. It doesn't need the client's private desktop.

Without `--once`, `wisp watch` runs inside the [desync autopsy](autopsy.md)
(wisp:docs/autopsy.md). When the clients report a desync, it prints the first
divergent birth with its class, turn and client.

## States

| State | Meaning | Decided by |
| --- | --- | --- |
| `closed` | Neither Battle.net nor Warcraft III runs in the client's prefix | process |
| `launcher` | Battle.net runs, Warcraft III doesn't | process |
| `running` | Warcraft III runs, and no source has said where it is yet | process |
| `signing in` | The menus show the login screen, and the client hasn't signed in | socket (`SetGlueScreen LOGIN_DOORS`) |
| `signed in` | The log shows the login doors closed, and the menus haven't reported a screen | log (`LoginDoorClose`) |
| `menus` | A menu screen, named as the game names it (`MAIN_MENU`, `CUSTOM_LOBBIES`, ...) | socket (`SetGlueScreen`) |
| `lobby` | In a lobby, as host or guest | socket (`SetGlueScreen GAME_LOBBY`, `GameLobbySetup`) |
| `loading` | The loading screen | socket (`SetGlueScreen LOADING_SCREEN`) |
| `in match` | The match runs | socket (`DISABLED_SCREEN` after loading), or the map's match receipt |
| `results` | The score screen | socket (`UpdateScoreInfo`, `SCORE_SCREEN`) |
| `disconnected` | Warcraft III runs but has lost Battle.net | socket (`LoggedOut`, or the login screen after the client had signed in) |
| `crashed` | Warcraft III wrote a crash report for its session | log (`Errors/*/Crash.txt`) |

Each view also has the post-sign-in ladder map scan (`waiting`, `scanning`,
`done`; see [play.md](play.md)) and the session's load errors: the
`model creation failed - war3mapImported/...` lines a map whose imports
didn't load leaves in War3Log.txt.

## How a state is decided

The sources, in the order they count:

1. **Crash reports.** Warcraft III writes `Documents/Warcraft III/Errors/<time>/Crash.txt`
   and copies its log beside it. A report whose log copy has the same session
   start as War3Log.txt is this session's crash. It counts while the game is
   gone, and for a minute after it was written while a game runs (after that,
   a running game is a new launch).
2. **Processes.** `/proc`, filtered to the client's Wine prefix (the folder
   above `drive_c` in its `documents`): Battle.net.exe and Warcraft III.exe.
   Run watch where it sees the host's processes; inside a separate PID
   namespace (such as `run-bounded`) every client looks closed.
3. **The menus' socket.** With a menu page installed
   ([driving-warcraft.md](driving-warcraft.md)), watch connects its own socket
   to the menus and hears every message the game sends them. The page also
   keeps the newest four state messages it heard and announces them every
   0.5 s, so a watch started mid-session knows the current screen. A page
   installed before this feature announces no screens: until the screen next
   changes, such a client is `running` or `signed in`. Reinstall the page
   (`wisp menus install`) to get them.
4. **The map's match receipt.** With the map's `filePrefix`, the match start
   acknowledgement the runtime writes in CustomMapData
   (`PREFIX-hot-ack-pN.txt`) places a client in its match when the socket
   last said lobby or loading, or said nothing.
5. **War3Log.txt.** Only for what it contains: the sign-in, the ladder scan
   and load errors. Warcraft III writes it in bursts: on 6 Oct client B's log
   stopped 3 s after its start, without a sign-in, while B played all evening.
   So a line the log lacks never implies a state.

One program at a time can listen on a menu page's report port. The listener
keeps the newest announced address in `$XDG_RUNTIME_DIR/wisp-menus-PORT.json`
(readable only by you), and the menu commands (`play`, `fresh`, `menus`) read
it when another Wisp program holds the port, so watch runs beside them.

## Waiting on a state in code

```ts
import { ClientWatch, inState, unlessLost, waitFor } from "wisp/scripts/wisp/watch";

// Until the client is in a lobby; crashed or disconnected fails at once.
const view = yield* waitFor(client, inState("lobby"), { what: "the lobby", seconds: 20 });
// Any existing wait, stopped as soon as the client crashes or loses Battle.net.
yield* unlessLost(client, startedAfter(client, since, filePrefix));
```

Provide `ClientWatch.layer({ filePrefix })` once per program. `unlessLost`
needs no ClientWatch: without one, the wait runs as before, so tests with fake
clients are unchanged. `play`, `freshMatch` and the `client wait` action use
them; tests replace the service with `Layer.succeed(ClientWatch, ...)`.

## Typing only into a match

Return and typed text reach Battle.net's public channel from the menus and a
lobby's chat from a lobby. Wisp's private-desktop input
(wisp:scripts/warcraft/desktop.ts) therefore checks the client before any
Return, KP_Enter or typed text, in `keys`, `typeText` and `batch`, and so in
`wisp client chat|keys`, accept's `chat` steps and every consumer that drives
a client through them. It refuses unless `typesIntoMatch(view)`: the client is
`in match` and its menu page was connected when that was decided. Without the
page a match receipt can be an earlier match's while the client sits in a
channel, so a client without a page can't be typed into. The check uses the
ClientWatch provided; without one it watches the client once, with no map
receipts, so a consumer provides `ClientWatch.layer({ filePrefix })`, and
`makeClient(file, { filePrefix })` does for `wisp client`. Other keys, such as
Escape or F10, are not checked.

The decision is a pure function of its sources, `decide(client, sources,
previous)`, tested against the 6 Oct recordings in
wisp:test/fixtures/war3log/ and wisp:test/fixtures/watch/: the bad `-loadfile`
run, the crashed `play --menus` run and client B's silent log.

## Limits

- Menu screens other than `GAME_LOBBY` and `LOADING_SCREEN` (which Wisp's
  menu driving already waits for), and the `DISABLED_SCREEN`, `UpdateScoreInfo`
  and `LoggedOut` messages, are named as other menu tools name them; no socket
  trace of them has been recorded yet. `wisp watch --record FILE` records one.
- A client without a menu page shows only `closed`, `launcher`, `running`,
  `signed in`, `in match` (from receipts) and `crashed`.
- Warcraft III killed without a crash report shows as `launcher` or `closed`.
