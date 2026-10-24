# Wisp's online relay (plan)

Status: planned, 24 October 2026. Epic: wisp#28. Nothing here is built
yet; each section names the box that builds or measures it.

Smashcraft's online matches run on Battle.net's turns today. On 24 October
2026 Tom chose to build our own relay instead of depending on Battle.net's or
W3Champions' turn settings. This page plans that relay: a server that clocks
turns and an agent on each player's machine that hosts the game for the local
Warcraft III and feeds it turns on an even schedule.

## What decides the design

Measured facts, each with its source:

- **Steady turns matter most.** On the offline LAN pool (3.0.0.24268, gex45,
  24 October), a client runs one 60 Hz callback per rendered frame whatever
  the turn length. With turns paced against deadlines and light input, 25 ms
  and 17/17/16 ms turns lost at most 2 of about 190 taps per client, with a
  one-frame press-to-sample spread, as a solo game does. Heavy input at
  17/17/16 spread over 2 frames. The sweep found no sampling gain from
  17/17/16 over a paced 25 ms and kept Wisp's pool default at 25 ms, the grid
  Battle.net players get. With the earlier pacer, whose steps jittered,
  7–11% of taps were lost and spreads reached 2–5 frames
  (smashcraft:docs/warcraft-api-netcode-findings.md, "Input sampling against
  the LAN host's turn interval").
- **Turn length still sets a latency floor.** The host forwards an action at
  the next turn, so a turn of T ms adds 0 to T ms (T/2 on average) before any
  other player receives it: 12.5 ms at 25 ms, 8.3 ms at 17/17/16, 4 ms at
  8 ms. Tom asked on 24 October for the shortest turn Warcraft handles
  cleanly, with even pacing too. In one gex45 pool session (box R2), 8 ms
  turns ran 125 a second at game pace 1.000 with no desync, no host wait,
  every tap seen and no more CPU than 17/17/16, and a light-input press
  reached the host in 5 ms at the median against 13–15 ms at 17/17/16
  (smashcraft:docs/warcraft-api-netcode-findings.md, "Shorter turns"). The
  relay is not the pool, so it takes the lower floor.
- **Smashcraft's delay and rollback budget.** Smashcraft sets one input delay
  for every player from its own sync-message echoes
  (smashcraft:ts/src/host/loop/netDelay.ts), and those echoes will pass
  through the relay and the agents' buffers. The delay and the rollback
  budget (6 frames in a duel, 8 with three or more humans,
  smashcraft:ts/src/game/netcode/delayPolicy.ts) change only outside a match.
  So the agent's buffer depth must settle before a match starts, and depth
  added mid-match turns into rollback past the budget.
- **The internet path is where turns get uneven.** W3Champions' FLO forwards
  turns over one TCP stream (crates/net/src/stream.rs) and its client passes
  them to Warcraft as they arrive. A lost TCP segment holds every later turn
  until the retransmission, then releases them together: the burst the pool
  showed costs taps. W3Champions announced (October 2026) no packet-loss lag
  spikes at 5% loss and 200 ms ping; their current code is not public, so how
  is unknown.
- **Battle.net's own timing.** Turns on a 25 ms grid, own-echo p50 about
  115 ms, p95 about 212 ms (wisp:docs/network-model.md).
- **Warcraft joins only games it can see.** Patch 3.0.0 removed LAN from the
  menus. On 3.0.0.24268 a LAN provider remains, and Wisp reaches it on its own
  offline test clients only through the private switch
  (wisp:docs/driving-warcraft.md, section 2). On the live build,
  3.0.1.24371, no outside route reaches LAN: the menus only build the
  loopback provider, and 3.0.1.24342 had no LAN provider left
  (wisp#21, 24 October). W3Champions' 3.0 path switches the provider inside
  the running game, which our clean-room rules forbid on any client a player
  owns (wisp:docs/clean-room.md).

That last fact splits the plan in two:

1. **Build and measure on the pool.** Relay, agent, transport and jitter
   buffer can all be built now and measured natively on 3.0.0.24268 pool
   pairs, which are our own offline test clients.
2. **Reach players.** This needs a route by which an unmodified, signed-in
   live client joins a game the agent hosts. Box R0 found none from outside
   the game on 3.0.1.24371 (Reaching players, below), so shipping waits on
   Tom's decision (Decisions, below).

## Shape

```text
 Warcraft III ──TCP 127.0.0.1──> agent ──UDP──> relay <──UDP── agent <──TCP── Warcraft III
 (player A)    W3GS, lossless   (A's machine)   (server)     (B's machine)    (player B)
```

- **Relay** (server). It owns the room and the turn clock. Every turn it
  takes the actions that arrived since the last turn, numbers the turn and
  sends it to every agent. It compares the checksums agents forward and
  reports the first desync. It speaks only the relay protocol, never W3GS.
- **Agent** (each player's machine, inside smashcraft-client). It is the
  host its own Warcraft III sees: it runs the lobby (slots, the other
  players, the map check, countdown and loading) and then writes turns to the
  game. It sends the game's actions, checksums, chat and leave to the relay.
  Between relay and game sits the jitter buffer, which writes each turn to
  the game at a feed time anchored to the relay's clock (Jitter buffer,
  below).
- **Wisp's LAN host** (wisp:host/lan/host.ts) stays the pool's host and is
  the reference the agent's lobby is ported from.

## Turn cadence (boxes R1, R2)

- The relay paces turns against absolute deadlines: turn k is due at
  start plus the sum of the first k steps (k × 8 ms at the default; a
  17/17/16 cycle makes three turns exactly 50 ms), and its game step is its
  own step. A late tick never shortens the next step and never
  takes its step from the wall clock. That was the old pool pacer's fault,
  which ran 43.7 turns a second at a 25 ms setting. Effect's `Schedule.fixed`
  at a fractional period fires about 107 times a second, so the relay uses
  no periodic timer, only deadlines.
- Default: 8 ms, the shortest clean turn R2 measured. The rule: a turn
  shorter than 17/17/16 becomes the default only if, against 17/17/16
  measured in the same session, it keeps zero desyncs and game pace
  1.000 ± 0.002, loses no more taps, and adds at most 0.2 cores across both
  clients. On gex45 (24 October, one pool session, light and heavy input,
  80 s each) 8 ms met it: 0 desyncs, pace 1.000, 0 lost taps against 0 light
  and 5 heavy at 17/17/16, and 1.08 and 1.24 cores against 1.26 and 1.20.
  10 ms lost one more tap than 17/17/16 with light input. A turn shorter
  than a frame carries no callback some of the time, so its gain is the
  lower forwarding floor (4 ms mean). Buffer depth and lag limits are kept
  in milliseconds, so they hold whatever the turn length.
- After the relay stops its clock (lag, below), the next turn's deadline is
  rebased to the restart time, so no backlog of turns fires at once.
- R1 is the pool host's own change: deadline pacing and `--turn-ms 17,17,16`
  in host.ts. turnrate-sweep built it (wisp lane `lan-turn-25`).

## Transport (boxes R5, R6, R7)

Tom set the direction on 24 October: the fastest, lowest-overhead protocol
that meets the goals. Raw UDP with redundant turn history is the default.
Anything more is added only when a measurement shows a need.

**Downstream (relay to agent).** Each packet carries every turn the agent
hasn't acknowledged, oldest first, up to 1,200 bytes; the oldest is due
soonest. A lost packet is repaired by the next one, one turn period later,
with no timer and no retransmission. Wisp's own transport already works this
way (wisp:docs/network-model.md, "Packets").

**Upstream (agent to relay).** The agent sends a packet as soon as the game
hands it an action, and then one each turn period. Each packet carries every
action the relay hasn't acknowledged, plus the agent's acknowledgement of
turns and its newest checksums. The relay puts each action in the first turn
it emits after the action arrives, and acknowledges it in the next turn.

**Why it is enough.** With feed times anchored to the relay's clock (Jitter
buffer, below), a turn is fed late only if every packet carrying it before
its feed time is lost: at depth D, D + 1 packets. With independent loss p,
the late rate per turn is p^(D+1). At 125 turns a second (8 ms) the plan's
bar, one underrun per 10 minutes, is 1.3 × 10⁻⁵ per turn.

- At 5% loss, D = 2 gives 1.25 × 10⁻⁴ (an underrun about every minute) and
  D = 3 gives 6.3 × 10⁻⁶ (one every 21 minutes). So 5% loss needs D = 3,
  24 ms.
- At 1% loss, D = 2 gives 10⁻⁶.
- Real loss comes in bursts (Wi-Fi, cellular), which needs more depth. The
  bench (R6) runs Gilbert-Elliott burst models and loss traces recorded on a
  real path (R10), and the bar is judged there: a 5-minute native run sees
  the bar's rate too rarely to test it.

**Compared with QUIC (RFC 9000, 9002, 9221).**

- *Streams* deliver in order. Recovery (RFC 9002) declares a packet lost
  after three later packets are acknowledged or 9/8 of an RTT, so the
  retransmission lands at least one RTT after the original would have. At
  200 ms RTT that is about 28 turns, and a buffer deep enough to hide it
  costs 250 ms of latency. Streams are out.
- *Unreliable datagrams* (RFC 9221) would need the same redundancy as raw
  UDP. They add about 25–30 bytes a packet, a TLS handshake and encryption.
  Datagrams also wait on congestion control: under congestion quinn queues
  them, and a new datagram discards the oldest unsent ones to make room.
  Loss shrinks the window, so at 5% loss and 200 ms RTT the controller can
  throttle exactly the traffic redundancy needs. QUIC's other gains, path MTU
  discovery and connection migration, are covered by a fixed 1,200-byte
  ceiling and the session token below.
- So no QUIC arm is built. A datagram arm is added only if R6 or R7 shows
  raw UDP failing for a reason QUIC addresses, for example networks that pass
  QUIC but drop other UDP (`Target-debt` record below).

**Packets.** Every packet starts with the player's 64-bit session token, so
the relay keys a player by token, not by address. The relay sends an
unverified address at most three times the bytes it received from it, as
QUIC does (RFC 9000, section 8), until a stateless cookie round trip
verifies it, so it can't be used to amplify an attack.

- **NAT rebinding.** A NAT that changes the port mid-match gives a new,
  unverified address. While the cookie round trip completes, the relay keeps
  sending every turn there, trimming each packet's history to fit the
  three-times budget (the agent sends about 125 packets a second, so a turn or
  two of history fits). A rebind costs at most one RTT of thinner
  redundancy, not a stall. R10 measures it.
- **Limits.** Rooms close when a match ends or after 10 idle minutes, and
  room creation is rate-limited per address.
- **Not defended.** Nothing is encrypted, because a match's actions are
  public in its replay anyway. The token travels in the clear, so an attacker
  on the path can forge actions or take over a player's stream. The first
  version accepts that (Deferred, below).

## Jitter buffer (boxes R6, R9, C2)

The agent writes turn k to the game at its feed time

```text
feed(k) = anchor + relayTime(k) + depth
```

where relayTime(k) is the sum of the steps before turn k (k × 8 ms at the
default), depth is in milliseconds (D turns of the current turn length),
and anchor is the agent's estimate of when turn 0 would arrive on its fastest
path. The anchor comes from the arrivals themselves: it is a low percentile
(the 5th) of arrival(k) − relayTime(k) over the last 10 s, so jitter and loss
don't move it. Anchoring to time, not to the newest turn received, is what
makes the late rate p^(D+1) rather than about p.

- **Choosing depth before the match.** Smashcraft fixes its input delay and
  rollback budget for a whole match, so depth must settle before turns
  start. During the lobby and loading, the relay and agent exchange packets
  every turn period, and the agent measures loss, burst length and the
  spread of arrival(k) − relayTime(k). It picks the smallest D whose
  predicted late rate meets the bar: D = 2 on a clean link, 3 at around 5%
  loss. Smashcraft's echo then measures the delay players actually get.
- **Underrun.** When turn k hasn't arrived by feed(k), the agent waits.
  Warcraft runs no turn. The agent keeps the depth the wait added, up to one
  turn more than the chosen D.
- **Catch-up.** After an outage, such as a blackout of a second, the backlog
  is far deeper than D, and draining it at 1 ms a turn would take tens of
  seconds of deep rollback. When depth exceeds D + 2 turns, the agent feeds
  turns every 4 ms until it is back to D + 1 turns, a burst of fast game time
  like the one the relay's lag stop ends with. R9 measures it with an
  injected blackout.
- **Drift.** The 1 ms-a-turn slew (as Wisp's transport's `paceShift`) is
  only for clock drift between relay and agent (100 ppm is 60 ms, about
  eight turns, over 10 minutes) and for returning from D + 1 to D after
  30 s without an underrun. Game steps stay the relay's, so game time follows the relay,
  not the slew.
- **Ceiling.** If the chosen depth would exceed 100 ms (12 turns), the client
  reports the link as too poor before the match. Turns are never dropped.
- **Timers.** The agent needs millisecond deadlines. On Windows it uses a
  high-resolution waitable timer, because default sleeps are 15.6 ms
  granular. C2 checks the feed schedule on Windows and Linux. The loopback
  TCP to the game sets `TCP_NODELAY`.

**How it meets Smashcraft's frame-stamped inputs and rollback.** Smashcraft
stamps each input row with the frame it was sampled on and applies a remote
row at its stamp, rolling back when the row arrives late
(smashcraft:docs/design/client.md, smashcraft:ts/src/host/loop/frame.ts).

- **Opponent's view.** Player A's simulation runs about
  one-way-down(A) + D_A turns behind the relay clock. A row A stamps at frame
  f reaches the relay one-way-up(A) later and goes into the next turn. B runs
  that turn at frame k, where k − f ≈ (RTT(A) + D_A × 8 ms + the turn
  wait)/16.7 ms. So A's link and A's buffer set how far B must roll back for
  A's inputs. Smashcraft's own input delay subtracts from that depth. At
  100 ms RTT and D = 2 that is about 7 frames before delay; at 200 ms and
  D = 3 about 13.5. Smashcraft's echo-measured delay absorbs most of it,
  and the rest must fit the rollback budget (6 in a duel, 8 for groups). Box S1 reruns
  Smashcraft's rollback-budget sweep under the relay's paced delivery to
  set those budgets.
- **Upstream jitter** moves a row into a later turn. The stamp keeps it on
  the right frame, so the cost is a deeper rollback, not a wrong frame.
- **Downstream jitter** is what the buffer removes. Even turns give even
  callbacks, so local sampling stays at the pool's one-frame spread.
- **Local feel.** Whether D also delays a player's own key state is
  unmeasured. The sweep found that held-key reads follow the synchronized key
  events in 8 of 10 client-runs. If a press only reads as held once its key
  event returns through the host, then RTT + D adds directly to the player's
  own input delay, and D must stay as small as the late rate allows. R3
  measures this on the pool with netem at 0, 100 and 200 ms. If reads wait
  for the echo, the relay still evens turns and removes loss stalls, but its
  latency counts in full: R9 then judges each cell by press-to-sample delay
  as well as spread, and the relay's placement (one region near both
  players) matters more than its depth.
