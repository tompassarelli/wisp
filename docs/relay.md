# Wisp's online relay (plan)

Status: planned, 24 October 2026. Epic: wisp#EPIC. Nothing here is built
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
  the turn length. With turns paced against deadlines, 25 ms and 17/17/16 ms
  turns both saw every tap with a one-frame press-to-sample spread, as a solo
  game does. With the earlier pacer, whose steps jittered, 7–11% of taps were
  lost and spreads reached 2–5 frames
  (smashcraft:docs/warcraft-api-netcode-findings.md, "Input sampling against
  the LAN host's turn interval").
- **Turn length still sets a latency floor.** The host forwards an action at
  the next turn, so a turn of T ms adds 0 to T ms (T/2 on average) before any
  other player receives it: 12.5 ms at 25 ms, 8.3 ms at 17/17/16. Tom asked on
  24 October for the shortest turn Warcraft handles cleanly, with even pacing
  too. 17/17/16 is one turn per 60 Hz frame and ran with no desync and
  normal CPU; 10 and 8 ms are not yet measured (box R2).
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
   live client joins a game the agent hosts. Box R0 looks for one from
   outside the game. Shipping waits on R0 or on Tom's decision (Decisions,
   below).

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
  Between relay and game sits the jitter buffer, which writes one turn to the
  game every turn period, a fixed depth behind the newest turn received.
- **Wisp's LAN host** (wisp:host/lan/host.ts) stays the pool's host and is
  the reference the agent's lobby is ported from.

## Turn cadence (boxes R1, R2)

- The relay paces turns against absolute deadlines: turn k is due at
  start + k × 50/3 ms, and its game step is 17, 17 or 16 ms so three turns
  are exactly 50 ms. A late tick never shortens the next step and never
  takes its step from the wall clock. That was the old pool pacer's fault,
  which ran 43.7 turns a second at a 25 ms setting. Effect's `Schedule.fixed`
  at a fractional period fires about 107 times a second, so the relay uses
  no periodic timer, only deadlines.
- Default: 17/17/16. R2 measures 10 ms and 8 ms turns. A shorter turn
  becomes the default only if it keeps zero desyncs, game pace 1.000, every
  tap seen and client CPU within 10% of 17/17/16's. A turn shorter than a
  frame carries no callback some of the time, so its only gain is the lower
  forwarding floor (5 ms or 4 ms mean).
- R1 is the pool host's own change: deadline pacing and `--turn-ms 17,17,16`
  in host.ts. turnrate-sweep built it (wisp lane `lan-turn-25`).

## Transport (boxes R5, R6, R7)

Tom set the direction on 24 October: the fastest, lowest-overhead protocol
that meets the goals. Raw UDP with redundant turn history is the default.
Anything more is added only when a measurement shows a need.

**Downstream (relay to agent).** Each packet carries the newest turn and
every earlier turn the agent hasn't acknowledged, up to 1,200 bytes. A lost
packet is repaired by the next one, one turn period later, with no timer and
no retransmission. Wisp's own transport already works this way
(wisp:docs/network-model.md, "Packets").

**Upstream (agent to relay).** The agent sends a packet as soon as the game
hands it an action, and then one each turn period. Each packet carries every
action the relay hasn't acknowledged, plus the agent's acknowledgement of
turns and its newest checksums. The relay puts each action in the first turn
it emits after the action arrives, and acknowledges it in the next turn.

**Why it is enough.** A turn reaches the agent late only if every packet that
carries it before its feed time is lost. At depth D that is D + 1 packets.
With independent loss p, the late rate is p^(D+1): at 5% loss, 1.3 × 10⁻⁴
for D = 2 and 6 × 10⁻⁶ for D = 3; at 1% loss, 10⁻⁶ for D = 2. Bursty loss
and delay jitter need more depth, and the bench (R6) measures how much.

**Compared with QUIC (RFC 9000, 9002, 9221).**

- *Streams* deliver in order. Recovery (RFC 9002) declares a packet lost
  after three later packets are acknowledged or 9/8 of an RTT, so the
  retransmission lands at least one RTT after the original would have. At
  200 ms RTT that is about 15 turns, and a buffer deep enough to hide it
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
the relay keys a player by token, not by address. A NAT that rebinds the port
mid-match costs nothing. The relay answers an unverified address with no
more bytes than it received (a stateless cookie on the first exchange), so it
can't be used to amplify an attack. Rooms close when a match ends or after
10 idle minutes, and room creation is rate-limited per address. Nothing is
encrypted: a match's actions are public in its replay anyway. An attacker on
the path can still forge actions, and the first version accepts that.

