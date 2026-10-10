# Offline LAN clients

For M1 checks, use the [Wisp scripted driver](headless.md#scripted-driver-and-fast-forward)
instead of starting Warcraft. #38 and #39's native setup/fast-forward goals
were replaced by this path when [#75](https://github.com/tompassarelli/wisp/issues/75)
removed Warcraft as a test dependency. Native clients supply fidelity captures.

Measured 8 October 2026 with the sample map's 120-frame `ping-reload` journey,
two Wisp clients, under the existing shared-machine load:

| Path | Starts | Setup failures / divergence | Wall time | Speed | CPU |
| --- | ---: | --- | ---: | ---: | ---: |
| Native baseline from #38 | one new game per check | not measured here | 42–64 s to start; about 24 s/check | real time | not measured here |
| Wisp `headless ping-reload --step 1 --runs 50 --json` | 50 | 0 / 0 | 1.145 s total; 22.9 ms/start and check | 87.3x | 1.536 s total process CPU |
| Wisp `headless ping-reload --runs 20 --json` | 20 | 0 / 0 | 0.561 s total; 28.1 ms/start and check | 71.3x | 0.720 s total process CPU |

All 70 runs and both clients had checksum `-123668497`, including stepped
versus normal execution. The measured throughput is about 157,000 and 128,000
sample checks/hour, calculated from each batch, versus 150/hour at the native
24-second check baseline. The process loaded the map once before each batch;
end-to-end command times including loading and JSON output were 1.180 s and
0.595 s. These are sample-map Wisp measurements, not a native LAN measurement
or the duration of Smashcraft's full parity batch. No frames are drawn and
no wall-clock waits or engine memory writes are used.

`wisp lan` runs Warcraft III clients that never sign in to Battle.net. The
current checked build is **3.0.0.24268** (9 October 2026), after Blizzard
rolled back 3.0.1. The offline pool is the default for native checks. Its
pairs play LAN matches hosted by Wisp itself: the host relays every turn,
logs every player's actions and compares client checksums.
Each offline pair is isolated in a network namespace with only loopback.

Start from an updated install whose `.build.info` names `3.0.0.24268`:

```sh
bun wisp lan setup --from "<clone>/pfx/drive_c/Program Files (x86)/Warcraft III" --pairs 2
bun wisp lan pool --pair 0 --pair 1 --pool-profile parity
bun wisp lan fresh MAP.w3x --pair 0
```

On 9 October, two pairs played pad scripts concurrently with every native
checksum, row and fighter line equal to headless. A pair ran 70 s after
`lan pool` started and entered its match 36 s after `pad` requested it.
Two pairs are the default under normal agent load: with the signed-in clones
stopped, two pairs measured protected CPU pressure of 11–20%, while three
measured 22–31%. Keep signed-in clones for Battle.net-specific checks.

The private LAN plugin accepts only 24268. If the installed build changes,
check the plugin before requesting pair games. The 3.0.1 observations below
describe the earlier 24342 build, not the current pool path.

**Development and testing on your own offline clients and maps only.** Wisp
never switches a signed-in Battle.net client, and never touches anyone else's
game. It isn't for cheating. The terms are in
[driving-warcraft.md](driving-warcraft.md#2-lan-hosting-offline-clients-and-wisps-host).

## Historical 3.0.1.24342: no LAN provider

**3.0.1.24342 removed the LAN provider, so pool pairs can't play a LAN
match.** Its code has no LAN provider left for the switch (below) to select;
the switch refuses it, and the checked build stays 3.0.0.24268. A LAN match on
3.0.1 would need a provider written into the game, not a switch.
Single-client games still work: see "Solo games" below.

**The clients themselves start.** A pool client on 3.0.1 shows the intro
cinematic, then the same offline sequence 3.0.0 showed (`LOGIN_DOORS`,
`AUTHENTICATION_OVERLAY`, then the `ERROR` modal "There was an error in
handling the request. Please check your VPN"). On 3.0.0 the pool joined LAN
games straight from that modal. An earlier diagnosis blamed the prefix and a
`war3_loader.dll` assertion. Neither held up:

- The game raises a breakpoint and an `0xc0000420` assertion every 10 s and
  handles them itself (30 in 5 minutes on a client that reached the modal).
  A `PROTON_LOG` that shows them isn't a crash.
- The earlier bisection counted a run as a pass only when War3Log said
  `GameMain Started` within 75 s. A fresh prefix writes nothing to War3Log
  while it plays the intro and sits at the modal (still empty after 5
  minutes), and some of those runs were still queued for capacity. Started
  the same way, 16 of 16 fresh prefixes opened the game window.
- The actual hang came from the pool's launch: its private desktops ran in a
  `moderate` batch scope. With the machine at load 70–90 and protected CPU
  pressure at 20–55%, both games of pair 1 sat at 0% CPU with no window for
  10 minutes, their main thread waiting on a lock before `winex11.drv`
  loaded. With the desktops in a `native` scope (below), the same pair
  loaded its menus about 75 s after launch and reached the modal at 3
  minutes.

## Solo games: one offline client, one local game

`wisp lan solo MAP [--pair K...]` puts every client of the running pairs named
(default: every pair in the pool) into its own single-client game of MAP, on
the loopback provider 3.0.1 kept. Each client plays alone, so this is for
single-client checks and engine tools, not checksums between clients. Start
the pairs with `wisp lan pool` first; `lan solo` returns once every client's
game UI is up and prints the seconds each took.

The pair agent (wisp:scripts/wisp/lan/pairAgent.ts, `POST /solo`) copies MAP
into each client's `Maps/Wisp/` and drives each client's menus
(`playLocalGame`, wisp:scripts/wisp/menus.ts) as Single Player's Custom Game
does, with no click, keyboard or memory write:

1. `LoginDoorClose`. A client that never signed in sits at its login doors
   (the "Please check your VPN" modal). There the game refuses every map,
   stock maps included, with "The map is unavailable or corrupted". The
   main menu sends `LoginDoorClose` the first time it shows. After it, the
   game opens every map in the listed folders, as after a sign-in.
2. `InitializeLocalNetProvider`, answered by `OnNetProviderChanged
   {providerId: "LOOP"}` (9 s after the doors closed, under load).
3. `SetLocalPlayerName {playerName}`: a client without an account plays as
   its pool name (`lan0a`). The menus send it from their player-name prompt.
4. `GetMapList` then `CreateLobby`, as `hostLobby` does for signed-in
   clients, then `LobbyStart`.
5. After `MapLoadComplete`, `LoadingScreenGameStart`: the loading screen's
   "press any key". `IsGameUIActive {isActive: "true"}` means the game is
   playing.

Measured 8 October 2026 on 3.0.1.24342, with the machine at load 40 and
three signed-in clients running:

| Map | Clients | `lan solo` to game UI |
| --- | --- | --- |
| Booty Bay (stock, through the menu socket by hand) | lan0b | 13 s |
| SmashcraftBC (177 MB) | lan1a, lan1b | 35 s, 24 s |
| Smashcraft render40-single | lan0a, lan0b | 43 s, 48 s, then both crashed |

Playing the sample map at the parity profile, the two solo clients of pair 0
used 1.07 and 0.97 cores (measured from /proc over about 10 s). From the
pool reporting the pair running to both game UIs up took 67 s, the first
`lan solo` included.

The first `lan solo` on a fresh pair could fail with "list maps: no answer
within 10 s": the game was still opening every map in the folder (34 s on
clone-c, 8 Oct). A map list now waits up to 90 s and says so, and a return
to the menus up to 180 s. Both render40-single clients crashed about 8 s into the game
with the same read of address 0x54. Clone-a crashed hosting that map too, so
the map is the cause, not the solo path.

**One game per launch.** After `EndGame` returned both SmashcraftBC
clients to their menus, `lan solo` with another map crashed both while
loading (a null read). Start the pool again for the next map.

## Signed-in clients cloned from Tom's install

Signed-in clients serve checks that need Battle.net itself, including online
host/join and spectating, and provide the updated install copied into the
offline pool. Leave them stopped for ordinary native checks. They are copies
of Tom's working Steam/Proton prefix
(`~/.local/share/Steam/steamapps/compatdata/3516115571`), as decided in
[#53](https://github.com/tompassarelli/wisp/issues/53). Historically, on 8 October 2026
both reached the main menu on 3.0.1.24342, hosted and joined a private
passworded Smashcraft game, and `archer-neutral.pad` passed parity there.
They run GE-Proton11-7 (wine-staging 11.0) and Steam Linux Runtime 4, as the
pool does.

| Client | Prefix | Account | Menu page port |
| --- | --- | --- | --- |
| A | `~/.local/share/wisp/online/clone-c` | c | 47135 |
| B | `~/.local/share/wisp/online/clone-b` | b | 47133 |
| third client | `~/.local/share/wisp/online/clone-a` | a (Tom's) | 47137 |
| fourth client | `~/.local/share/wisp/online/clone-d` | d (BattleTag tompaslab2) | 47139 |

### Clone-a: Tom's account, only while he isn't playing

Clone-a is a third test client, made the same way as the others on 8 October
but keeping Tom's saved account-a sign-in (steps 2 and 3 below remove the
sign-in from the other clones; clone-a skips step 2). It reached the main menu
signed in as account a on 3.0.1.24342. Battle.net allows one session per
account, so Tom's own game and clone-a would sign each other out.
`launch.sh a RUN_DIR` therefore:

- refuses to start (exit 3) while any process runs Proton or Wine in Tom's
  prefix (its environment names `compatdata/3516115571`) or Tom's desktop
  (Niri, display `:0`) shows a Wine window or one titled `Warcraft III` or
  `Battle.net`;
- checks the same every 2 s while clone-a runs, and when Tom's game or
  Battle.net appears, ends clone-a's capacity session and kills any clone-a
  process left after 6 s (exit 4). With a stand-in process carrying Tom's
  prefix in its environment, clone-a's 22 processes were gone 3.4 s after it
  started.

Run clone-a only through `launch.sh`, which `bun wisp client start clone-a
--clients-file FILE` runs as a service (below). Its yield watch runs inside
that service: with the service path, a stand-in process carrying Tom's prefix
stopped clone-a within 10 s (wisp:docs/doctor.md, "Clients as services"). In a doctor clients file, don't name it
`a` or `b`: doctor maps those names to its own prefixes and to accounts c and
b, and would start the wrong launcher or type the wrong account.

### Clone-d: account d, paired with clone-a

Clone-d is a fourth client, made on 8 October with all three steps below, for
Tom's test account d (BattleTag tompaslab2, `d` in
nixos-config:secrets/bnet.yaml). It runs as a plain clone like clone-b and
clone-c: `launch.sh d RUN_DIR`, no yielding to Tom. Sign it in once with
`wc3-login-field RUN d username|password` as in step 2 of a full session.
Clone-a and clone-d make the second two-client lane. Its clients file names
them `clone-a` and `clone-d`, so doctor starts each through `launch.sh`
(smashcraft:ts/scripts/wisp/doctor.ts) and types no account:

```json
{ "clients": [
  { "name": "clone-a", "run": "RUN_A", "documents": "~/.local/share/wisp/online/clone-a/pfx/drive_c/users/steamuser/Documents/Warcraft III", "menuReportPort": 47137 },
  { "name": "clone-d", "run": "RUN_D", "documents": "~/.local/share/wisp/online/clone-d/pfx/drive_c/users/steamuser/Documents/Warcraft III", "menuReportPort": 47139 }
] }
```

with absolute paths in place of `~`.

The lanes' clients files are kept in `~/.local/state/wisp/online/`:
`ad-clients.json` (clone-a + clone-d) and `bc-clients.json` (A and B, named
`a` and `b`). A lane owner starts its clients with `bun wisp client start
--clients-file FILE`: each client without a live desktop gets one as the user
service `wisp-desktop-CLIENT`, its new run folder is written into the file,
and doctor starts Battle.net as `wisp-client-CLIENT` and waits for the menu.
The services outlive the owner's turn and any task time limit;
`client status` shows them and `client stop` ends them
(wisp:docs/doctor.md, "Clients as services"). Don't start a clone with
`launch.sh` from an agent's shell or background task: it ends with that task. On 8 October clone-d kept its login: after
Battle.net was closed and `launch.sh d` started again, it signed in by itself
in 16 s, and `bun wisp client doctor --clients-file
~/.local/state/wisp/online/ad-clients.json clone-d` pressed Play and reached
the main menu in 97 s. On that desktop `wc3-login-field`'s typing didn't reach
the login form; typing through the desktop's VNC port did.

### Making a clone

With nothing running in Tom's prefix:

1. `cp -a --reflink=always ~/.local/share/Steam/steamapps/compatdata/3516115571 ~/.local/share/wisp/online/clone-c`
   (the 110 GB prefix copies in about 8 s on btrfs).
2. Remove the copied sign-in, so the clone never signs in as Tom: in the
   clone's `pfx/drive_c/users/steamuser/AppData`, delete
   `Local/Battle.net/Account`, `Local/Battle.net/BrowserCaches`,
   `Local/Battle.net/BlizzardBrowser` and the per-account
   `Roaming/Battle.net/*.config` files other than `Battle.net.config`; in
   `Battle.net.config` set `Client.SavedAccountNames` to `""` and
   `Client.AutoLogin` to `"false"`; and, with no wineserver on the clone,
   drop the `Battle.net\\UnifiedAuth`, `Battle.net\\Identity` and
   `Battle.net\\EncryptionKey` sections from its `pfx/user.reg`.
3. `bun wisp menus install "<clone>/pfx/drive_c/Program Files (x86)/Warcraft III/_retail_" --port PORT`
   with the port in the table (Tom's install uses 47124).

### Launching

`~/.local/share/wisp/online/launch.sh a|b|c|d RUN_DIR` starts the clone's
Battle.net on a private desktop, in its own `native` capacity scope. Doctor
and `client start` run it as the user service `wisp-client-clone-X`. It runs
what Steam's `Warcraft III (Battle.net)` shortcut runs, with
`STEAM_COMPAT_DATA_PATH` pointed at the clone and no Steam shortcut added:

```sh
exec bun "$capacity" session --class native --owner "wisp-online-clone-$1" -- \
  env -i HOME="$HOME" USER="$USER" PATH=/run/current-system/sw/bin \
  DISPLAY="$(<"$run/display")" WAYLAND_DISPLAY="$(<"$run/wayland-display")" XDG_RUNTIME_DIR="$run/runtime" XAUTHORITY= \
  PULSE_SERVER="unix:/run/user/$(id -u)/pulse/native" PULSE_SINK="wisp-online-clone-$1" \
  dbus-run-session -- steam-run env \
  STEAM_COMPAT_DATA_PATH="$clone" STEAM_COMPAT_CLIENT_INSTALL_PATH="$steam" STEAM_COMPAT_APP_ID=3775098022 \
  SteamAppId=3775098022 SteamGameId=16213922543717842944 \
  "$steam/steamapps/common/SteamLinuxRuntime_4/_v2-entry-point" --verb=waitforexitandrun -- \
  "$steam/compatibilitytools.d/GE-Proton11-7-x86_64/proton" waitforexitandrun \
  "$clone/pfx/drive_c/Program Files (x86)/Battle.net/Battle.net Launcher.exe"
```

Never set `PROTON_LOG` on the clones: it grew ~280 GB per clone and saturated
disk IO. The nixos-config watchdog `proton-log-watchdog` strips it from
`launch.sh` and truncates clone `steam-*.log` files over 1 GiB.

Before that it creates the clone's silent PipeWire sink, `wisp-online-clone-<a|b|c|d>`,
as `lan pool` does for its clients. Without one, the first client takes the
sound device and the second starts with "Unable to initialize audio device":
its `GetSoundFileDuration` reads 0 and a map that reads it desyncs (wisp#60).

A full session, from smashcraft:ts/:

1. Point a clients file at the clones (names `a` and `b`, the clone's
   `Documents/Warcraft III` and its port) and run `bun wisp client start
   --clients-file FILE`: it starts their desktops and Battle.net as services.
2. A clone without a saved login stops start at its sign-in form. Sign each in at its "Log in or sign up" form with
   nixos-config:dotfiles/bin/wc3-login-field: click the field until it has
   focus (the first click after the window opens only activates it), type the
   account name, press Enter, tick "Keep me logged in", type the password in
   the focused field and press Enter. The launcher log then says "Logged into
   Battle.net successfully". A mistyped account name opens Battle.net's
   account-creation page, which draws black on the private desktop; close
   that launcher and start again.
3. Run `bun wisp client start --clients-file FILE` again: doctor presses Play
   and it waits for the main menu (83 s and 118 s on 8 October).
4. Pass the same file to `pad` and `fresh`, which leave
   `~/.local/state/smashcraft/clients.json` alone:
   `bun wisp fresh MAP --no-quick --clients-file FILE` hosts the private
   passworded game (56 s to fighter selection), and
   `bun wisp pad SCRIPT --helper H --build typescript-integrity --out NATIVE --app-id a=steam_app_3775098022 --app-id b=steam_app_3775098022 --map MAP --clients-file FILE`
   followed by
   `bun wisp pad SCRIPT --headless --helper H --out HEADLESS --compare NATIVE`
   checks parity. On 8 October `archer-neutral.pad` landed 32 of 32 edges on
   their frames and passed: 10 native checksums replayed equal, 376 frames of
   rows, 39 fighter lines and 11 expectations.

The copied launcher logs and `smashcraft-*` receipts from Tom's install can
stay: doctor reads only launcher logs written since the running launcher
started, and the pad runner ignores receipts written before its session began.

Tom's `system.reg`, `user.reg`, `Warcraft III/.build.info` and Battle.net
`product.db` hashed the same before and after the session.

## Commands

| Command | What it does |
| --- | --- |
| `wisp lan setup --from INSTALL [--pairs N \| --pair K...]` | Creates the pool's clients from an existing Warcraft III install folder (the one holding `_retail_`): pairs 0..N-1, or only the pairs named, leaving clients other runners use alone. See "Setting up". |
| `wisp lan pool [--pairs N \| --pair K...] [--pool-profile parity\|visual\|hfr[,...]] [--fps N] [--seconds S]` | Runs up to N pairs, each admitted by the machine-capacity helper. It stays in the foreground; Ctrl-C stops the pool. |
| `wisp lan fresh MAP [--pair K] [--computers N] [--turn-ms MS]` | Hosts MAP on pair K, switches both clients to LAN, joins them, and returns once the match plays. It prints the game's action log. |
| `wisp lan dummy MAP --program W3GSCLIENT [--pair K] [--count N]` | Joins side a to a lobby, then runs N dummy joins, handicap changes and leaves (default 20). The pair must have no active game. |
| `wisp lan solo MAP [--pair K...]` | Each client of the named running pairs (default: all) plays MAP alone, as a local game on the loopback provider; returns once every client's game UI is up. Works on 3.0.1. See "Solo games". |
| `wisp lan status [--pair K]` | Each pair's clients and processes, and its game: phase, turns, desyncs, players. |
| `wisp lan speed N --pair K` | Diagnostic turn delivery at 1–16 times real time; 1 restores normal delivery. Measure client frame progress to establish actual game speed. |
| `wisp lan netem --pair K --rtt MS [--loss PERCENT]`, `wisp lan netem off --pair K` | Adds round-trip delay and packet loss to pair K's loopback, or removes it, and prints the loopback's queueing discipline. See "Simulated latency and loss". |
| `wisp lan end --pair K` | Ends pair K's game. The clients go back to their menus. |

Pool clients are named `lan<K>a` and `lan<K>b`. The pool writes three files
under `$XDG_STATE_HOME/wisp/lan/` (default `~/.local/state/wisp/lan/`):

- `pool.json`: its pairs, their agent sockets and desktops;
- `clients.json`: every pool client in the clients-file schema
  (`WISP_CLIENTS=~/.local/state/wisp/lan/clients.json`);
- `pair-K/clients.json`: one pair's clients, named `a` and `b`, for tools
  written against two clients A and B.

`pair-K/<client>-menus.log` keeps every request that client's menus send, as
`wisp menus listen` prints them: the agent holds the clients' report ports.

Each game's files are under `pair-K/games/<time>/`: `actions.log` and
`packets.log` (every packet except empty turns, in hex).

## Dummy lobby checks

`wisp lan dummy MAP --program /path/to/w3gsclient --pair K` uses the
unmodified [GoWarcraft3 command](https://github.com/nielsAD/gowarcraft3/blob/f13251b6caed199c3347214f4591e7ccaa96c7c7/cmd/w3gsclient/main.go)
at revision `f13251b6caed199c3347214f4591e7ccaa96c7c7` as a separate program.
Build it in its own checkout with `CGO_ENABLED=0 go build -o w3gsclient
./cmd/w3gsclient`. It is MPL-2.0; Wisp neither copies nor distributes its
source or executable. Keep its licence with any copy you distribute and make
the corresponding source available under MPL-2.0.

The command enters the existing pair's loopback-only namespace and uses only
side a. The host stays in the lobby. Each new dummy process uses protocol
version 10200, answers the map and profile handshake, requests handicap 90,
receives the changed slot table, then leaves. Wisp resets its vacated slot.
The original command's peer dialing is disabled: these checks exercise the
host connection. The map must put its first human player in player slot 1.
The dummy acknowledges the advertised map size without reading or executing
the map; map-file validation, gameplay, checksums and peer connections still
need real clients.

Results go to `pair-K/dummy/<time>/`: packet and action logs, one log per
dummy, and `result.json` with each join time, CPU sample and resident memory.
The result also records the native build, setup milliseconds and a `passed`
or `failed` status. A failure preserves completed runs, the first failed step
and its error, including a refusal before the first W3GS packet. Keep that
folder private. On a client with a working LAN provider, these lobby checks
can replace the second native client for join/leave, profile/map-message
handling and handicap slot updates. The
pool still starts pairs; an executor may stop its unused side b to measure
the one-client footprint.

On 7 October 2026, the isolated protocol run completed 20 joins, handicap
changes and leaves with zero errors against Wisp's host. Median join time was
12.4 ms and resident memory was 5.5–5.9 MiB. A corrected CPU sample used
3.685 ms of CPU over 285.64 ms (0.0129 core), with 5.61 MiB resident memory.
The two-native baseline below used 1.26 cores and 2.17 GB resident memory;
the second client alone used 0.52 core and 0.80 GB. These are separate lobby
and match samples, not a measured one-native replacement speedup.

**3.0.1.24342 cannot join this host.** The first unsupported step is choosing
the native LAN provider, before a `ReqJoin` (W3GS packet `0x1e`) can be sent.
The 8 October native investigation rebuilt lan1a's provider and found only
`BNET` and `LOOP`; a different provider id returns unsupported result 4.
`TCPN` is absent. The private LAN plugin refuses this build before changing
the client. Consequently there are zero native-plus-dummy lobby joins on
this build, and no supported native setup time or resource comparison.
Changing the dummy's packet version cannot supply a missing native transport.
This is the measured incompatibility result for
[#46](https://github.com/tompassarelli/wisp/issues/46).

Wisp's host protocol checks can use simulated W3GS players for the two sides:
join/leave, map/profile replies and handicap changes already completed the
20-round check without Wine. Gameplay pairs run through Wisp's headless
clients; a W3GS dummy does not execute their map. Native reference captures
that need a real peer still use signed-in clients. Adding a native `TCPN`
provider or emulating Battle.net is outside this tool's scope.

## Guardrails

- **Offline only.** Before it writes into a client's code, Wisp checks that the
  client's `/proc/PID/net/dev` lists nothing but `lo`. Pool clients run inside
  `bwrap --unshare-net`, so Battle.net is out of reach, and no client has a
  saved account to sign in with. A client with any other network is refused.
- **Declared clients only.** `wisp lan` works on the clients it created. `wisp
  engine actions` accepts only a pair from the pool's clients file.
- **Checked builds only.** The switch (Wisp's private LAN plugin) refuses
  builds it hasn't been checked on (3.0.0.24268), logs each change, and puts
  the client back within a fraction of a second.

## Setting up

Running `setup` again refreshes an existing client's install when its Warcraft
executable differs (size or modification time) from `--from`, then reinstalls that client's menu
page. Stop the pool first, and use an install whose update has finished.

`wisp lan setup --from "<a prefix>/drive_c/Program Files (x86)/Warcraft III" --pairs N`
makes, for each client:

- a fresh GE-Proton prefix under `$XDG_DATA_HOME/wisp/lan/clients/<name>/`
  (default `~/.local/share/wisp/lan/clients/<name>/`), created inside a network
  namespace with nothing but loopback. It holds no Battle.net and no account.
  Its only setting is `HKCU\Software\Blizzard Entertainment\Warcraft III` →
  `Allow Local Files` = 1, which the menu page needs;
- a reflinked copy of the install (`cp --reflink=always`). On btrfs or xfs a
  33 GB install costs no space until a file in it changes;
- Wisp's menu page ([driving-warcraft.md](driving-warcraft.md#1-the-menu-socket-recommended)),
  reporting to the client's own port (47200 + 2K for side a, 47201 + 2K for side b).

The source install must have been started once through Battle.net. Setup
reads it and never changes it.

## Running a pool

Each client has its own private desktop (the private-desktop-development
launcher), so each display has exactly one game window, as on clients A and
B. Tools that find "the" Warcraft window on a display work unchanged, and so
do controller helpers that type into it. A pair's session
(wisp:scripts/wisp/lan/pairSession.ts) starts client b's desktop, then client
a's. Client a's desktop runs the pair's `bwrap --dev-bind / / --unshare-net`
namespace, and the pair agent (wisp:scripts/wisp/lan/pairAgent.ts) runs inside
it. The agent:

- writes each client's `War3Preferences.txt` for the profile;
- launches both games with `-launch -windowmode windowed -nowfpause`, through
  steam-run, Steam Linux Runtime 4 and GE-Proton 11-7, as the signed-in
  clients run. Both share the namespace, and client b draws on its own
  desktop;
- sets each window to the profile's size at its desktop's top left. The game
  can open a window larger than its settings ask;
- plays each client's sound into its own silent sink, `wisp-lan-<name>`, on
  the user's PipeWire (a null sink the agent creates, `PULSE_SINK` at launch).
  The owner's speakers stay quiet, and `pw-record --target wisp-lan-lan0a.monitor
  OUT.wav` records exactly that client's audio. Without the user's PipeWire
  pulse socket the clients run without sound;
- answers on `pair-K/agent.sock`. A Unix socket reaches across network
  namespaces, so `wisp lan fresh` and `status` talk to it from outside.

Each pair's desktops and agent run in one `machine-capacity session --class
native --memory-gib 1`. A game waits on its desktop's Xwayland, and in the
low-weight batch slice a busy machine starved the desktops until 3.0.1 games
hung before opening a window. Admission uses the user's service bus and runtime directory;
inside the scope the game receives its private desktop's runtime directory
and its own session bus. Each game runs in its own `session --class native` scope: the
high-weight slice for game clients, with no CPU quota. Each offline client
requests 1.5 GiB through `--memory-gib`; measured
parity clients used 0.8–1.4 GB resident memory. This sizes admission and
`MemoryHigh` while keeping the native class's CPU treatment. The pool adds
pairs while the helper admits them, probing native admission and requiring
`protectedCpuSomeAvg10` below 20% before each new pair, in present and away
mode. A deferred pair is retried every 45 s, for up to `--wait` seconds
(default 1800). After that the pool keeps its admitted pairs and lists the
remaining pair numbers as waiting. The agent stops its games when it is
stopped, or when its pair's session ends.

- `--pair K` (repeated) picks which pairs start, in that order of admission.
- If the helper defers either game's native scope, the pair agent stops any
  game already started for that pair. `lan pool` retries the whole pair.
  Direct pair-session and agent entry points require the capacity helper too.
- Several pools may run at once, each on its own pairs (one per agent). A
  pool merges its pairs into `pool.json` and `clients.json`, keeping every
  other pair whose agent socket exists, so starting pair 5 never unlists pair 3.
- `--profile` takes one profile, or one per pair separated by commas; the last
  one repeats.

`pair-K/clients.json` gives each client its own `run` (desktop) and `pid`.

**Why a desktop per client.** labwc opens every game window at the same
place, and Xwayland throttles a window another window covers. On 7 October,
both clients of a pair shared one desktop. The covered client loaded 70 s
after the other, then ran 51 turns behind, so the host kept pausing the game.
With the windows apart, both kept within a few turns at 1:1 game time. Two
controller helpers typing on one display would also take each other's focus.

**Profiles** (wisp:scripts/wisp/lan/pool.ts `PROFILES`). Each one writes the
client's War3Preferences `[Video]`, `[Misc]` and `[Sound]` at launch:

- `parity` (the default) is for checksum and input runs, which need no pixels
  and no sound. It has an 800×600 window, every quality setting at its
  lowest, classic models and textures (`hd=0`), and sound off.
- `checks` is parity with sound effects (music off), for checks that record a client's audio.
- `visual` is 1280×720, with more lighting and texture detail, in Classic.
- `hfr` is parity at 144 frames a second, for comparing the game's clocks
  against the 60 fps cap.
- `capture-classic` uses a 1280×720 window at 60 fps with high lighting,
  shadows, point-light shadows and water, medium textures, and ambient
  occlusion enabled. Sound effects are on and music is off, so the same
  profile can record effect audio. Pool metadata records the selected
  profile. Retain that metadata and the saved preferences with captures.

**The pool draws only Classic.** Its clients never sign in, and an unsigned
client draws Classic models whatever `[Misc] hd` says. On 9 October 2026
(3.0.0.24268) a Rifleman stand frame on lan0a at `hd=0` and at `hd=2` differed
in 5 of 16,800 pixels, and still did with `settingsversion=3` and
`mostRecentlySeenGraphicsMode=2` added; the same map on signed-in clone-c at
`hd=2` drew the Definitive Rifleman and Illidan (2,277 of 16,800 pixels
differ). Reforged and Definitive checks run on signed-in clones b, c and d
with the `capture-reforged` or `capture-definitive` clients file profile
([doctor.md](doctor.md#graphics-profiles)), set before launch.

Warcraft **3.0.1.24342**'s installed `webui/GlueManager.js` maps
`PREF_GENERAL_HD` to SD=0, HD=1 and DE=2; the saved preferences store that
choice as `[Misc] hd`. The pool profiles all write Classic (`hd=0`); a signed-in client's `visual`
writes Reforged (`hd=1`) and `capture-definitive` writes Definitive Edition (`hd=2`). Audio checks therefore use Classic
sounds; Definitive Edition also uses Classic sounds. The capture profiles set Ambient Occlusion on (`assao=1`); the other profiles set it off (`assao=0`). All omit
`bloom`, `portraitBloom`, `particles` and `spellfilter`. Smashcraft play explicitly chooses Reforged (`hd=1`) and Ambient Occlusion off too.

The others cap the game at 60 frames a second, focused or not. A cap below
the turn rate (33 turns a second at 30 ms) is untested.

`wisp lan pool --pair K --pool-profile parity --fps N` overrides both
foreground and background caps while holding the profile's resolution,
quality, model set and sound fixed. The agent status and metadata record the
effective cap. Use one active script and map revision for both caps, measuring
per-client CPU and DRM GPU-engine time over the same interval, alongside
protected CPU pressure. Keep the cap only when the same script passes parity
and game time keeps pace with wall time; reduced rendering can delay input
even when the LAN turn rate is lower than the cap. A different cap applies
when that pair starts, through the normal capacity admission path.

**Cost at parity** (7 October, two clients in a match on Smashcraft
bisect-588610b7, measured over 10 s from /proc):

| | lan0a | lan0b |
| --- | --- | --- |
| CPU | 0.74 core | 0.52 core |
| Resident memory | 1.37 GB | 0.80 GB |
| GPU memory (VRAM + GTT, from DRM fdinfo) | 666 + 75 MiB | 666 + 75 MiB |

The two game processes therefore used **1.26 cores per pair** at the parity
profile's 60 fps cap. On 8 October, parity solo games used 1.07 and 0.97
cores, **2.04 cores for the two games** (see "Solo games"). These samples
measure game processes, not the desktop, Wine server or launcher. The
7 October 22:39 pool sample in [#37](https://github.com/tompassarelli/wisp/issues/37)
separately measured about 0.88 core per game, 0.38 per browser renderer and
0.34 per Wine server under heavy contention; it did not separate profiles.

### Pool cost per profile and the browser

Offline pool launch on 3.0.0.24268 runs `Warcraft III.exe` directly, without
the Battle.net launcher. The game still starts its own `BlizzardBrowser.exe`
(CEF), because its menus are web pages: the pool drives the game through
Wisp's menu page, which that browser renders.

**Measured 9 October 2026** (3.0.0.24268, editor-free sample map started by
`lan fresh`, every pair playing at speed 1 with 0 desyncs). Each 10 s sample
read `/proc` utime + stime of every process whose `WINEPREFIX` is the
client's, inside an exclusive machine-capacity lease; signed-in clone-c,
owned by another worker, was also running. Cores, per client a / b:

| Profile | fps cap | Game | Browser processes (renderers) | Browser | Client total with browser | Client total without browser | Pair with | Pair without |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `parity` | 60 | 1.19 / 1.33 | 5 / 5 (2 / 2) | 0.16 / 0.14 | 1.59 / 1.72 | 1.43 / 1.59 | 3.31 | 3.02 |
| `checks` | 60 | 1.24 / 1.29 | 5 / 5 (2 / 2) | 0.14 / 0.15 | 1.63 / 1.69 | 1.48 / 1.54 | 3.31 | 3.02 |
| `visual` | 60 | 0.68 / 0.56 | 8 / 8 (4 / 4) | 0.20 / 0.20 | 1.22 / 1.08 | 1.02 / 0.88 | 2.30 | 1.90 |
| `hfr` | 144 | 0.65 / 0.81 | 8 / 8 (4 / 4) | 0.47 / 1.34 | 1.51 / 2.77 | 1.04 / 1.43 | 4.28 | 2.47 |
| `capture-classic` | 60 | 1.00 / 1.01 | 4 / 4 (2 / 2) | 0.22 / 0.21 | 1.49 / 1.50 | 1.27 / 1.29 | 3.00 | 2.56 |

"Without browser" is the same sample less the client's browser processes;
the rest is the game, its Wine server (0.11–0.31) and other Wine processes
(0.13–0.31). System CPU pressure (some avg10) was 22–24% for `parity` and
`checks`, 36% for `visual` and `hfr` and 35% for `capture-classic`, so compare
profiles within one row's conditions. `hfr`'s browser cost rises with its
144 fps cap: 0.47 and 1.34 cores, against 0.14–0.22 at 60 fps.

**Pool clients cannot run with 0 browser processes.** In the two-pair
`parity`/`checks` run, all four clients at the menu and in the match had
5 `BlizzardBrowser.exe` processes each, 2 of them renderers: 8 renderers,
20 browser processes. Killing all 10 browser processes of pair 1 mid-match
left the match playing (0 desyncs), but each game restarted its browser
within 10 s, again 5 processes with 2 renderers. The menu page that
`lan fresh` and the return to menus drive runs in that browser, so
the pool keeps it; its cost at 60 fps is 0.14–0.22 core per client, 0.29–0.43
per pair.

**Admission with real clients.** `wisp lan pool --pairs 4 --wait 60 --pool-profile
parity,checks,visual,hfr` with clone-c's two native leases already held
started pairs 0 and 1, then the helper deferred pair 2's second game
(`DEFER_NATIVE_CPUS`, 22 of 20 native CPUs in the attended profile; once
protected CPU pressure was 23.75%). After 60 s the pool printed "the pool
stays at 2 pairs; waiting: 2, 3" and kept both admitted pairs running.

Earlier read-only samples of signed-in clones (9 October, 10.020 s, no pool
clients) found 5 browser processes per clone, 2 of them renderers:

| Client | Game CPU (cores) | Browser renderers | Renderer CPU (cores) | Other browser CPU (cores) | Wine server CPU (cores) |
| --- | ---: | ---: | ---: | ---: | ---: |
| clone-b | 0.331 | 2 | 0.358 | 0.359 | 0.148 |
| clone-c | 0.805 | 2 | 0.344 | 0.355 | 0.140 |
| clone-d | 0.309 | 2 | 0.358 | 0.383 | 0.135 |

A signed-in clone's Battle.net browser costs 0.70–0.74 core, about four times
a pool client's at 60 fps.

**Rendering is on the GPU.** Pool clients render through DXVK (`d3d11=n`,
`dxgi=n` in Proton's `WINEDLLOVERRIDES`) on RADV. The Vulkan loader maps every
ICD it is offered, so lavapipe (`libvulkan_lvp.so`) and `libLLVM` appear in
`/proc/PID/maps`, but that is enumeration, not use: on 7 October every pool
client held 540–670 MiB of VRAM and accumulated `drm-engine-gfx` time on the
AMD device (0000:c1:00.0) in its DRM fdinfo. Forcing the Radeon ICD cannot cut
CPU; the CPU is spent in the game's own threads.

**A spinning client costs three times a normal one.** Measured from
`/proc/PID/task/*/stat` over 10 s with the machine at load ~140 on 24 cores,
nine pool clients used 0.29–0.82 core each, their busiest thread sleeping
thousands of times (voluntary context switches). Two clients (lan3a in a
parity pair, lan1a) used 1.97 and 2.29 cores: three threads each at 60–80% of
a core with zero voluntary context switches, so they never block and spin in
user space. Check `voluntary_ctxt_switches` in each thread's `status` before
blaming settings: such a client is the one to stop or restart.

## How a match starts

`wisp lan fresh MAP --pair K` asks the pair agent for a game. The agent:

1. copies MAP into each client's `Documents/Warcraft III/Maps/Wisp/`;
2. reads the map's facts (map.ts): its size, CRC32 and SHA-1, the xoro
   checksum of its game files (Flo's, plus `war3map.w3l` after `war3map.w3q`
   on 3.0.0.24268), its playable size, and its players and forces from
   `war3map.w3i`;
3. starts the host (host.ts) on a free TCP port and announces the game every
   second to UDP 16000–16007. Each client takes the first free port from 16000
   for its LAN socket, and the game's own search goes to 16000 (held by the
   first client), so the host announces to the clients instead of answering
   searches. Discovery closes when countdown starts. An unused announcement
   port can leave Bun 1.3.13 spending nearly one core on the UDP socket even
   after announcements stop. A two-second isolated sample used 1.66 CPU-seconds
   with that socket open and 0.003 after closing it; gameplay needs only TCP;
4. for each client, switches its provider to LAN (below), then sends its
   menus `SendGameListing` and `GetGameList` until the game is listed, then
   `JoinGame` with the listed id;
5. runs the lobby. Each join gets its slot table, the other players' info,
   skins and profiles, and the map check. A client answers with its map's size
   (0 means it has no matching map). Once every client has the map, the host
   sends the countdown, 6 s apart (shorter makes slow clients quit), and
   waits until every client has loaded.

The join burst and the game loop follow W3Champions' Flo
(github.com/BogdanW3/W3C-Flo, MPL-2.0) and the protocol notes of
wc3-slop-lan (github.com/Promises/wc3-slop-lan, no licence: read for facts
only). Wisp's code is its own; no file of either is copied.

### The switch to LAN

Patch 3.0.0 left the LAN provider in the game, but the menus only ever ask for
the loopback one. Before each join, the agent briefly switches the client to
the LAN provider and puts it back within a fraction of a second. That code reads
and patches the running game, so it isn't in this repository
(wisp:docs/clean-room.md): Wisp loads it from Wisp's private LAN plugin at
`~/.local/share/wisp-private/lan/` (wisp:scripts/wisp/lan/plugin.ts) when
the owner has it. Without the plugin, `wisp lan pool` stops and says the plugin
is missing.

## The action log

### Faster turn delivery

`wisp lan speed 4 --pair K` asks the existing host to deliver four game-time
turns in the wall time normally used for one. Accelerated packets retain the
configured `turn-ms` game-time step. `wisp lan speed 1 --pair K` restores
normal delivery. The action log records every speed change, and status
reports the requested `speed`. The host still waits when a client falls more
than 50 turns behind and compares all returned checksums.

This is an experiment control, not a measured native fast mode. Host
`gameSeconds` measures delivered time; compare the map driver's frame progress
against wall time to find the speed the clients actually sustain. Rendering
is unchanged. A full parity run needs separate measurements with rendering
suppressed before `pad --fast` can be offered.

FLO's observer send queue uses the same protocol fact: speed changes packet
delivery delay, not the game-time increment encoded in each packet
([source at 6db3a401](https://github.com/BogdanW3/W3C-Flo/blob/6db3a4010fab0b0b29824a61f2c9c956f97fd211/crates/client/src/observer/send_queue.rs)).
Wisp's implementation changes its existing timer; no FLO code is copied.

### Simulated latency and loss

A pair's clients and host talk only over the loopback of the pair's own
network namespace, so `wisp lan netem --pair K --rtt 60 --loss 1` puts a
Linux `netem` queueing discipline on that loopback
(wisp:scripts/wisp/commands/lan.ts, `netem`). Every loopback send is delayed
once, so each send waits half the round trip (30 ms here) and each send is
dropped with the given percentage, in both directions. Running it again
replaces the setting; `wisp lan netem off --pair K` removes it. The pair keeps
it until it is removed or the pair stops.

The namespace belongs to the pair agent's user namespace (bwrap
`--unshare-net`), so Wisp enters both with `nsenter --user --net
--preserve-credentials --keep-caps`, which keeps the user namespace's
`CAP_NET_ADMIN` for `tc`. No root or host network change is needed.

### Reading the log

`wisp client watch` observes each declared pool client through its host's Unix
socket, since the client's menu socket is inside the isolated network.
Typing a developer command requires the host to report that exact running
process as loaded, connected and playing. Lobby, loading, ended and stale
process observations permit no chat. Helpers use the client's Steam window
ID (`steam_app_3516115600` and up) to verify private-desktop focus.

Every `turn-ms` (30 by default) the host sends each client the actions
collected since the last turn (IncomingAction, with a CRC16). Each client
answers every turn with a checksum of its game state (OutgoingKeepAlive). The
host compares the Nth answer of every client, and holds the game while a
client is more than 50 turns behind. `actions.log` starts with a `#` header
that names its start time, then one line per event, in seconds since then:

```
8.358 join lan0a p1 as "" from 127.0.0.1:34084
9.370 map lan0a has it
12.917 phase countdown
99.869 phase playing
100.834 mark turn 32 game 0.965 behind lan0a=1 lan0b=2
104.347 turn 59 lan0a p1 sync prefix="SC_FE" bytes=0 data=""
256.536 chat lan0b p2 "-dev quick"
256.548 turn 4468 lan0b p2 chat trigger=10a3:10a3 text="-dev quick"
256.548 turn 4468 lan0b p2 key object=cbe:cbe event=525113 key=13 meta=0
...  desync turn 100 lan0a=00000001 lan0b=00000002
```

- **Action lines** (actions.ts) carry the turn, the client and its player
  slot, then the action. The kinds are `order` (with its order id, unit and
  target), `select`, `group`, `sync` (BlzSendSyncData, action 0x77: prefix,
  length, data), `chat` (the map's chat event, 0x60), `key` and `frame`
  events, `cache` stores, `pause` and `speed`. An unknown action id ends that
  player's block with a `raw` line in hex.
- **A mark line** about every second pins the turn count to the time, so other
  logs align between actions. It ends with each connected client's turns
  behind: turns sent minus checksums returned. A Warcraft client stops when
  its turns stop, so this lag, not the map's frame-based lateness, shows a
  stall.
- **Event lines** cover joins, map checks, phases, loads, leaves (with their
  reason), chat, and every desync, with each client's checksum.

Tests replay a recorded exchange of two offline clients through the host
(wisp:test/fixtures/lan/offline-pair.packets, wisp:test/lan.test.ts).