- **Taps.** Smashcraft#218 loses a tap when its press and release reach the
  host in one turn. Separate packets don't prevent that: two packets less
  than a turn apart land in the same turn, and a stalled client sends both
  edges at once. The agent decodes its game's actions (as wisp:host/lan/actions.ts
  does) and marks a key release whose press is still unacknowledged; the
  relay puts a marked release at least one turn after its press. R8 builds
  it and R9 counts taps.

## Lobby and game on the agent (box R8)

The agent ports host.ts's lobby and game loop to Rust. host.ts is Wisp's
own MIT code, but its first line says its join and game-loop layouts follow
FLO's (then MPL-2.0) and wc3-slop-lan's notes. So R8 starts with a licence
check under the external-code rules: it confirms the port carries protocol
facts (message order and fields), not FLO's expression, and records that in
wisp:docs/prior-art.md. W3Champions' FLO client (github.com/BogdanW3/W3C-Flo
at `6db3a401`, MIT declared at that revision; earlier files were MPL-2.0, so
no file's licence is assumed) is read for facts only, chiefly `crates/lan`
and `crates/client`: how a remote node is shown to Warcraft as a local game,
and the lobby of remote players. No FLO code is copied.

- **Lobby.** The relay tells each agent the room: slots, players, the map's
  facts (size, SHA-1 and the game-files checksum, wisp:host/lan/map.ts) and
  the random seed. The relay picks the seed once for the room, because a seed
  per agent would desync the match at its start. Each agent shows the remote
  players to its game as joined players (player info, skins, profiles, slot
  table). It reads its own copy of the map, as host.ts's map facts do, and
  the relay refuses a player whose facts differ before the countdown, naming
  both SHA-1s.
