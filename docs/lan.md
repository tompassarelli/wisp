# Offline LAN clients

`wisp lan` runs Warcraft III 3.0 clients that never sign in to Battle.net, in
pairs that play LAN matches hosted by Wisp itself. The host relays every turn,
so it logs every player's actions and compares every client's state checksum
each turn. Each pair is isolated in a network namespace with nothing but
loopback.

**Development and testing on your own offline clients and maps only.** Wisp
never switches a signed-in Battle.net client, and never touches anyone else's
game. It isn't for cheating. The terms are in
[driving-warcraft.md](driving-warcraft.md#2-lan-hosting-offline-clients-and-wisps-host).

## 3.0.1 startup failure

On 8 October 2026, updated **3.0.1.24342** clients stopped before creating a
Warcraft window, reporting a menu, or loading a map. Wine recorded an
`0xc0000420` assertion in `war3_loader.dll`, followed by
`RtlpWaitForCriticalSection` timeouts on `ntdll/loader.c: loader_section`.
An exact fresh copy of the updated installation and the successful Steam
launch wrapper both reproduced the failure. The runtime and `-launch`
argument already matched the working launch. The last working offline build
was **3.0.0.24268**.

Two separate signed-in 3.0.1 clients also failed to reach a menu, including
one after Battle.net's Scan and Repair returned to Play. The cause has not
been isolated to offline use. The Agent-presence experiments were invalid or
cancelled.

The operator paused diagnosis at 02:52, then superseded that pause at 03:00
(UTC+8) on the same day. Further offline experiments use a new private
baseline and separate per-client reflinks under `~/.local/share/wisp/lan/`,
with distinct inodes and no links back to the source install. The test
prefixes hold no Battle.net program or account, and only one game file changes
per attempt. Tom's installation stays untouched; its SDK hash is checked
before and after. The installed Blizzard loader has not been patched, and no
engine offset change has been applied.

The isolated comparisons changed one startup file at a time:

| Executable / loader / SDK builds | Observed startup result |
| --- | --- |
| 24342 / 24342 / 24268 | Same loader assertion; no menu or map acknowledgment. |
| 24342 / 24268 / 24342 | Loader attach did not return within 86 seconds; no menu or map acknowledgment. |
| 24268 / 24268 / 24342 | Loader assertion and an error-reporter window; no menu or map acknowledgment. |
| 24268 / 24268 / 24268 | Same loader assertion; no menu or map acknowledgment. Other installed files still came from 24342. |

At 03:24 the operator authorized one Internet-route comparison with the last
combination, keeping its prefix and launch unchanged and using no account,
Battle.net program, or engine controls. It failed with the same assertion
within a minute. Offline experiments then stopped, and all three startup
files were restored from the private 24342 baseline. The source SDK hash
remained unchanged throughout.

A subsequent authorized test ran the restored private 24342 copy on the
main `:0` display. It produced the same loader assertion before loading
D3D/Vulkan, with no game window or map acknowledgment. Its process was closed.

The [official 3.0.1 notes](https://us.forums.blizzard.com/en/warcraft3/t/warcraft-iii-reforged-forsaken-kingdom-patch-notes/38400/4)
include a game-start performance fix; the startup failure's cause is still
being compared against recorded working launches.
[Issue #49](https://github.com/tompassarelli/wisp/issues/49)
retains the unfinished 3.0.1 memory checks: an uninitialized process with no
presence table is not evidence of a changed table layout.

## Commands

| Command | What it does |
| --- | --- |
| `wisp lan setup --from INSTALL [--pairs N \| --pair K...]` | Creates the pool's clients from an existing Warcraft III install folder (the one holding `_retail_`): pairs 0..N-1, or only the pairs named, leaving clients other runners use alone. See "Setting up". |
| `wisp lan pool [--pairs N \| --pair K...] [--pool-profile parity\|visual\|hfr[,...]] [--fps N] [--seconds S]` | Runs up to N pairs, each admitted by the machine-capacity helper. It stays in the foreground; Ctrl-C stops the pool. |
| `wisp lan fresh MAP [--pair K] [--computers N] [--turn-ms MS]` | Hosts MAP on pair K, switches both clients to LAN, joins them, and returns once the match plays. It prints the game's action log. |
| `wisp lan dummy MAP --program W3GSCLIENT [--pair K] [--count N]` | Joins side a to a lobby, then runs N dummy joins, handicap changes and leaves (default 20). The pair must have no active game. |
| `wisp lan status [--pair K]` | Each pair's clients and processes, and its game: phase, turns, desyncs, players. |
| `wisp lan speed N --pair K` | Diagnostic turn delivery at 1–16 times real time; 1 restores normal delivery. Measure client frame progress to establish actual game speed. |
| `wisp lan end --pair K` | Ends pair K's game. The clients go back to their menus. |
| `wisp engine actions --client lan0a,lan0b [--map MAP] [--follow]` | Prints the pair's action log, and follows it with `--follow`. With `--map`, it starts the match first ([engine.md](engine.md#actions)). |
| `wisp engine diff ACTIONS.log POLL.log` | Places every birth from `wisp engine poll` in the turn it happened in, with the actions just delivered. |

Pool clients are named `lan<K>a` and `lan<K>b`. The pool writes three files
under `$XDG_STATE_HOME/wisp/lan/` (default `~/.local/state/wisp/lan/`):

- `pool.json`: its pairs, their agent sockets and desktops;
- `clients.json`: every pool client in the clients-file schema that `wisp engine`
  and the autopsy read (`WISP_CLIENTS=~/.local/state/wisp/lan/clients.json`);
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
Keep that folder private. These lobby checks can replace the second native
client for join/leave, profile/map-message handling and handicap slot updates.
They cannot replace `lan fresh`, native input checks or parity runs. The
pool still starts pairs; an executor may stop its unused side b to measure
the one-client footprint.

On 7 October 2026, the isolated protocol run completed 20 joins, handicap
changes and leaves with zero errors against Wisp's host. Median join time was
12.4 ms and resident memory was 5.5–5.9 MiB. The current native compatibility
measurement is tracked in [#46](https://github.com/tompassarelli/wisp/issues/46).

## Guardrails

- **Offline only.** Before it writes into a client's code, Wisp checks that the
  client's `/proc/PID/net/dev` lists nothing but `lo`. Pool clients run inside
  `bwrap --unshare-net`, so Battle.net is out of reach, and no client has a
  saved account to sign in with. A client with any other network is refused.
- **Declared clients only.** `wisp lan` works on the clients it created. `wisp
  engine actions` accepts only a pair from the pool's clients file.
- **Checked code only.** The switch refuses builds it hasn't been checked on
  (`KNOWN_BUILDS` in wisp:scripts/wisp/lan/provider.ts: 3.0.0.24268). It also
  refuses when the selector pattern doesn't match exactly one place, or when
  the bytes there aren't `LOOP`. It logs each write's bytes before and after,
  and puts `LOOP` back within a fraction of a second.

## Setting up

Running `setup` again refreshes an existing client's install when its Warcraft
executable version differs from `--from`, then reinstalls that client's menu
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

`pool --locate-before-peer` starts client a, runs the read-only `engine locate`
on it, and starts client b only after that succeeds. It uses the first client's
private Documents folder and waits up to 60 seconds for its actual Warcraft
process, stopping if its native launcher exits. The default startup is unchanged. Locate
output is in `pair-K/desktop-a.out`. If no initialized presence table is found
at startup, the pair stops with the locate error; the flag never loads a map
to make a table appear. New-build offsets are printed, not automatically saved.

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
moderate`. Admission uses the user's service bus and runtime directory;
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
- `visual` is 1280×720, with Reforged models and more lighting and texture
  detail.
- `hfr` is parity at 144 frames a second, for comparing the game's clocks
  against the 60 fps cap.

Warcraft **3.0.1.24342**'s installed `webui/GlueManager.js` maps
`PREF_GENERAL_HD` to SD=0, HD=1 and DE=2; the saved preferences store that
choice as `[Misc] hd`. The profiles choose Classic (`hd=0`) for parity,
checks and hfr, and Reforged (`hd=1`) for visual. `graphicsMode: "definitive"`
selects Definitive Edition (`hd=2`). Audio checks therefore use Classic
sounds; Definitive Edition also uses Classic sounds. Profiles set Ambient Occlusion off (`assao=0`) and omit
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

Patch 3.0.0 left the LAN provider in the game, but the menus only ever ask
for the loopback one. The handler behind the menus' `InitializeLocalNetProvider`
has one `mov ecx,'LOOP'`:

```
48 83 EC 58 E8 ?? ?? ?? ?? B9 50 4F 4F 4C E8 ...   (sub rsp,0x58; call; mov ecx,'LOOP'; call ...)
```

The provider factory it calls still makes `TCPN`. Wisp makes the switch the
way W3Champions' launcher (its `native_tcpn` helper) and wc3-slop-lan's
activator do (provider.ts, join.ts):

1. Read the decrypted code. `.text` is encrypted on disk, and the game
   decrypts a page when it runs it. A page the game hasn't run lately can be
   encrypted again. Wisp scans the image's readable code mappings through
   /proc/PID/mem for the selector and the factory. When either is missing,
   one `InitializeLocalNetProvider` runs (and so decrypts) both.
2. Stop the game (SIGSTOP; every thread stopped, none of them on the
   instruction), write `TCPN` over the operand, read it back, and continue.
3. Ask the menus for `InitializeLocalNetProvider`. The game builds a TCPN
   provider and opens its LAN socket on UDP 16000 and up.
4. Stop the game again, write `LOOP` back, read it back, and continue. The
   patch lasted 59 ms on 7 October.

Under Wine the image's code is a shared mapping of a memfd
(`/memfd:wine-mapping`). The kernel refuses a forced /proc/PID/mem write to a
shared mapping (EIO), so the write goes to the memfd itself. It uses the
game's own descriptor for it (`/proc/PID/fd/N`, matched by inode), at the
mapping's file offset.

Left in place, the patch makes `war3_loader.dll` close the game within a
minute (wc3-slop-lan). Restored, the client keeps its TCPN provider until the
next rebuild: leaving a LAN game rebuilds it, so the agent switches again
before every join.

Memory access needs no `ptrace_scope` change. Steam's runtime starts each
game in a user namespace this user owns, and Yama allows a tracer that holds
`CAP_SYS_PTRACE` in the target's namespace.

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
100.834 mark turn 32 game 0.965
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
  logs align between actions.
- **Event lines** cover joins, map checks, phases, loads, leaves (with their
  reason), chat, and every desync, with each client's checksum.

`wisp engine diff ACTIONS.log POLL.log` reads both headers' start times. It
prints each birth from a `wisp engine poll` log with the turn it fell in, and
the last turn of actions within the second before it:

```
256.614 birth 4281 CAgentBaseAbs owner CPlayerChatMatchEventData in turn 4470; 2 turns after turn 4468: lan0b chat trigger=10a3:10a3 text="-dev quick"; ...
```

Tests replay a recorded exchange of two offline clients through the host
(wisp:test/fixtures/lan/offline-pair.packets, wisp:test/lan.test.ts).
