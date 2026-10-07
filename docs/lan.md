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

## Commands

| Command | What it does |
| --- | --- |
| `wisp lan setup --from INSTALL [--pairs N]` | Creates the pool's clients from an existing Warcraft III install folder (the one holding `_retail_`). See "Setting up". |
| `wisp lan pool [--pairs N \| --pair K...] [--profile parity\|visual\|hfr[,...]] [--seconds S]` | Runs up to N pairs, each admitted by the machine-capacity helper. It stays in the foreground; Ctrl-C stops the pool. |
| `wisp lan fresh MAP [--pair K] [--computers N] [--turn-ms MS]` | Hosts MAP on pair K, switches both clients to LAN, joins them, and returns once the match plays. It prints the game's action log. |
| `wisp lan status [--pair K]` | Each pair's clients and processes, and its game: phase, turns, desyncs, players. |
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

Each pair is admitted by its own `machine-capacity session --class moderate`.
The pool adds pairs while the helper admits them: a deferred pair is retried
every 45 s, for up to `--wait` seconds (default 1800). After that the pool
keeps the pairs it has.

- `--pair K` (repeated) picks which pairs start, in that order of admission.
- `--profile` takes one profile, or one per pair separated by commas; the last
  one repeats.

`pair-K/clients.json` gives each client its own `run` (desktop) and `pid`.

**Why a desktop per client.** labwc opens every game window at the same
place, and Xwayland throttles a window another window covers. On 7 October,
both clients of a pair shared one desktop. The covered client loaded 70 s
after the other, then ran 51 turns behind, so the host kept pausing the game.
With the windows apart, both kept within a few turns at 1:1 game time. Two
controller helpers typing on one display would also take each other's focus.

**Profiles.** `parity` (the default) is for checksum and input runs that need
no pixels: an 800×600 window with every quality setting at its lowest. `visual`
is 1280×720, with more lighting and texture detail. Both cap the game at 60
frames a second, focused or not. `hfr` is parity at 144 frames a second, for
comparing the game's clocks against the 60 fps cap. A client consumes at most one turn per
frame, so a cap below the turn rate (33 turns a second at 30 ms) makes it fall
behind.

**Cost at parity** (7 October, two clients in a match on Smashcraft
bisect-588610b7, measured over 10 s from /proc):

| | lan0a | lan0b |
| --- | --- | --- |
| CPU | 0.74 core | 0.52 core |
| Resident memory | 1.37 GB | 0.80 GB |
| GPU memory (VRAM + GTT, from DRM fdinfo) | 666 + 75 MiB | 666 + 75 MiB |

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
   searches;
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