- **Start.** The relay starts the countdown for every agent at once. Each
  agent forwards its game's "loaded" to the relay. Agents show each remote
  player as loaded when the relay says so. Turns start when every player is
  loaded.
- **Play.** Each relay turn becomes one W3GS turn with the relay's step.
  Actions, checksums, chat and leave go to the relay. "Behind" is measured
  as host.ts measures it, by checksums: a player whose agent has forwarded
  checksums for fewer turns than the relay has emitted, by more than 1 s of
  game time (host.ts allows 50 turns), makes the relay stop the clock, and
  agents show Warcraft's lag screen. A player who stays away for 30 s is
  dropped as having left. The clock then restarts from a rebased deadline.
- **Conformance.** host.ts's `onPacket` hook records a pool session's bytes.
  The agent must produce the same lobby bytes for the same room. That
  transcript test keeps the two hosts from drifting.

## Where the relay runs, NAT, and who can join (boxes R10, C1)

- **Host.** One relay on a public address. Nexus, the always-on server, is
  recommended. gex45 runs the native pool, whose load would show up as relay
  jitter, so it keeps the test relays inside pool namespaces. Opening a public
  UDP port on either server widens access, so R10 asks Tom first. A second
  region waits until measured player RTTs call for one.
- **NAT.** Every agent sends first, to the relay's public address, so no hole
  punching, STUN or port forwarding is needed. CGNAT works. Traffic every
  turn period keeps NAT mappings open; in the lobby the agent sends at least
  once a second. A network that blocks UDP can't use the relay; those players
  keep Battle.net play.