## Jitter buffer (boxes R6, R9, C2)

The agent holds turns and writes one to the game per turn period on its own
deadline clock, D turns behind the newest turn it has. D starts at 2
(33 ms).

- **Underrun.** When the next turn hasn't arrived at its feed time, the agent
  waits. Warcraft simply runs no turn, and the wait adds a turn of depth,
  which the agent keeps.
- **Shrink and drift.** The agent watches the slack, how early turns arrive
  before their feed time. After 30 s with no underrun and the minimum slack
  above one turn, it shortens feed intervals by at most 1 ms a turn until one
  turn of depth is gone. The same slew of up to 1 ms a turn keeps the depth
  steady against clock drift between relay and agent (100 ppm is about four
  turns over 10 minutes). Wisp's transport already slews this way
  (`paceShift`). Game steps stay the relay's 17/17/16 ms, so game time
  follows the relay, not the agent's slew.
- **Ceiling.** D is at most 6 (100 ms). Beyond that the link is reported as
  too poor; turns are not dropped.
- **Timers.** The agent needs millisecond deadlines. On Windows it uses a
  high-resolution waitable timer, because default sleeps are 15.6 ms
  granular. C2 checks the feed schedule on Windows and Linux.

**How it meets Smashcraft's frame-stamped inputs and rollback.** Smashcraft
stamps each input row with the frame it was sampled on and applies a remote
row at its stamp, rolling back when the row arrives late
(smashcraft:docs/design/client.md, smashcraft:ts/src/host/loop/frame.ts).

- **Opponent's view.** Player A's simulation runs about
  one-way-down(A) + D_A turns behind the relay clock. A row A stamps at frame
  f reaches the relay one-way-up(A) later and goes into the next turn. B runs
  that turn at frame k, where k − f ≈ RTT(A)/16.7 + D_A + the turn wait. So
  A's link and A's buffer set how far B must roll back for A's inputs.
  Smashcraft's own input delay subtracts from that depth.
- **Upstream jitter** moves a row into a later turn. The stamp keeps it on
  the right frame, so the cost is a deeper rollback, not a wrong frame.
- **Downstream jitter** is what the buffer removes. Even turns give even
  callbacks, so local sampling stays at the pool's one-frame spread.
- **Local feel.** Whether D also delays a player's own key state is
  unmeasured. The sweep found that held-key reads follow the synchronized key
  events in 8 of 10 client-runs. If a press only reads as held once its key
  event returns through the host, then RTT + D adds directly to the player's
  own input delay, and D must stay as small as the late rate allows. R3
  measures this on the pool with netem.
- **Taps.** Smashcraft#218 loses a tap when a stalled client sends its
  press and release in one turn. Immediate upstream sends keep the two edges
  in separate packets. A client stall is the game's own, and R9 counts
  whether even feeding reduces it.

## Lobby and game on the agent (box R8)

The agent ports host.ts's lobby and game loop to Rust, from our own MIT code.
W3Champions' FLO client (github.com/BogdanW3/W3C-Flo at `6db3a401`, MIT
declared at that revision; earlier files were MPL-2.0, so no file's licence is
assumed: wisp:docs/prior-art.md) is read for facts only, chiefly
`crates/lan` and `crates/client`: how a remote node is shown to Warcraft as a
local game, and the lobby of remote players. No FLO code is copied.

- **Lobby.** The relay tells each agent the room: slots, players, map SHA-1
  and size. Each agent shows the remote players to its game as joined players
  (player info, skins, profiles, slot table) and runs the map check locally.
  A player whose map differs is refused before the countdown, with both
  hashes named.
- **Start.** The relay starts the countdown for every agent at once. Each
  agent forwards its game's "loaded" to the relay. Agents show each remote
  player as loaded when the relay says so. Turns start when every player is
  loaded.
- **Play.** Each relay turn becomes one W3GS turn with the relay's step.
  Actions, checksums, chat and leave go to the relay. When a player falls
  more than 3 s of turns behind, the relay stops the clock and agents show
  Warcraft's lag screen. A player who stays away for 30 s is dropped as
  having left.
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

