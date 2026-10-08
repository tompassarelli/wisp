# Driving Warcraft III without clicks

`wisp play` and the two-client bot sessions need Warcraft III to do the same
few things over and over:

- create a custom game of a map;
- add a computer;
- start it;
- join it from a second client;
- leave it again.

Clicking through the menus works, but it is slow and fragile. This page
compares four ways to make the game do those things, with how each works,
whose code shows it, its licence, its account risk and what it would
replace. A ranked recommendation closes the page.

To know what a client is doing (its menu screen, lobby, match, a lost
Battle.net or a crash) without reading its screen, use [`wisp client watch`](watch.md):
it listens to the same socket.

The facts are for Warcraft III 3.0.0.24268, the Windows build under Proton,
unless a line says otherwise. "Prior art" marks what another project found
and what Wisp hasn't observed itself. W3Champions' code is in
`~/code/resources/w3champions/` (read-only).

## The steps to replace

| Step | `wisp play` today | Bot sessions before the menu socket (wisp:scripts/wisp/lobby.ts `freshMatch` now uses the socket) |
| --- | --- | --- |
| Start the game | Battle.net's Play, clicked on the launcher's page | Clients stay running |
| Load the map | The menu socket only, once the game's ladder scan is over ([play.md](play.md)) | Create Game → first map → name → Create, by clicks |
| Add a computer | The map's own setup | (none) |
| Join | (solo) | Join name → Join, by clicks |
| Start | The map starts the match | Start, by a click |
| Leave | (process ends) | F10 → E → Q → Back, by keys and clicks |

## 1. The menu socket (recommended)

### How it works

Warcraft III's menus (the "glue" screens) are a web page. The game runs them
in its own Chromium, BlizzardBrowser.exe; under Wine its processes show as
`CrBrowserMain`, `CrRendererMain`, `CrGpuMain` and `CrUtilityMain`.

`Warcraft III.exe` serves the page itself:

- **The page.** It lives at `http://127.0.0.1:PORT/webui/index.html?guid=GUID`,
  over HTTP/1.0. The page's script, `GlueManager.js`, draws every menu.
- **The socket.** The page talks to the game over a WebSocket at
  `ws://127.0.0.1:PORT/webui-socket/GUID`.
- **Requests.** Each is a JSON text frame:
  `{"type":"webui","message":NAME,"payload":{...}}`.
- **Events.** The game sends `{"messageType":NAME,"payload":{...}}` to every
  connected socket.
- **Other sockets.** Any local socket that knows the GUID may send what the
  page sends (wc3-slop-lan, verified on this build under Wine).

A click in the menus is a request on this socket, so a program that sends the
same requests skips the click.

**The port** is new with every launch. Wine's sockets all belong to
`wineserver` in `ss -ltnp`. The menu port is the listener whose one
established connection runs between `Warcraft III.exe` and the browser's
network process (`CrUtilityMain --type=utility
--service-sandbox-type=network`).

On 6 Oct, client B's game listened on two extra loopback ports:

- **38487** was the menu port. It answered `GET /webui/index.html` without a
  GUID: 200, 474 bytes, loading `GlueManager.js`.
- **38815** accepted a TCP connection but sent no HTTP reply within 3 s, so it
  is not a DevTools endpoint. Its purpose is unknown.

**The GUID** is checked: a WebSocket upgrade naming a wrong GUID gets
`404`. It appears on no command line, in no log (`War3Log.txt`, the browser's
`CEF-*.log`) and in no browser profile on disk. Other tools get it in one of
two ways:

- **They replace the menu page.** W3Champions and WC3 Multi-Tool set the
  registry value `HKCU\Software\Blizzard Entertainment\Warcraft III` →
  `Allow Local Files` = 1. The game then serves loose files from its
  `_retail_` folder ahead of its packed data, so a
  `_retail_/webui/index.html` replaces the stock page. That page can read
  its own URL. W3Champions' install page gives exactly this procedure:
  index.html in `_retail_\webui\` plus the `reg add` below.
- **They read the game's memory.** wc3-slop-lan's activator does this, and
  it is excluded (see [Excluded](#excluded-memory-on-signed-in-clients)).

A third way, not tried, is to capture the browser's handshake on the loopback
interface at launch. That needs root and sees other loopback traffic.

**Wisp's page** (wisp:scripts/wisp/menus.ts `menuPage`) is that skeleton:

- `#root` and `#portal`, with the game's own `GlueManager.js` from its data.
  Nothing of Blizzard's is copied.