- **Joining.** The host's client asks the relay for a room and shows a code;
  the joiner types it, as Smashcraft's Battle.net join codes work today
  (smashcraft:docs/design/client.md, "Direct play"). The code names the relay
  and the room.
- **Keyboard-only players.** The agent lives in smashcraft-client, so a relay
  match needs the client on both machines; a controller does not. Players
  with no client keep Battle.net join codes, which need no install. Both
  players in a match use the same transport.

## Reaching players (box R0)

Box R0 tried every route that public sources name, all from outside the
game, on 25 October 2026. The client was clone-d on gex45 (account d,
3.0.1.24371, signed in, at the main menu). Wisp's LAN host ran on
127.0.0.1:6112 under a probe that logged every connection and packet, and
announced its game every second to UDP 16000–16007 and later to the game's
own UDP port as well. Requests went through Wisp's menu page
(wisp:host/play/menus.ts). The game's sockets were read with `ss`. No step
read or wrote game memory, injected code, attached a debugger or changed a
game file.

No route reached the host: its log has no connection and no packet from the
client. Throughout, the game's UDP sockets were one or two ephemeral ports
on 0.0.0.0 (49946 in the first launch). It never bound 6112, 16000–16007 or
the mDNS port 5353 on either provider, and the clone has no Bonjour service.
So nothing in it was listening for a LAN announcement. War3Log stayed empty in the first launch.
In the second (`-region xx`, below) it holds the command line, the map scan,
`LoginDoorClose` and "Activating WebUI", and no network line.