## Boxes

wisp (epic wisp#EPIC):

- **R0** Find a route from outside the game for an unmodified, signed-in
  3.0.1.24371 client to join a game hosted on 127.0.0.1, or record that none
  exists (wisp#R0).
- **R1** Pool host deadline pacing and `--turn-ms 17,17,16` land
  (wisp#R1).
- **R2** 10 ms and 8 ms turns on gex45 set the shortest clean turn
  (wisp#R2).
- **R3** Whether held-key reads wait for the turn echo, at 0/60/120 ms RTT
  (wisp#R3).
- **R4** Baseline: Wisp's TCP host under jitter and loss, as a FLO-like path
  is (wisp#R4).
- **R5** `wisp lan netem` gains jitter, burst loss and port scoping
  (wisp#R5).
- **R6** Relay protocol core, jitter buffer and simulated-network bench in
  Rust (wisp#R6).
- **R7** Relay server and agent link on real sockets under netem
  (wisp#R7).
- **R8** Agent hosts the local game; two pool clients play through relay and
  agents (wisp#R8).
- **R9** Native proof under internet conditions: even feed, taps, rollbacks
  (wisp#R9).
- **R10** Public relay deployment with NAT and abuse limits (wisp#R10).

smashcraft-client (epic smashcraft-client#CEPIC):

- **C1** Host and join a relay match from the client by code
  (smashcraft-client#C1).
- **C2** The agent's feed schedule holds on Windows and Linux runners
  (smashcraft-client#C2).

Order: R0, R1, R5 and R6 start now. R2 and R3 follow R1; R4 follows R1 and
R5; R7 follows R5 and R6; R8 follows R1 and R6; R9 follows R4, R7 and R8;
R10 follows R7 and Tom's approval of the port; C1 follows R8, R10 and either
an R0 route or Tom's decision; C2 follows R6.

Code placement: the relay is map-agnostic, so it lives in Wisp as a Rust
workspace at `relay/` with crates `relay-proto` (wire format and pure relay
and agent cores), `relay` (server), `relay-agent` (sockets, W3GS host,
pacer) and `relay-bench`. smashcraft-client depends on `relay-agent` at a
pinned revision. Rust is used because the agent ships inside the Rust client
on players' Windows and Linux machines, with no Bun runtime.

## Decisions

- **Players on the live build (Tom).** Without an R0 route, the relay
  reaches only our 3.0.0.24268 pool. Gate opened 24 October with three
  options: keep clean-room and ship to players only when a clean route exists,
  meanwhile carrying Wisp's standalone window online through the relay;
  allow W3Champions' in-game switch in the shipped client; or stop the relay.
- **Public port (Tom).** R10 asks before opening the relay's UDP port on
  Nexus or gex45.
- **Settled here.** Raw UDP with redundancy, no QUIC, per Tom's direction.
  Deadline pacing; 17/17/16 until R2 says otherwise. Jitter buffer in the
  agent, not in the map. Rust in `wisp:relay/`. Relay keyed by session token.

## Deferred

- Target-debt: QUIC datagram arm; measured: none (not built); owner: R6/R7
  worker; revisit: R6 or R7 shows raw UDP failing for a reason QUIC addresses.
- Target-debt: replacing host.ts with relay and agents on loopback, so the
  pool runs the same host as players; measured: none; owner: wisp lead;
  revisit: R8 lands and the conformance transcript passes on the pool.
- Target-debt: reconnecting a dropped player; measured: none; owner: wisp
  lead; revisit: players report drops after C1 ships.

Provenance: late-turn bar of one underrun per 10 minutes at RTT up to 200 ms
and loss up to 5% with D ≤ 3; origin prior-art (W3Champions' October 2026
announcement); pointer this page, "What decides the design"; rationale not
recorded; revisit when R6's bench reports burst-loss cells.

## Sources

- smashcraft:docs/warcraft-api-netcode-findings.md, input sampling against
  the LAN host's turn interval (24 October 2026).
- smashcraft:docs/high-refresh.md, smashcraft:docs/design/client.md.
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
- RFC 9000 (QUIC), RFC 9002 (loss detection), RFC 9221 (unreliable
  datagrams); quinn's datagram send queue and congestion control.