- A script that posts the page's port and GUID to `127.0.0.1:47123` every
  0.5 s, so a program that starts listening finds the menus within half a
  second. A page installed before 7 October 2026 announces every 2 s until
  `wisp menus install` replaces it.
- While something listens there, the name of each request the menus send,
  with the payload for lobby, map and slot requests. This turns any click
  into a known request: `wisp menus listen`, then do the step by hand once.

The GUID lets anything local drive the menus, so Wisp never prints or stores
it.

### Messages

From prior art unless marked. Names are case-sensitive.

| Request | Payload | Answer |
| --- | --- | --- |
| `GetMapList` | `{useLastMap: true}`, or `{subdirectory: "<absolute folder path>/"}` | `MapList {mapList: {maps: [{filename, filepath, isFolder}]}}`. A folder is listed with its parent's path. |
| `CreateLobby` | `{filename, gameName, gameSpeed: 0-2, privateGame, password, mapSettings: {flagLockTeams, flagPlaceTeamsTogether, flagFullSharedUnitControl, flagRandomRaces, flagRandomHero, settingObservers, settingVisibility}}` | `GameLobbySetup {isHost, playerHost, ...}`, or `MultiplayerGameCreateResult {details: {success: false}}`. The game refuses a map it has not just listed ("unavailable or corrupted"). |
| `GetGameList` | `{}` | `GameList {games: [{name, id, mapFile}]}`, then `GameListUpdate` / `GameListRemove` |
| `JoinGameByGameName` | `{gameName, gamePass, checkForGamePass: true}` | `RequestForPassword` (answer with the same request without `checkForGamePass`), then `GameLobbySetup` |
| `JoinGame` | `{gameId, password, mapFile}` (the list's `id`) | `GameLobbySetup` |
| `LobbyStart` | `{}` | `SetGlueScreen {screen: "LOADING_SCREEN"}` |
| `LobbyCancel`, `LeaveGame` | `{}` | `MultiplayerGameLeave` after a leave |
| `OpenSlot`, `CloseSlot`, `KickPlayerFromGameLobby`, `BanPlayerFromGameLobby` | `{slot}` | `GameLobbySetup` |
| `SetTeam`, `SetHandicap` | `{slot, team}`, `{slot, handicap: 50-100}` | `GameLobbySetup` |
| `SendGameChatMessage` | `{content}` (255 characters at most) | `ChatMessage` |
| `InitializeLocalNetProvider` | `{}` | The local, single-player provider: its lobbies are invisible to other clients. |
| `InitializeNetProvider`, `PlayOffline` | `{}` | On 3.0 both start a Battle.net sign-in (the build reports `enableOfflineMode: false`). Don't send them to a signed-in client. |
| `ScoreScreenClose` | `{}` | Ignored by 3.0.0.24268 (7 Oct 2026); Escape leaves the score screen |

Events seen without a request: `SetGlueScreen {screen}` (for example
`LOGIN_DOORS`, `GAME_LOBBY`, `LOADING_SCREEN`, `SCORE_SCREEN`),
`ScreenTransitionInfo`, `UpdateUserInfo`, `ChatMessage`, `GameVersion`,
`OnChannelJoin`, `TeamsInformation`, and others named in WC3 Multi-Tool's
notes.

No public source names the request that turns a slot into a computer. The
page's request report shows it the first time a host adds one by hand.

### Wisp's commands

wisp:scripts/wisp/commands/menus.ts runs in any project's CLI; the sample's
is `bun examples/sample/scripts/sample.ts menus ...`.

```text
menus install RETAIL_DIR [--port N]   the page, into Warcraft III's _retail_ folder
menus remove RETAIL_DIR               Wisp's page only; another program's page stays
menus listen [--port N]               "menus on 127.0.0.1:PORT", then each request the menus send
menus host --folder F --map FILE --name NAME [--password P] [--start]
menus join --name NAME --password P
menus start | leave
```

- Each command waits up to 5 s for the page's next report, connects, does its
  step and returns when the game answers. Every answer has a bound: 10 s for a
  map list, 20 s for a lobby, 30 s for the loading screen.
- `host` walks the map list as Create Game does. It starts from the last
  folder, then opens `F` beside it, and fails naming what the list showed.
- `host` always makes a passworded, private game, with a random password
  unless one is given. Such a game is joined by its exact name and never
  listed.
- `listen` holds the report port, so run it alone.
- The library form is `hostLobby`, `joinLobby`, `startLobby` and `leaveLobby`
  on a `connectMenus` socket. wisp:test/menus.test.ts plays each one against
  a fake game.
- `startLobby` sends `LobbyStart` no sooner than `LOBBY_SETTLE_MS` (2.5 s)
  after the same socket's `hostLobby` was confirmed. On 7 Oct 2026,
  Warcraft III 3.0.0.24268 crashed while loading (a read of 0x500) in 6 of 6
  starts sent as soon as the lobby was confirmed, and in 0 of 11 sent about
  2 s later (Smashcraft #119). No menu event is known to end that window.
- `hostLobby` waits for `isHost:true`. A lobby-entry event requests
  `SendGameLobbySetup`; an earlier `isHost:false` setup does not mean creation
  failed. An explicit creation refusal still fails immediately.
- `PlayDeclaration.menuReportPort` selects the installed page for `play`'s
  menu route. Without a configured port, or without a report within 3 s,
  the usual menu controls run. After a page reports, hosting or starting
  failures stop the command rather than creating a second lobby.
- Each client in a clients file may set `menuReportPort`. Use a different
  port per client and install that client's page with the same `--port`;
  a shared port cannot identify which client reported. `reportedMenus(port)`
  discovers and connects to that page within the caller's Effect scope.

### Setup and undo

Do this once per Wine prefix, and only with the account owner's agreement
(see the risk below). Never start a second runtime on a live prefix: run `reg`
inside the prefix's own runtime, or edit `user.reg` while no wineserver uses
the prefix.

1. Check that `_retail_` holds only `x86_64` and `.flavor.info`. With
   `Allow Local Files` set, any loose file there overrides the game's own
   data; W3Champions has its users delete a `_retail_/Maps` folder for this
   reason.
2. `menus install "<prefix>/drive_c/Program Files (x86)/Warcraft III/_retail_"`.
3. `reg add "HKCU\Software\Blizzard Entertainment\Warcraft III" /v "Allow Local Files" /t REG_DWORD /d 1 /f`
4. Start the game with Battle.net's Play. `menus listen` prints the port once
   the menus load.

To undo:

1. Exit the game.
2. `menus remove "<prefix>/drive_c/Program Files (x86)/Warcraft III/_retail_"`.
3. `reg delete "HKCU\Software\Blizzard Entertainment\Warcraft III" /v "Allow Local Files" /f`,
   or delete the `"Allow Local Files"=dword:00000001` line from the prefix's
   `user.reg` while no wineserver uses it.
4. The next Play shows the stock menus.

### Account risk

- **What Blizzard sees.** It sees the same requests the menus send for a
  player's clicks, and the lobby is an ordinary custom game on Blizzard's
  servers. The game's code, memory and network traffic are unchanged.
- **The client changes.** The page is a loose UI file the game itself
  serves. `Allow Local Files` is a switch the game reads, and UI mods and
  W3Champions' install use it.
- **The policy.** Blizzard's End User License Agreement forbids third-party
  programs that interact with its games unless Blizzard authorizes them. No
  Blizzard statement authorizes or condemns W3Champions. W3Champions has
  installed its menu page this way for years and is widely used, with no
  known account action over it. A Nov 2025 forum answer to "is W3Champions
  against ToS" says the same; it came from a player, not Blizzard staff.
- **What is not done.** The approach reads no hidden game state, plays no
  input in a match and doesn't touch ranked play. It is not a cheat in the
  usual sense.
- **Lower the risk.** Use test accounts first, keep games private and
  passworded, create one lobby per match (never in a tight loop), and stay out
  of public lobbies and ladder.

The risk is not zero. Whether an account takes it is the account owner's
decision.

### What it replaces

- **`wisp play`.** It hosts through the page on the game's `menuReportPort`
  and stops when the page doesn't report, instead of clicking the menus. It
  also allows rematches in the running game instead of a new Play per match.
- **Bot sessions.** `freshMatch` (wisp:scripts/wisp/lobby.ts) hosts a
  private game, joins it by name and password, starts it and leaves a lobby
  or match through each client's page, and the score screen with Escape. It
  refuses a client without a reporting page: a game created by clicks is
  listed publicly.
- **Adding a computer** once its request is known.
- **What it can't replace.** Battle.net's Play: Battle.net is a separate
  program, not the game. It also can't replace leaving a match in progress,
  unless `LeaveGame` works there, which nobody has observed.

### Code and licences

| Source | What to read | Licence and reuse |
| --- | --- | --- |
| W3Champions launcher, `~/code/resources/w3champions/launcher` | `src/update-handling/WindowsLauncher.ts` and `MacLauncher.ts` set `Allow Local Files`; `src/update-handling/LauncherStrategy.ts` unpacks W3Champions' page into `_retail_`; `src/game/ingame-bridge.ts` and `game.types.ts` are the bridge between that page and the launcher on `127.0.0.1:38123`, the launcher's own messages, not the game's. Deprecated; its successor (w3champions/launcher-e-release) is closed. | No licence: read only, nothing copied. |
| [kgallimore/wc3MultiTool](https://github.com/kgallimore/wc3MultiTool) | `packages/main/src/globals/gameSocket.ts` (request and event names, `CreateLobby` payload); `buildResources/webui.html`, `index.js` (a page that takes the GUID from its URL) | No licence: read only. |
| [Promises/wc3-slop-lan](https://github.com/Promises/wc3-slop-lan) | `harness/webui/index.html` (host, join, LAN join and start sequences); `activator/src/menus.rs`, `harness/webui/bridge.py` (an outside socket client); `docs/porting.md` §2.2 (the Windows build) | No licence: read only. |
| Wisp | wisp:scripts/wisp/menus.ts, wisp:scripts/wisp/commands/menus.ts, wisp:test/menus.test.ts | MIT. Written from the observed protocol: message names and JSON shapes are the interface, not copied code. |

## 2. LAN hosting: offline clients and Wisp's host

**Why and on what terms.**

- Warcraft III was a LAN game for over 20 years. Patch 3.0.0 removed LAN, and
  this restores local play for development and testing.
- Wisp follows W3Champions' precedent: the same transient switch of the game's
  network provider from `LOOP` to `TCPN`, undone within a fraction of a
  second. As far as we can tell, Blizzard acknowledges third-party services
  like W3Champions and hasn't taken action against them.
- No statement from Blizzard authorizes or condemns this. A player's answer
  on Blizzard's forums, with no staff reply, is in [Sources](#sources).
- From what W3Champions publishes, we understand that it has some contact or
  coordination with Blizzard, so that Warcraft III patches don't break it at
  once; the extent is undisclosed. This is our reading. We found no
  w3champions.com page that says it, so no link is given.
- **Development and testing on your own offline clients and maps only.**
  Never switch a signed-in Battle.net client. It isn't for cheating, or for
  touching anyone else's game.

**How it works.** `wisp lan` ([lan.md](lan.md)) runs offline clients in pairs:

- Each client is a fresh Wine prefix with a reflinked install and no
  Battle.net account. It stops at the login screen, where the local network
  provider still works.
- Each pair shares a network namespace with nothing but loopback.
- To join, a client's provider is switched to `TCPN` for one rebuild, the
  W3Champions way.
- Wisp's own TypeScript host lists the game to the clients' LAN ports, takes
  their joins and relays the match in 30 ms turns.

Prior art: W3Champions' Flo (`~/code/resources/w3champions/flo-2022`;
current source github.com/BogdanW3/W3C-Flo, MPL-2.0), gowarcraft3 (MPL-2.0)
and wc3-slop-lan (github.com/Promises/wc3-slop-lan, no licence: read for
facts only). Wisp copies no file from any of them.

**Account risk:** none to an account. The clients never sign in, and the
code switch is made only after a check that the client can reach nothing but
loopback.

**What it replaces.** Bot and parity sessions run on as many pairs as the
machine admits, in parallel, instead of on the two signed-in clients. The
host logs every turn's actions and compares every client's checksum each turn
(wisp:docs/lan.md). Owner playtests and
anything Battle.net itself must show keep the menu socket.

**Limits:**

- Builds checked: 3.0.0.24268.
- A map has to be on disk at both clients: `wisp lan fresh` copies it there.
- The map's players are the pool clients: two to a pair for now.

## 3. `-loadfile` through Battle.net (solo)

**How it works.** `Warcraft III.exe -launch -loadfile "<absolute map path>"`
starts the map as a single-player test game, the World Editor's Test Map.

- A game started directly has no Battle.net session and stops at a sign-in
  form.
- Battle.net's Play hands the game its session. It also passes the game's
  "Additional command line arguments" (`Games.w3.AdditionalLaunchArguments`
  in `Battle.net.config`), which it reads when it starts.
- So a tool writes the argument while Battle.net isn't running, then
  presses Play.
- Prior art: [BenqsXd/wc3-mcp](https://github.com/BenqsXd/wc3-mcp) (MIT),
  `src/wc3mcp/desktop/battlenet.py`. It reports about 13 s from
  `Battle.net.exe --exec="launch W3"` to the loading screen, and that the
  game can drop `-loadfile` after a sign-in.

**Risk:** the lowest of the four. It is the editor's own test path, makes no
lobby on Battle.net and changes no game file.

**Limits:**

- Solo only: the map's own setup supplies the computers.
- Every match is a new game process, through Play, with Play's known
  post-sign-in failures.
- Nothing can join.

**Why `wisp play` no longer uses it.** The option loads the map during
startup, and Warcraft III's ladder scan after sign-in then lands mid-load: on
6 Oct every `-loadfile` run on the owner's display logged 326
`model creation failed - war3mapImported/...` lines and drew no stage. The
option can't be delayed, so `play` hosts after the scan instead
([play.md](play.md), step 4).

## 4. Menu clicks (fallback)

**How it works.** A program reads each screen's text and clicks a control
once two reads agree. Wisp no longer creates games this way: `play` and
`freshMatch` host only through the menu page.

**Risk:** a game created by clicks has no password, so Battle.net lists it
publicly. Typing outside a match is refused by Wisp's private-desktop input
(wisp:scripts/warcraft/desktop.ts `requireMatch`).

**Costs:**

- It needs the display and an input path.
- It depends on the resolution and on menu animations.
- Every click waits for a screen, and a changed menu breaks it.

**Still needed for:** leaving a match in progress (Escape, F10, E, Q).

## Excluded: memory on signed-in clients

Wisp never writes to a client signed in to Battle.net. That rules out
wc3-slop-lan's activator and W3Champions' `native_tcpn` on the signed-in
clients. The activator also finds the menus' GUID with `ReadProcessMemory`;
Wisp's menu page reports it instead.

- Blizzard's loader watches the game's code, and changing another
  process's memory is what anti-cheat systems look for.
- That account risk is of a different kind from a UI file.
- Wisp takes it only where no account exists: the offline pool clients of
  [section 2](#2-lan-hosting-offline-clients-and-wisps-host).

## Ranked recommendation

1. **The menu socket, through Wisp's menu page.** It is the only approach that
   creates, joins, starts and leaves games without clicks in a running,
   signed-in client, solo and two-client alike. It needs one setup per prefix
   and carries W3Champions' account risk, so it needs the account owner's
   decision.
2. **`-loadfile` through Battle.net.** It changes nothing in the game, but its
   map loads during the ladder scan and loses its imported models, so
   `wisp play` doesn't use it.
3. **Menu clicks.** Keep them for leaving a running match. A prefix whose
   owner declines the menu page doesn't host through Wisp.
4. **LAN hosting on offline clients.** For parallel bot, parity and engine
   sessions, not for the owner's play: `wisp lan` (section 2).

## Sources

- W3Champions install procedure (menu page and `Allow Local Files`):
  w3champions/website `src/locales/data.ts`, `views_gettingstarted`.
- [Is W3champions against TOS?](https://us.forums.blizzard.com/en/warcraft3/t/is-w3champions-against-tos/37369)
  (Blizzard forums, Nov 2025; a player's answer, no staff reply).
- [Blizzard End User License Agreement](https://www.blizzard.com/en-us/legal/fba4d00f-c7e4-4883-b8b9-1b4500a402ea/blizzard-end-user-license-agreement).
- [Patch 3.0.0](https://liquipedia.net/warcraft/Patch_3.0.0) (Liquipedia):
  LAN removed, Reforged always online, passworded custom lobbies.
- [WC3 Multi-Tool](https://www.hiveworkshop.com/threads/wc3-multi-tool.335492/)
  (Hive Workshop): what the tool modifies.
- wc3-slop-lan `docs/protocol.md` and `docs/porting.md`: the menu socket
  and the LAN provider switch on 3.0.0.24268.