Menu-socket requests (names from wisp:docs/driving-warcraft.md and
kgallimore/wc3MultiTool at `278366fd`, read for facts only; that repository
has no licence). Results below are on Battle.net unless loopback is named:

- `GetGameList`: `GameList {games: []}`, 14 ms.
- `JoinGameByGameName {gameName: "r0-wisp", gamePass: "r0"}`:
  `GameSearchGameNotFound`, then the chat line "Failed to join game", 0.2 s.
  The name went to Battle.net's search, not to the local network.
- `JoinGame {gameId: 1}`: no answer in 10 s; the client stayed at the main
  menu. Battle.net's own list later held a stranger's game with id 1, so
  this request is not sent there again.
- `SendGameListing`: `GameListClear`, then Battle.net's public custom games
  only (`GameListUpdate` with Battle.net ids and pings of 27–384 ms).
- `InitializeLocalNetProvider`: `OnNetProviderChanged {providerId: "LOOP"}`
  in 17 ms. On loopback, `GetGameList` returned `[]`, `SendGameListing` only
  `GameListClear`, `JoinGame {gameId: 1}` nothing in 10 s, and
  `JoinGameByGameName` only `CancelTeamInvitations`. With the game also
  announced straight to the game's UDP port 49946, the list stayed empty and
  the port's receive queue stayed at 0.
- `InitializeNetProvider`: `OnNetProviderChanged {providerId: "BNET"}` in
  19 ms. A signed-in client simply returns to Battle.net, with no sign-in.
- `PlayOffline`: no answer in 22 s and no change on screen.

No public request names a LAN provider. wisp#21 found only `BNET` and
`LOOP` on 3.0.1.

Launch arguments. The public list is MindWorX's Hive Workshop guide and its
2020 reply (hiveworkshop.com thread 288224). Battle.net passes extra
arguments through its "Additional command line arguments" setting
(`Games.w3.AdditionalLaunchArguments` in Battle.net.config):

- `-region xx` (the one value in the public list that is not a real
  region): Battle.net started the game as `Warcraft III.exe -region xx
  -launch -uid w3`. It signed in and reached the main menu in 37 s, still on
  Battle.net: `GetGameList` `[]`, `JoinGameByGameName` `GameSearchGameNotFound`
  in 0.2 s, `SendGameListing` Battle.net's public games. Its UDP socket was
  again one ephemeral port, and the host saw nothing.
- `-loadfile MAP` (with or without `-gametype`): not rerun here. It starts a
  local game on the loopback provider, the one Wisp's solo games and
  `play --lobby-only` use, so it hosts and never joins.
- `-csdk-aurora-dnsname`: not tried. It names the Battle.net game service
  the client talks to, so a join through it would mean answering as
  Battle.net, which wisp:docs/clean-room.md forbids.
- `-routerconfig`, `-routerapp`, `-sso`, `-csdk-gameutil-filter`,
  `-enablenagle`: not tried. The public list gives no meaning or value for
  them, and guessing values is not a documented route.

Battle.net app options:

- Region (Americas, Europe, Asia): not switched. It picks the Battle.net
  gateway the client signs in to, which lists Battle.net-hosted games only,
  and those are outside R0.
- The app's "Game version" menu (seen on clone-d, set to Warcraft III,
  3.0.1.24371) offers "Warcraft III - Legacy TFT 1.29", per Blizzard's
  instructions quoted by PC Games (pcgames.de, "Classic-Version von Warcraft
  3 ist endlich zurück"). Patch 3.0.0's notes (Liquipedia, "Patch 3.0.0") say
  LAN and offline play remain only through that Classic client. It is build
  1.29, not 3.0.1, and has no Lua (Lua arrived in 1.31), so Smashcraft's map
  cannot run on it.
- W3Champions' 3.0 "Native LAN" switches the provider inside the running
  game (w3champions-issues #57 and #58). Its discovery, UDP 16000 or mDNS
  with `W3C_LAN_TRANSPORT=csdk`, runs on the LAN provider that switch puts in
  place. Our clean-room rules forbid that switch on a player's client.

So no route from outside the game reaches a 127.0.0.1 host on 3.0.1.24371,
and the relay's player boxes wait on Tom's choice (Decisions, below). R0 is
rerun when a new live build ships.

## Boxes

Each box is its own issue with its Done when; the epic tracks them.

wisp (epic wisp#28):

- **R0** Find a route from outside the game for an unmodified, signed-in
  3.0.1.24371 client to join a game hosted on 127.0.0.1, or list every
  route tried and its refusal (wisp#29).
- **R1** Pool host deadline pacing and `--turn-ms 17,17,16` land
  (wisp#30).
- **R2** 10 ms and 8 ms turns on gex45 set the shortest clean turn
  (wisp#31).
- **R3** Whether held-key reads wait for the turn echo, at 0/100/200 ms RTT
  (wisp#32).
- **R4** Baseline: Wisp's TCP host under jitter and loss, as a FLO-like path
  is (wisp#33).
- **R5** `wisp lan netem` gains jitter, burst loss and port scoping
  (wisp#34).
- **R6** Relay protocol core, jitter buffer and simulated-network bench in
  Rust (wisp#35).
- **R7** Relay server and agent link on real sockets under netem
  (wisp#36).
- **R8** Agent hosts the local game; two pool clients play through relay and
  agents (wisp#37).
- **R9** Native proof under internet conditions: even feed, taps, rollbacks,
  blackout catch-up (wisp#38).
- **R10** Public relay deployment with NAT and abuse limits, and a recorded
  real-path loss trace (wisp#39).
- **R11** Headless delivery model for the relay's paced turns, so map tests
  meet relay timing as they meet Battle.net's today (wisp#40).

smashcraft (Tom asked for it on 25 October):

- **S1** Rerun the rollback-budget correction-pop sweep under the relay's
  paced delivery, raise the duel budget to 7 or the group budget to 9–10 if
  they pass, and record why groups tolerate a larger budget than duels
  (smashcraft#219).

smashcraft-client (epic smashcraft-client#25):

- **C1** Host and join a relay match from the client by code
  (smashcraft-client#26).
- **C2** The agent's feed schedule holds on Windows and Linux runners
  (smashcraft-client#27).

Order: R0, R1, R5 and R6 start now. R2 and R3 follow R1; R4 follows R1 and
R5; R7 follows R5 and R6; R8 follows R1 and R6; R9 follows R3, R4, R7 and
R8; R10 follows R7 and Tom's approval of the port; R11 follows R6; S1 follows
R11; C1 follows R8, R10 and either an R0 route or Tom's decision; C2 follows
R6.

Code placement: the relay is map-agnostic, so it lives in Wisp as a Rust
workspace at `relay/` with crates `relay-proto` (wire format and pure relay
and agent cores), `relay` (server), `relay-agent` (sockets, W3GS host,
pacer) and `relay-bench`. smashcraft-client depends on `relay-agent` at a
pinned revision. Rust is used because the agent ships inside the Rust client
on players' Windows and Linux machines, with no Bun runtime. R11's headless
model is TypeScript in wisp:src/headless/syncChannel.ts beside
`syncDelivery()`, because the headless runtime is TypeScript.

## Decisions

- **Players on the live build (Tom).** Without an R0 route, the relay
  reaches only our 3.0.0.24268 pool. Gate 41, opened 24 October, offers three
  options: keep clean-room and ship to players only when a clean route
  exists, meanwhile carrying Wisp's standalone window online through the
  relay; allow W3Champions' in-game switch in the shipped client; or stop
  the relay.
- **Public port (Tom).** R10 asks before opening the relay's UDP port on
  Nexus or gex45.
- **Settled here.** Raw UDP with redundancy, no QUIC, per Tom's direction.
  Deadline pacing at 8 ms turns (R2). A jitter buffer in the
  agent with time-anchored feed times and depth chosen before the match.
  Rust in `wisp:relay/`. Players keyed by session token.

## Deferred

- Target-debt: QUIC datagram arm; measured: none (not built); owner: R6/R7
  worker; revisit: R6 or R7 shows raw UDP failing for a reason QUIC
  addresses.
- Target-debt: authenticated packets (a key exchange and a MAC per packet)
  against an attacker on the path; measured: none; owner: wisp lead;
  revisit: C1 ships to players, or any report of a hijacked match.
- Target-debt: replacing host.ts with relay and agents on loopback, so the
  pool runs the same host as players; measured: none; owner: wisp lead;
  revisit: R8 lands and the conformance transcript passes on the pool.
- Target-debt: reconnecting a dropped player; measured: none; owner: wisp
  lead; revisit: players report drops after C1 ships.

Provenance: at most one underrun per 10 minutes (2.8 × 10⁻⁵ per turn) at
RTT up to 200 ms and loss up to 5%, with D ≤ 3, judged in R6's bench on
independent, burst and recorded loss; origin prior-art (W3Champions'
October 2026 announcement of no loss spikes at 5% loss and 200 ms ping);
pointer this page, "Transport"; rationale not recorded; revisit when R6
reports its burst-loss cells.

## Sources

- smashcraft:docs/warcraft-api-netcode-findings.md, input sampling against
  the LAN host's turn interval (24 October 2026).
- smashcraft:docs/high-refresh.md, smashcraft:docs/design/client.md, and
  smashcraft `e1ba7b0825` (rollback budget picked from correction pop).
- wisp:docs/lan.md, wisp:docs/network-model.md, wisp:docs/play.md,
  wisp:docs/driving-warcraft.md, wisp:docs/prior-art.md, wisp#21.
- FLO: github.com/BogdanW3/W3C-Flo at
  `6db3a4010fab0b0b29824a61f2c9c956f97fd211` (`crates/net/src/stream.rs`,
  `crates/node/src/game/host/clock.rs`, `crates/lan`, `crates/client`),
  read for facts only.
- W3Champions issues
  [#57](https://github.com/w3champions/w3champions-issues/issues/57) and
  [#58](https://github.com/w3champions/w3champions-issues/issues/58): their
  3.0 "Native LAN" launch and discovery.
- Box R0's route list: kgallimore/wc3MultiTool at `278366fd` (menu-socket
  names, no licence, facts only); MindWorX's command-line guide on Hive
  Workshop (thread 288224, archived 5 November 2025); Liquipedia's "Patch
  3.0.0"; PC Games' report of Blizzard's Legacy TFT 1.29 instructions.
- RFC 9000 (QUIC), RFC 9002 (loss detection), RFC 9221 (unreliable
  datagrams); quinn's datagram send queue and congestion control.
