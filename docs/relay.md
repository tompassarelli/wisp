# Wisp's online relay (plan)

Status: planned, 24 October 2026. Epic: wisp#28. R6's protocol core and
bench are built (Protocol core and bench, below), with wisp#45's burst
cover, and R7's server and agent link run on UDP (Transport, "Built"); R7's
netem cells and everything else are not. Each section names the box that
builds or measures it.

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
  is unknown. Box R4 measures Wisp's own TCP host on such a path
  (Baseline, below).
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

## Baseline: Wisp's TCP host on a lossy path (box R4)

Status: method set, numbers pending. The table below is a gex45 trial run
at 75–85% host CPU pressure on 24 October, so it does not count as the
baseline; the cells are to be rerun on the laptop's LAN pool (wisp#33).

What the relay must beat: Wisp's own TCP host reached over an internet-like
path, as FLO's single TCP stream reaches a player. Measured 24 October 2026
on gex45 pool pair 2 (Warcraft III 3.0.0.24268, offline LAN, 60 fps cap),
one pool session, its first match thrown away.

- **Host.** Wisp's deadline-paced LAN host (wisp#30) at
  `--turn-ms 17,17,16`, from wisp 1eb2706 plus the port scope of cda8718.
- **Path.** `wisp lan netem --pair 2 ... --tcp-port PORT` on the port
  `lan fresh` hosts on, applied as soon as the host writes it and before the
  first client joins, so lobby, load and play all cross the impaired path
  and nothing else on the loopback does (wisp:docs/lan.md, "Simulated
  latency and loss"). RTT and loss are round-trip figures; jitter 20 ms
  varies each send by ±10 ms and reorders packets; "bursts" is netem's
  Gilbert model with a mean burst of four sends at the same long-run loss.
- **Map and probe.** Smashcraft's integrity build of 59824cc9b (the R3 map),
  Rifleman quick match, and the turn-rate sweep's probe
  (smashcraft:docs/warcraft-api-netcode-findings.md, "Input sampling against
  the LAN host's turn interval"): `-dev callback-clock 4800` stamps every
  60 Hz callback with `os.clock` and the raw `BlzIsKeyPressed` state of `c`;
  a host-side driver taps `c` on both clients every 280–520 ms for 50–90 ms
  through private-desktop XTEST (seed 7); heavy input adds a random tap of
  `[ ] ; ' t v 1 2` every 30–80 ms. 80 s of callbacks per run.
- **Host load.** A run started only with at most 6 live Warcraft clients on
  gex45 and machine-capacity's `protectedCpuSomeAvg10` under 20. Each row
  gives the most clients live during the run, the mean and peak of
  `protectedCpuSomeAvg10` and the mean of the agent's system
  `/proc/pressure/cpu` some avg10, sampled every second. Runs taken earlier
  that day with more than 6 live clients, or with netem switched on
  mid-match, are discarded, as is the closing heavy control (8 clients).

Columns: callback gap p50/p99/max over both clients (ms); taps seen, the
probe presses the raw key state reported down, per client; press-to-sample
spread, max minus min over the matched presses in ms, and in frames from
p5 to p95; rollbacks per minute and the deepest rollback in frames, from
Smashcraft's counters; longest stall, the longest run of consecutive
callback gaps over two frames (33 ms) summed; host waits, how often the host
held turns for a client more than 50 turns behind, with the longest hold in
ms; desyncs from the host's checksum compare; pace, game seconds per wall
second over the host's last 140 marks; callbacks/s, the slower client's
callbacks per wall second; load average at the run's start and end.

| Path | Input | Run | Callback gap p50/p99/max ms | Taps seen (a, b) | Press-to-sample spread ms (frames p5–p95) | Rollbacks/min (a, b) | Deepest rollback | Longest stall ms | Host waits (longest ms) | Desyncs | Pace | Callbacks/s | Load avg before–after | Live clients (max) | protectedCpuSomeAvg10 mean (max) | System CPU some avg10 mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none, first | light | `r0-light` | 16.1/32.0/106 | 176/187, 177/192 | 82, 63 (3, 2) | 243, 248 | 19 | 178 | 0 (0) | 0 | 1.000 | 60.0 | 24.39–12.15 | 5 | 1.4 (max 2.2) | 69.0 |
| none, first | heavy | `r0-heavy` | 15.9/30.0/58 | 185/187, 188/189 | 45, 47 (2, 2) | 584, 584 | 14 | 58 | 0 (0) | 0 | 1.000 | 60.0 | 10.00–8.14 | 5 | 1.5 (max 2.3) | 75.3 |
| none, last | light | `r0-light-end` | 15.1/32.2/168 | 187/187, 187/192 | 53, 58 (1, 2) | 249, 246 | 20 | 237 | 3 (25) | 0 | 1.000 | 59.9 | 15.55–22.07 | 6 | 7.2 (max 9.8) | 67.8 |
| 120 ms, 2% | light | `r120-l2-light` | 14.2/35.9/166 | 184/187, 181/192 | 73, 58 (1, 2) | 245, 232 | 24 | 192 | 0 (0) | 0 | 1.000 | 60.0 | 8.75–7.51 | 5 | 0.8 (max 1.6) | 71.4 |
| 120 ms, 2% | heavy | `r120-l2-heavy` | 13.9/43.0/285 | 172/187, 165/189 | 70, 74 (2, 2) | 539, 548 | 24 | 285 | 0 (0) | 0 | 1.000 | 60.0 | 7.57–7.05 | 5 | 0.1 (max 0.8) | 12.2 |
| 120 ms, 5% | light | `r120-l5-light` | 12.9/133.1/319 | 169/187, 169/192 | 82, 67 (2, 2) | 234, 220 | 24 | 319 | 0 (0) | 0 | 1.000 | 59.9 | 7.40–7.61 | 5 | 2.3 (max 4.2) | 84.4 |
| 120 ms, 5% | heavy | `r120-l5-heavy` | 12.9/138.9/330 | 161/187, 161/189 | 74, 74 (4, 3) | 473, 487 | 24 | 330 | 0 (0) | 0 | 1.000 | 60.0 | 7.45–6.96 | 5 | 0.7 (max 1.4) | 52.3 |
| 200 ms, 2% | light | `r200-l2-light` | 12.2/78.9/476 | 172/187, 167/192 | 66, 68 (2, 2) | 228, 220 | 24 | 476 | 0 (0) | 0 | 1.000 | 60.0 | 7.78–5.72 | 5 | 0.0 (max 0.1) | 0.1 |
| 200 ms, 2% | heavy | `r200-l2-heavy` | 13.9/54.0/489 | 165/187, 168/189 | 60, 77 (2, 3) | 485, 487 | 24 | 489 | 0 (0) | 0 | 1.000 | 60.0 | 6.18–9.36 | 5 | 0.3 (max 1.2) | 0.6 |
| 200 ms, 5% | light | `r200-l5-light-b` | 11.7/190.9/353 | 157/187, 157/192 | 88, 77 (4, 4) | 201, 206 | 24 | 361 | 1 (16) | 0 | 1.000 | 60.0 | 20.57–14.68 | 6 | 2.5 (max 4.6) | 3.6 |
| 200 ms, 5% | heavy | `r200-l5-heavy-b` | 12.2/189.9/526 | 131/187, 154/189 | 81, 90 (4, 5) | 399, 412 | 24 | 526 | 0 (0) | 0 | 1.000 | 60.0 | 11.02–12.57 | 6 | 2.3 (max 5.0) | 3.4 |
| 120 ms, 2%, jitter 20 ms | light | `r120-l2-j20-light` | 14.2/62.0/273 | 179/187, 176/192 | 73, 73 (2, 3) | 238, 243 | 24 | 273 | 0 (0) | 0 | 1.000 | 60.0 | 29.86–18.77 | 6 | 2.1 (max 5.5) | 11.5 |
| 120 ms, 2%, jitter 20 ms | heavy | `r120-l2-j20-heavy` | 14.9/53.0/270 | 163/187, 161/189 | 83, 81 (3, 4) | 524, 538 | 24 | 270 | 0 (0) | 0 | 1.000 | 60.0 | 19.03–16.61 | 6 | 4.8 (max 6.4) | 6.5 |
| 120 ms, 2%, bursts | light | `r120-l2-burst-light` | 14.2/34.9/245 | 179/187, 185/192 | 61, 64 (1, 2) | 249, 231 | 24 | 245 | 0 (0) | 0 | 1.000 | 60.0 | 17.05–12.17 | 6 | 2.0 (max 5.1) | 3.5 |
| 120 ms, 2%, bursts | heavy | `r120-l2-burst-heavy` | 15.1/48.1/395 | 169/187, 172/189 | 77, 86 (3, 3) | 533, 530 | 24 | 395 | 0 (0) | 0 | 1.000 | 60.0 | 15.50–15.11 | 6 | 6.0 (max 14.3) | 8.4 |

Output directories are `~/.local/state/smashcraft/wisp-33/runs/CELL` on
gex45, one per row (`r120-l2-light` is RTT 120, loss 2%, light input;
`-j20` jitter; `-burst` bursts; `r0-*` no impairment), each with the
callback clocks, the stimulus record, the action log, the netem setting,
the gate record and the per-second host samples.

What the gex45 trial showed, pending the laptop rerun:

- **Game time held.** In every cell the paced host kept pace 1.000 and both
  clients 60 callbacks a second, with at most one host wait (16 ms) and no
  desync. TCP retransmission never stalled a client the 50 turns (about
  850 ms) that make the host wait.
- **Cadence and taps paid.** Loss shows up in the callbacks: p99 gap 30–32 ms
  without impairment, 35–79 ms at 2% loss (with or without jitter or
  bursts) and 133–191 ms at 5%, with single gaps of 166–526 ms against
  58–168 ms. Raw taps seen fell from 176–188 per client to 161–185 at 2% and
  131–169 at 5%, and the press-to-sample spread widened from 1–3 frames to
  2–5 at 5%. Every impaired run reached a 24-frame rollback, against 14–20
  without impairment. RTT on its own costs little: 200 ms at 2% sits close to
  120 ms at 2%.
- **Jitter and bursts at 2%** cost about what plain 2% does here: p99 gap
  35–62 ms against 36–79 ms.
- **The 5% rows would set the relay's yardstick** (box R9): p99 callback gaps
  near 190 ms, half-second single gaps and up to 56 taps in 190 lost at
  200 ms, 5%, the cell where W3Champions claims no lag spikes.

Two findings from the runs that do not count:

- **Host load, not the path, made the big stalls.** The same cells taken
  earlier with up to 14 live clients on gex45 gave 18–441 host waits, pace
  0.645–0.976 and stalls of 0.8–6.6 s (`runs-discarded-clients`). Rerun with
  at most 6 clients, the same cells held pace 1.000.
- **Switching loss on mid-match crashed a client.** With netem turned on
  2–3 s before the probe started, client a wrote a crash report (exception
  0xC00000E5) in 2 of 4 lossy runs (`runs-whole-loopback`,
  `runs-tcp-midmatch`). None of the 26 lossy runs with the path impaired from
  the host's start crashed.

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
- The clock starts when every client has run the first turn. A
  3.0.0.24268 client starts running turns about 2 s after it reports
  loaded, so the relay sends turn 0 and holds there (not counted as a stop)
  until each player has returned turn 0's checksum, then rebases. The
  room's summary measures pace from that moment. Before this hold, the
  first native relayed match (laptop pair 0, 25 October) began with two lag
  stops, and its pace never recovered from that 2 s deficit (0.962 at 55 s).
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
its feed time is lost or late. At depth D the relay sends D + 1 such
packets, one a turn apart, but the newest reaches the agent by feed(k) only
when its delay is at or below the anchor, the 5th percentile: about 5% of
the time. So with independent loss p the late rate per turn is about p^D,
not p^(D+1), as R6 measured. At 125 turns a second (8 ms) the plan's bar,
one underrun per 10 minutes, is 1.3 × 10⁻⁵ per turn.

- Measured (R6, 8 ms turns, Protocol core and bench, below): D = 3 (24 ms)
  on a clean link and up to 1% loss, with one agent at D = 4 at 150 ms;
  D = 4 (32 ms) at 2%; D = 4–5 (32–40 ms) at 5%. Each met the bar.
- With 2 ms of mean jitter the second-newest copy, 8 ms ahead of its feed
  time, also misses about 2% of the time, so 8 ms turns need more turns of
  depth than 17/17/16 but fewer milliseconds: 17/17/16 needs D = 4–5
  (66.7–83.3 ms) at 5%.
- Real loss comes in bursts (Wi-Fi, cellular), which copies one turn apart
  don't cover: a burst takes out every copy at once. When the agent sees
  bursts, the relay adds up to 4 cover packets between turns, each carrying
  the newest D + 1 turns (wisp#45, Protocol core and bench, "Burst cover").
  Loss traces recorded on a real path (R10) are judged there too: a 5-minute
  native run sees the bar's rate too rarely to test it.

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

**Built (R7's code box, wisp#36).** Crate `relay` (library and binary
`relay`) is the server and crate `relay-agent` the agent's link, both over
`std::net::UdpSocket` on `relay-proto`'s cores, with no dependencies.

- **Control packets** (`relay-proto` `control`) share the wire header (magic,
  version, kind): Create (cookie, request id, players) and Join (cookie,
  request id, room) from an agent; Challenge (cookie), Room (request id, room,
  session token, players, slot, the cadence's steps) and Refused (rate
  limited, no room, full, bad player count) from the relay; Verify (token,
  cookie) and Leave (token) from an agent. A repeated Create or Join with the
  same request id from the same address gets the same answer.
- **Cookie.** SipHash under a key drawn at start of (10 s epoch, address),
  accepted for the current and previous epoch, so a cookie lives 10–20 s and
  the relay keeps no state for it. Create or Join without a valid cookie for
  its source address gets only a Challenge, 11 bytes against the request's
  20 or 27, and creates nothing.
- **Session tokens and slots.** The relay draws a room code and one 64-bit
  token per slot at Create and hands them out by Join; Room carries the
  token. The lobby (relay probes every turn period) starts when every slot
  has joined and turns start after the lobby time (20 s by default,
  `--lobby-ms`). The agent picks its depth at the first packet with a base.
- **Amplification and rebind.** The address that joined is verified by the
  cookie it echoed. An up packet with a known token from another address
  moves the player there unverified: its actions and acknowledgements count,
  and the relay sends it a Challenge (at most every 20 ms) and every turn,
  each packet trimmed oldest first to what keeps the bytes sent within three
  times the bytes received, and withheld if not even the 45-byte header
  fits. The agent answers a Challenge with Verify, and a valid cookie for
  the new address lifts the bound.
- **Limits.** At most 6 rooms per source IP (any port) a minute
  (`--rooms-per-minute`), counted only for cookie-verified Creates. A room
  closes when every player has sent Leave or after 10 idle minutes
  (`--idle-s`).
- **Tests.** `relay/tests/server.rs` drives the server without sockets: a
  cookie verifies only its own address and lapses after its second epoch; an
  address that rebinds mid-match gets at most three times its bytes for 30
  turns with turns trimmed, a forged Verify doesn't lift that and a valid one
  restores full history; the rate limit and room closing.
  `relay/tests/loopback.rs` runs two `relay-agent` links against the server
  over loopback UDP for 500 turns at 8 ms, rebinding the host's port at turn
  200: both feed the same turns in order, every host action lands once and
  in order, the relay counts one rebind and one verification, no clock stop
  and no desync. A second test runs the `relay` binary itself
  (`--bind 127.0.0.1:0 --once`) with two links for 250 turns.
  `relay-agent`'s own tests check the handshake's cookie echo, the Verify
  after a rebind and a refusal, against a bare socket.
- **Room clock.** A room's wire times count from its creation on the serve
  loop's clock, which the server logs as `room ID opened at T us`.

**Native netem driver (R7's native box, wisp#36).** `relay-native` (crate
`relay-bench`, `--relay PATH --port N --match-s S --out DIR`) starts the
`relay` binary on UDP 127.0.0.1:N and plays two `relay-agent` links through
it: the 20 s lobby, then S seconds of match at 8 ms turns, each agent sending
4 actions a second of 9–29 bytes (half marked releases) and a checksum per
fed turn, as the bench's agents do. It is meant to run inside a pair's
network namespace under `wisp lan netem --udp-port N`, whose `--loss` is the
round trip's: `--loss 3.96` and `9.75` drop 2% and 5% per send, the loss the
bench's cells drop each way. Delivery is the time from a turn's deadline on
the relay's clock to the agent first holding it, mapped onto the agents'
clock through the `room opened` line; a run's smallest arrival minus send
time must equal netem's floor (RTT/2 − jitter/2), which checks that mapping.
`DIR/summary.txt` holds the relay's counters, its CPU over the match in
percent of one core, and per agent the chosen and maximum depth, underruns
and their times, and delivery p50/p99/p99.9. The cells are not yet measured
on a host with CPU pressure below 20 (wisp#36).

**TCP fallback (wisp#41).** Some networks (hotels, schools, offices) block
outbound UDP; W3Champions falls back from QUIC to TCP for the same reason.
UDP stays the default. The agent's first up packets are its handshake and go
over UDP. If no down packet with its token arrives within 2 s
(`transport::FALLBACK_US`), the agent opens one TCP connection to the same
relay port and stays on it for the match. The connection carries the same
packets, each behind `wire::frame`'s u16 length prefix, and
`transport::Deframer` cuts them back out of the stream, refusing a frame
over 1,200 bytes. The relay keys players by token as before, so one room
holds UDP and TCP players together: a player heard over TCP is answered over
TCP from then on.

- **Each item once.** TCP is reliable and ordered, so over TCP the relay
  sends each turn once and the agent each action and checksum once, from
  where its last packet ended; acknowledgements still trim both queues. The
  first sim run kept UDP's redundant history on TCP: during head-of-line
  stalls the unacknowledged history outgrew the 4 packets a tick, the newest
  turns stopped going out and the relay's clock stopped for good.
- **Sim model.** A segment is delayed and lost like a UDP packet on the same
  path and delivered in order, so a lost segment holds every later one. A
  lost segment is resent one RTT plus 3 turn periods later (fast
  retransmit; RACK detects a lost retransmission the same way). An outage
  is recovered by one retransmission timer per connection, RTT + 200 ms
  doubling up to 120 s, after which the queued segments flow again. The
  connection opens one RTT after the switch.
- **Property test** (`relay-proto/tests/property.rs`): the first 48 of the
  128 scenarios rerun with UDP dropped entirely for every agent (the lobby
  and outages moved 3 s later so the lobby outlasts the fallback). Every
  agent ends on TCP and feeds the same turn sequence byte for byte (each
  fed turn as encoded on the wire), with the checks above. 16 scenarios run
  with every second agent blocked, in one room with UDP agents.
- **Measured** (bench, one hour, 8 ms turns, 25 October 2026):

| RTT | Loss | D (A/B), depth | Max depth | Underruns per 10 min (A/B) | Delivery p50/p99/p99.9 | Bytes/s down/up |
|---|---|---|---|---|---|---|
| 100 ms | UDP blocked, 1% over TCP | 6/6, 48.0 ms | 255.2 ms | 732.83/762.00 | 51.9/174.5/229.3 ms | 6459/5797 |

- **Reading it.** Delivery p99 is 174.5 ms against 59.4 ms over UDP at
  the same RTT and loss: a lost segment holds the stream for one RTT plus
  three turns. The depth rule assumes D + 1 copies of each turn, but TCP
  sends one, so it chooses 48 ms and underruns about 1.2 times a second.
  With `--margin 0.99` (depth from the lobby's 99th-percentile delay) the
  agents choose 140.3 ms and see 8.33/8.00 underruns per 10 minutes, past
  the 100 ms ceiling and the bar. So TCP keeps a player on a UDP-blocked
  network in the match but plays far worse than UDP does at 5% loss, and
  UDP stays the default. Bytes include the 2-byte prefix and are about half
  UDP's, because nothing is repeated. The TCP depth rule is open.

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
makes the late rate about p^D rather than about p.

- **Choosing depth before the match.** Smashcraft fixes its input delay and
  rollback budget for a whole match, so depth must settle before turns
  start. During the lobby and loading, the relay and agent exchange packets
  every turn period, and the agent measures loss, burst length and the
  spread of arrival(k) − relayTime(k). It picks the smallest D whose
  predicted late rate meets the bar: at 8 ms, D = 3 on a clean link and 5
  at 5% loss (Protocol core and bench, below). Smashcraft's echo then
  measures the delay players actually get.
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
- **Local feel.** Held-key reads are local: neither RTT nor D delays a
  player's own key state. R3 measured it on a gex45 pool pair at
  deadline-paced 17/17/16 with netem at 0, 100 and 200 ms
  (smashcraft:docs/warcraft-api-netcode-findings.md, "Held-key reads under
  round-trip delay"). The press-to-first-held-sample median moved by under
  2 ms (4.0 and 5.7 ms at 0, 5.0 and 4.2 ms at 200, p5–p95 within −7 to
  17 ms throughout), less than one frame, while the synchronized key-down
  event moved by the full added round trip (26 ms to 227 ms after the held
  sample). `BlzIsKeyPressed` follows the client's own input pump, as
  smashcraft#218 found. So D is priced by the opponent's view and rollback
  depth above, not by local input delay, and R9 judges each cell by spread,
  late rate and rollback depth, not by press-to-sample delay.
- **Taps.** Smashcraft#218 loses a tap when its press and release reach the
  host in one turn. Separate packets don't prevent that: two packets less
  than a turn apart land in the same turn, and a stalled client sends both
  edges at once. The agent decodes its game's actions (as wisp:host/lan/actions.ts
  does) and marks a key release whose press is still unacknowledged; the
  relay puts a marked release at least one turn after its press. R6 built
  the mark and the relay's placement (Protocol core and bench, below); R8
  builds the agent's decoding and R9 counts taps.

## Protocol core and bench (box R6)

Built 25 October 2026 in `wisp:relay/`, a Rust workspace pinned to
rustc 1.97.0 by `relay/rust-toolchain.toml`, with no dependencies. CI job
`relay-proto` runs `cargo test --locked -p relay-proto` and then
`-p relay -p relay-agent`.

- **`relay-proto`** holds pure state machines with no I/O and no clock of
  their own. The caller passes every time in microseconds.
  - `cadence`: the turn steps. The default is 8 ms (Turn cadence, above);
    any repeating pattern such as 17/17/16 is an option.
  - `wire`: little-endian packets of at most 1,200 bytes. They start with
    magic `0x57`, version 1, kind and the 64-bit session token. A down packet
    (45-byte header) carries the packet's sequence number, send time, match
    base time, the action and checksum acknowledgements and the turns from
    `turn_from` on, oldest first. Each turn is 3 bytes plus 7 per action and
    the action's bytes. An up packet (39-byte header) carries the turn
    acknowledgement, checksums from `checksum_from` and actions from
    `action_from`, each action 3 bytes (a flags byte whose only bit is the
    release mark, and a length) plus its bytes. Burst cover adds two kinds:
    a cover packet (kind 11, 20-byte header: token, the down sequence
    number, `turn_from` and a one-byte count) carries turns as a down packet
    does, and an up packet of kind 12 is an up packet with two more bytes
    after the turn acknowledgement, the cover packets a turn the agent asks
    for and how many of the newest turns each should carry. An agent that
    asks for no cover, or plays over TCP, sends kind 2, byte for byte as
    before. Decoding refuses short, trailing or unknown bytes, including
    unknown flags. A packet doesn't depend on datagram boundaries, so
    `wire::frame` (a u16 length prefix) is all the TCP fallback (Transport,
    above) needs.
  - `transport`: the 2 s fallback deadline and the TCP stream's deframer.
  - `relay`: the turn clock on absolute deadlines (probes every turn period
    in the lobby, then turn k at base + relayTime(k)). It takes each player's
    next action in sequence exactly once, caps a turn at what fits one
    packet (later actions wait for the next turn) and compares checksums,
    reporting the first desync. It drops turns every player has
    acknowledged. A marked release goes at least one turn after the same
    player's previous action, so after its press; that player's later
    actions wait with it, and other players' actions don't. When a player's
    checksums trail the emitted turns by more than 1 s of game time, the
    clock stops and the relay keeps probing every turn period. Once every
    player is back within 1 s, the base is rebased so the next turn is due
    at the restart, and the new base reaches agents in every packet.
    A player that asks for c cover packets gets them evenly spaced between
    turn deadlines, j/(c + 1) of a turn after each (j = 1..c), each with the
    newest turns it asked for and none it has acknowledged, numbered in the
    same sequence as its down packets. A stopped clock sends no cover, and
    neither does a player's TCP route.
  - `agent`: the jitter buffer as specified in Jitter buffer, above. The
    anchor is the 5th percentile of arrival − send time over 10 s and moves
    1 ms a turn. Underruns keep up to one turn of added depth, a backlog
    deeper than D + 2 drains at 4 ms a turn to D + 1, and the added depth
    slews back at 1 ms a turn after 30 s without an underrun. The agent
    takes the latest base the relay sends, so a rebased clock moves its
    feed schedule instead of starting a catch-up. It asks for burst cover as
    "Burst cover", below, describes, and takes turns from cover packets as
    from down packets.
  - `depth`: the choice before the match. From the lobby's packets it takes
    an upper bound on loss, (lost + 1 + 2√(lost + 1)) / (sent + 2), because
    20 s of lobby holds only about 25 losses at 1% and the point estimate
    under-picked D. It also takes loss after loss (no lower than that bound)
    and the empirical delay spread. The predicted late rate is the product
    over the D + 1 copies of P(lost or later than its slack), and the bar is
    one underrun per 10 minutes of play at the cadence's turn length. The
    smallest D that meets the bar is chosen; past 100 ms of depth (12 turns
    at 8 ms) the link is too poor (`!` in the table). With c cover packets a
    turn the product runs over the (c + 1)D + 1 packets that carry a turn
    before its feed time, each with T/(c + 1) less slack than the one
    before, and every packet after the first lost with the loss after loss.
  - `sim`: a seeded event simulator with per-direction delay, exponential
    jitter, independent or Gilbert-Elliott loss, blackouts, agent clock
    drift and per-agent blocked UDP with the TCP fallback. Its
    Gilbert-Elliott chain steps once per packet sent.
- **Change from the plan.** When the unacknowledged turns (or actions) don't
  fit 1,200 bytes, the sender sends up to 4 consecutive packets in that
  tick, oldest first. With one packet a tick, a heavy action stream starved
  the newest turns until older ones were acknowledged, and the agent fell
  behind for good.
- **Property test** (`relay-proto/tests/property.rs`): across 128 seeded
  scenarios (2 to 4 agents, 0–150 ms each way, jitter up to 40 ms mean, loss
  up to 30% independent or 20% in bursts, up to three outages of up to 3 s,
  ±500 ppm drift, 8 ms, 17/17/16 or 25 ms turns, both depth rules, burst
  cover on or off, a random share of actions marked as releases), every
  agent feeds the same turns in order with the relay's steps. Every action
  an agent sent appears exactly once, in order, in every agent's feed, and
  every marked release lands in a later turn than its player's previous
  action. The relay sees no desync.
  A separate case overfills turns (3 agents at 400 actions a second of up
  to 500 bytes) through a 1 s outage.
- **Bench** (`cargo run --release -p relay-bench -- --grid`, about 5 s for
  the grid on gex45; `--steps 17,17,16` and `--margin 0.95` select the other
  cadence and depth rule, `--rtts 120` other round trips, whose cells take
  the seeds of the grid's first round trip, and `--no-cover` turns burst
  cover off): two agents, each cell an hour of play (450,000 turns at 8 ms)
  after a 20 s lobby. Delay is RTT / 2 each way plus
  exponential jitter of 2 ms mean. The agents' clocks drift +100 and
  −100 ppm, and each sends 4 actions a second of 9–29 bytes, half of them
  marked releases. Blackout cells drop every packet for 1 s every 5 minutes.
  Their underruns from a blackout start until 1 s after it drains are not
  counted. The "UDP blocked" cell drops all UDP for both agents, so they
  play over the TCP fallback (Transport, above); it is measured only.
  "D" is each agent's chosen depth in turns, with "+c" when it ended the
  match asking for c cover packets a turn. "Depth" is the worse agent's
  chosen depth and "max depth" the most it reached with added depth.
  "Catch-up after blackout" is the longest
  time from a blackout's end until the agent is back to D + 1. "Delivery" is
  the time from the relay emitting a turn to the agent first holding it, at
  the worse agent's p50, p99 and p99.9. "Own echo" is the time from an agent
  sending an action to that agent feeding the turn that carries it, at the
  worse agent's p50 and p99: one way up, the wait for the next turn, one way
  down and the depth. Bytes a second are the UDP
  payloads of every packet sent during the match, lost or not, for the
  worse agent; IPv4 and UDP headers add 28 bytes a packet, 3.5 kB/s each
  way at 125 packets a second. The bar:
  independent-loss and blackout cells at most 1 underrun per 10 minutes,
  depth at most 50 ms up to 1% loss and 66.7 ms at 2% and 5%, blackouts
  drained within 2 s, no desync; burst cells at most 1 underrun per
  10 minutes and depth at most 66.7 ms (wisp#45). Results at 8 ms turns
  with burst cover, 25 October 2026:

| RTT | Loss | D (A/B), depth | Max depth | Underruns per 10 min (A/B) | Catch-up after blackout | Delivery p50/p99/p99.9 | Own echo p50/p99 | Bytes/s down/up | Clock stops | Desync | Bar |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 ms | no loss | 3/3, 24.0 ms | 24.0 ms | 0.00/0.00 | – | 51.4/58.6/61.0 ms | 130.5/138.8 ms | 13784/13317 | 0 | none | pass (≤ 50.0 ms) |
| 100 ms | 0.5% independent | 3/3, 24.0 ms | 24.0 ms | 0.00/0.00 | – | 51.4/59.0/62.2 ms | 130.5/139.4 ms | 13780/13329 | 0 | none | pass (≤ 50.0 ms) |
| 100 ms | 1% independent | 3/3, 24.0 ms | 27.7 ms | 0.50/0.33 | – | 51.5/59.4/63.1 ms | 130.5/139.8 ms | 13771/13316 | 0 | none | pass (≤ 50.0 ms) |
| 100 ms | 2% independent | 4/4, 32.0 ms | 32.0 ms | 0.00/0.00 | – | 51.5/60.1/65.2 ms | 138.6/148.2 ms | 13848/13365 | 0 | none | pass (≤ 66.7 ms) |
| 100 ms | 5% independent | 4/5, 40.0 ms | 41.1 ms | 0.83/0.17 | – | 51.5/62.0/68.5 ms | 146.7/157.5 ms | 13859/13384 | 0 | none | pass (≤ 66.7 ms) |
| 100 ms | 1% bursts of 2 | 6+3/6+2, 48.0 ms | 48.0 ms | 0.00/0.00 | – | 51.5/56.2/62.5 ms | 154.5/164.1 ms | 33506/13594 | 0 | none | pass (≤ 66.7 ms) |
| 100 ms | 1% bursts of 4 | 8+4/5+4, 64.0 ms | 66.1 ms | 0.00/0.83 | – | 51.5/55.3/65.8 ms | 169.5/179.4 ms | 44678/13589 | 0 | none | pass (≤ 66.7 ms) |
| 100 ms | 3% bursts of 2 | 5+2/6+2, 48.0 ms | 48.3 ms | 0.17/0.00 | – | 51.5/58.1/66.7 ms | 154.6/172.4 ms | 26878/13610 | 0 | none | pass (≤ 66.7 ms) |
| 100 ms | 3% bursts of 4 | 6+4/6+4, 48.0 ms | 64.6 ms | 0.83/0.67 | – | 51.5/58.6/71.9 ms | 154.6/195.0 ms | 40142/13676 | 0 | none | pass (≤ 66.7 ms) |
| 100 ms | 1% + 1 s blackout / 5 min | 3/3, 24.0 ms | 1007.3 ms | 0.17/0.00 | 906 ms | 51.5/59.9/730.3 ms | 130.9/144.0 ms | 13881/13365 | 11 | none | pass (≤ 50.0 ms) |
| 150 ms | no loss | 3/3, 24.0 ms | 24.0 ms | 0.00/0.00 | – | 76.4/83.7/86.0 ms | 180.4/188.8 ms | 17420/17044 | 0 | none | pass (≤ 50.0 ms) |
| 150 ms | 0.5% independent | 3/3, 24.0 ms | 24.6 ms | 0.17/0.00 | – | 76.4/84.0/87.1 ms | 180.5/189.1 ms | 17462/17070 | 0 | none | pass (≤ 50.0 ms) |
| 150 ms | 1% independent | 4/3, 32.0 ms | 32.0 ms | 0.00/0.00 | – | 76.5/84.4/88.2 ms | 187.5/196.5 ms | 17419/17053 | 0 | none | pass (≤ 50.0 ms) |
| 150 ms | 2% independent | 4/4, 32.0 ms | 32.0 ms | 0.00/0.00 | – | 76.5/85.1/90.6 ms | 188.6/198.5 ms | 17415/17063 | 0 | none | pass (≤ 66.7 ms) |
| 150 ms | 5% independent | 5/5, 40.0 ms | 41.9 ms | 0.17/0.00 | – | 76.5/86.8/93.4 ms | 196.7/207.5 ms | 17443/17091 | 0 | none | pass (≤ 66.7 ms) |
| 150 ms | 1% bursts of 2 | 5+3/5+2, 40.0 ms | 40.0 ms | 0.00/0.00 | – | 76.5/81.2/87.3 ms | 196.5/206.5 ms | 35517/17351 | 0 | none | pass (≤ 66.7 ms) |
| 150 ms | 1% bursts of 4 | 3+4/7+4, 56.0 ms | 58.0 ms | 11.33/0.00 | – | 76.5/80.2/90.4 ms | 212.5/223.1 ms | 46011/17323 | 0 | none | fail (underruns) |
| 150 ms | 3% bursts of 2 | 5+2/5+2, 40.0 ms | 48.0 ms | 0.17/0.17 | – | 76.5/83.1/91.6 ms | 196.6/212.9 ms | 29478/17378 | 0 | none | pass (≤ 66.7 ms) |
| 150 ms | 3% bursts of 4 | 6+4/6+4, 48.0 ms | 68.9 ms | 0.50/0.83 | – | 76.5/83.7/96.3 ms | 204.7/238.8 ms | 43755/17393 | 0 | none | pass (≤ 66.7 ms) |
| 150 ms | 1% + 1 s blackout / 5 min | 3/4, 32.0 ms | 1007.7 ms | 0.17/0.00 | 870 ms | 76.5/84.8/756.0 ms | 188.9/200.8 ms | 17524/17127 | 11 | none | pass (≤ 50.0 ms) |
| 200 ms | no loss | 3/3, 24.0 ms | 24.0 ms | 0.00/0.00 | – | 101.4/108.7/111.0 ms | 230.5/238.7 ms | 21042/20806 | 0 | none | pass (≤ 50.0 ms) |
| 200 ms | 0.5% independent | 3/3, 24.0 ms | 24.0 ms | 0.00/0.00 | – | 101.4/109.0/112.1 ms | 230.4/239.1 ms | 21032/20794 | 0 | none | pass (≤ 50.0 ms) |
| 200 ms | 1% independent | 3/3, 24.0 ms | 27.1 ms | 0.33/0.00 | – | 101.5/109.4/113.2 ms | 230.5/239.7 ms | 21068/20790 | 0 | none | pass (≤ 50.0 ms) |
| 200 ms | 2% independent | 4/4, 32.0 ms | 32.0 ms | 0.00/0.00 | – | 101.5/110.1/115.1 ms | 238.6/248.2 ms | 21089/20813 | 0 | none | pass (≤ 66.7 ms) |
| 200 ms | 5% independent | 5/5, 40.0 ms | 40.0 ms | 0.00/0.00 | – | 101.5/111.9/118.5 ms | 246.7/257.5 ms | 21120/20835 | 0 | none | pass (≤ 66.7 ms) |
| 200 ms | 1% bursts of 2 | 6+1/6+1, 48.0 ms | 53.9 ms | 0.33/0.00 | – | 101.5/107.6/117.6 ms | 254.6/264.2 ms | 27709/21095 | 0 | none | pass (≤ 66.7 ms) |
| 200 ms | 1% bursts of 4 | 6+4/6+4, 48.0 ms | 48.9 ms | 0.00/0.17 | – | 101.5/105.3/115.7 ms | 254.5/264.4 ms | 47432/21095 | 0 | none | pass (≤ 66.7 ms) |
| 200 ms | 3% bursts of 2 | 5+2/5+2, 40.0 ms | 50.0 ms | 0.00/0.33 | – | 101.5/108.2/116.7 ms | 246.7/264.7 ms | 33125/21116 | 0 | none | pass (≤ 66.7 ms) |
| 200 ms | 3% bursts of 4 | 8+4/8+4, 64.0 ms | 64.0 ms | 0.00/0.00 | – | 101.5/108.5/121.3 ms | 270.6/306.7 ms | 52032/21126 | 0 | none | pass (≤ 66.7 ms) |
| 200 ms | 1% + 1 s blackout / 5 min | 3/3, 24.0 ms | 1008.0 ms | 0.17/0.17 | 858 ms | 101.5/109.8/780.3 ms | 230.9/243.3 ms | 21147/20833 | 11 | none | pass (≤ 50.0 ms) |
| 100 ms | UDP blocked, 1% over TCP | 6/6, 48.0 ms | 255.2 ms | 732.83/762.00 | – | 51.9/174.5/229.3 ms | 162.6/304.7 ms | 6459/5797 | 0 | none | measured |

- **Bar.** Met in every clean, independent-loss and blackout cell, whose
  rows are identical in every column with `--no-cover` and to R6's first
  grid: depth 24–32 ms up to 1% loss (D = 3,
  one agent D = 4 at 150 ms), 32 ms at 2% and 40 ms at 5% (D = 4–5),
  with at most 0.83 underruns per 10 minutes. Every blackout stopped the
  clock once (11 an hour), drained in 858–906 ms and caused no desync.
  Each cell is one seed and one hour, so a rate near the bar is a handful
  of underruns (0.83 per 10 minutes at 100 ms and 5% is 5 in the hour)
  and another seed can land on either side of 1.
  Provenance: at most one underrun per 10 minutes with depth at most
  50 ms up to 1% loss and 66.7 ms at 5%; origin the proxy's decision of
  25 October 2026 to accept D = 4 at 5% after R6's first grid measured the
  late rate as p^D, stated there as D ≤ 3 up to 1% and D ≤ 4 at 5% in
  17/17/16 turns, and held here in milliseconds because depth is kept in
  milliseconds whatever the turn length (Turn cadence, above); pointer this
  section; revisit after wisp#38's native cells.
- **120 ms** (`--grid --rtts 120`, the round trip wisp:docs/network-model.md's
  relay delivery defaults to; rows other than bursts are the same without
  burst cover):

  | RTT | Loss | D (A/B), depth | Max depth | Underruns per 10 min (A/B) | Catch-up after blackout | Delivery p50/p99/p99.9 | Own echo p50/p99 | Bytes/s down/up | Clock stops | Desync | Bar |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | 120 ms | no loss | 3/3, 24.0 ms | 24.0 ms | 0.00/0.00 | – | 61.4/68.6/71.0 ms | 150.5/158.9 ms | 15243/14813 | 0 | none | pass (≤ 50.0 ms) |
  | 120 ms | 0.5% independent | 3/3, 24.0 ms | 24.0 ms | 0.00/0.00 | – | 61.4/69.0/72.2 ms | 150.5/159.5 ms | 15237/14827 | 0 | none | pass (≤ 50.0 ms) |
  | 120 ms | 1% independent | 3/3, 24.0 ms | 27.7 ms | 0.50/0.33 | – | 61.5/69.4/73.1 ms | 150.6/159.8 ms | 15229/14811 | 0 | none | pass (≤ 50.0 ms) |
  | 120 ms | 2% independent | 4/4, 32.0 ms | 32.0 ms | 0.00/0.00 | – | 61.5/70.1/75.2 ms | 158.5/168.3 ms | 15313/14867 | 0 | none | pass (≤ 66.7 ms) |
  | 120 ms | 5% independent | 4/5, 40.0 ms | 41.1 ms | 0.83/0.17 | – | 61.5/72.0/78.5 ms | 166.7/177.4 ms | 15319/14879 | 0 | none | pass (≤ 66.7 ms) |
  | 120 ms | 1% bursts of 2 | 6+3/6+2, 48.0 ms | 48.0 ms | 0.00/0.00 | – | 61.5/66.3/72.2 ms | 174.6/184.2 ms | 34963/15094 | 0 | none | pass (≤ 66.7 ms) |
  | 120 ms | 1% bursts of 4 | 8+4/5+4, 64.0 ms | 65.1 ms | 0.00/0.83 | – | 61.5/65.3/75.8 ms | 189.5/199.8 ms | 46129/15084 | 0 | none | pass (≤ 66.7 ms) |
  | 120 ms | 3% bursts of 2 | 5+2/6+2, 48.0 ms | 48.0 ms | 0.17/0.00 | – | 61.5/68.1/76.6 ms | 174.7/192.4 ms | 28330/15105 | 0 | none | pass (≤ 66.7 ms) |
  | 120 ms | 3% bursts of 4 | 6+4/6+4, 48.0 ms | 66.2 ms | 1.00/0.67 | – | 61.5/68.6/81.9 ms | 174.6/215.5 ms | 41597/15176 | 0 | none | pass (≤ 66.7 ms) |
  | 120 ms | 1% + 1 s blackout / 5 min | 3/3, 24.0 ms | 1007.3 ms | 0.17/0.00 | 897 ms | 61.5/69.9/740.3 ms | 151.0/163.5 ms | 15341/14864 | 11 | none | pass (≤ 50.0 ms) |
  | 100 ms | UDP blocked, 1% over TCP | 6/6, 48.0 ms | 255.2 ms | 732.83/762.00 | – | 51.9/174.5/229.3 ms | 162.6/304.7 ms | 6459/5797 | 0 | none | measured |

  The 2% cell gives that model D = 4 and its own echo of 158.5/168.3 ms; the
  model reproduces it within 1% (wisp:docs/network-model.md, "Relay
  delivery").
- **8 ms against 17/17/16.** The same grid at 17/17/16 chooses D = 2–5
  (33.3–83.3 ms): 50 ms up to 1% loss (66.7 ms for one agent at 150 ms), and
  66.7–83.3 ms at 5%, which misses the bar at 1% and 5% for 150 ms and at
  5% for 200 ms. 8 ms needs
  more turns but less depth everywhere, and its 5% depth is 40 ms against
  66.7–83.3 ms. It costs bytes: 13.8–21.2 kB/s down and 13.3–20.9 kB/s up
  per agent against 5.5–7.9 and 4.9–7.0 kB/s, because twice as many packets
  each carry about twice as many unacknowledged turns and checksums. A
  blackout drains in 858–906 ms against 327–345 ms, since catch-up at 4 ms a
  turn runs 2× at 8 ms and about 4× at 17/17/16.
### Burst cover (wisp#45)

Built 25 October 2026. Without it (`--no-cover`, R6's rows), 1% loss in
bursts of 2 needed 7–12 turns (56–96 ms) or reported the link too poor
and still saw up to 5.5 underruns per 10 minutes, and bursts of 4 at 1% and
3% saw 7.2–79, mostly at the 100 ms ceiling.

- **Why copies spread in time don't help alone.** Every down packet already
  carries every unacknowledged turn, so turn k is in each of the D + 1
  packets sent before its feed time. Copies at 0, 1, 3 and 7 turns would be
  a subset of those. A burst that takes those D + 1 packets leaves nothing
  for any coding to work with, so cover needs more packets between turns.
- **Designs measured.** Both send c cover packets evenly between turns, on
  the same choice rules (below), and differ in what a cover packet holds:
  - *Copies* (kept): the newest D + 1 turns, as a down packet holds them.
  - *Parity*: the XOR of the newest D + 1 turns' encodings and of their
    lengths, from which the agent rebuilds one missing turn from the rest
    (it keeps the turns it has fed for that). The parity code was removed
    after the comparison.
- **Choice rules.** The lobby is bursty when its loss after loss is above
  0.2; the independent cells' lobbies saw at most 0.08 and the burst
  cells' 0.29–0.83, except one lobby that saw almost no loss (below). On a
  bursty lobby the agent raises the loss after loss by one standard error
  (the 3% bursts of 4 lobbies at 100 and 150 ms estimated 0.65–0.70 against
  the model's 0.75, and chose depths that missed the bar) and
  takes the smallest c from 1 to 4 whose depth fits 48 ms, or else c = 4
  with the depth that meets the bar, capped at 66.7 ms. During the match it
  counts every down and cover packet's sequence number in a 64-packet
  reorder window (cover packets 2 ms apart often arrive out of order with
  2 ms of jitter), leaves out runs longer than 64 packets as outages no
  cover bridges, and every 1,000 packets, if the lobby and match together
  show loss after loss above 0.2, raises c to the smallest that meets the
  bar at the depth it chose. It never lowers c and never changes the depth,
  because depth is fixed before the match (Jitter buffer, above); cover
  adds bytes, not latency.
- **Result.** Copies with up to 4 cover packets a turn meet the underrun and
  depth bar in 11 of 12 burst cells (table above), at depth 40–64 ms and
  0–0.83 underruns per 10 minutes. Parity with up to 4 met it in 9, parity
  with up to 3 in 8 and copies with up to 3 in 10. Those three runs came
  before the 64-packet window replaced a reorder rule that over-counted
  bursts and raised cover early; the window moved copies' bursts of 4 rows
  by at most 0.67 underruns per 10 minutes. In the bursts of 4 cells, where
  both forms reached c = 4:

| RTT | Loss | Copies: D (A/B), depth | Underruns | Bytes/s down | Parity: D (A/B), depth | Underruns | Bytes/s down |
|---|---|---|---|---|---|---|---|
| 100 ms | 1% bursts of 4 | 8+4/5+4, 64.0 ms | 0.00/0.83 | 44678 | 8+4/5+4, 64.0 ms | 0.00/2.00 | 32282 |
| 100 ms | 3% bursts of 4 | 6+4/6+4, 48.0 ms | 0.83/0.67 | 40142 | 7+4/6+4, 56.0 ms | 1.00/0.83 | 31838 |
| 150 ms | 1% bursts of 4 | 3+4/7+4, 56.0 ms | 11.33/0.00 | 46011 | 3+4/8+4, 64.0 ms | 19.17/0.00 | 35932 |
| 150 ms | 3% bursts of 4 | 6+4/6+4, 48.0 ms | 0.50/0.83 | 43755 | 7+4/6+4, 56.0 ms | 0.33/1.67 | 35464 |
| 200 ms | 1% bursts of 4 | 6+4/6+4, 48.0 ms | 0.00/0.17 | 47432 | 6+4/6+4, 48.0 ms | 0.33/0.33 | 38557 |
| 200 ms | 3% bursts of 4 | 8+4/8+4, 64.0 ms | 0.00/0.00 | 52032 | 8+4/8+4, 64.0 ms | 0.00/0.00 | 39641 |

- **The cell that misses.** At 150 ms and 1% in bursts of 4, agent A's
  20 s lobby saw one loss in 2,491 packets (an estimated 0.19% with loss
  after loss 0.002), so it chose D = 3 with no cover. The match raised its
  cover to 4, which cut its underruns from 79 to 11.33 per 10 minutes, but
  at 24 ms of depth a burst of 16 packets still spans every copy. A lobby
  this short sees about 6 bursts at that rate; no rule that keeps clean and
  independent links unchanged can tell this lobby from a clean one.
- **Bytes.** Down, burst cells send 1.31–3.22 times the bytes of the same
  RTT's independent-loss cells (the largest of them, 13.9, 17.5 and
  21.1 kB/s at 100, 150 and 200 ms); up stays within 1.03 times, since only the two
  request bytes are added. The 1.5 times bar is met down only at 200 ms and
  1% in bursts of 2. Each cover packet repeats D + 1 turns behind a 20-byte
  header, so 4 a turn at D = 6–8 add about 4 × 50–62 bytes a turn. Parity
  cuts the extra bytes by about 40% but misses three cells. The
  bytes bar is soft, so this records the overrun for its revisit.
- **So no measured design meets the whole bar.** Copies is kept as the best:
  underruns and depth met in 11 of 12 burst cells, bytes in 1. Clean,
  independent-loss and blackout cells are unchanged.
- **What the bench can't say.** The simulator's Gilbert-Elliott chain steps
  once per packet, so a burst's length is counted in packets, and more
  packets a turn make the same burst shorter in time. That is what cover
  buys in the bench. If real bursts last a fixed time (a Wi-Fi fade, say),
  extra packets don't shorten them, and no design that keeps depth at
  66.7 ms covers a burst longer than that. R10's recorded trace
  (wisp#39) decides which holds; wisp#45's second box replays it.

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

Built for wisp#37 (code box), in `relay/`:

- relay-proto `room` carries the room between relay and agents: the map
  facts, the relay's seed, each agent's player id, joins, map sizes, ready,
  loaded, chat, handicaps and leaves. `stream` sends those messages as wire
  kind 10, beside the turn packets and #36's control kinds, and each side
  resends every 50 ms until the other acknowledges. `lobby` is the relay's
  side: it starts the countdown 1.5 s after the last join once every agent
  reports its game has the map and its skins, ends it 6 s later, and forwards
  loads, as host.ts times them. Map facts travel as one `key=value` line
  (`MapFacts::parse`), the form the fixture's header uses.
- In the relay, a room's first agent sends the map facts it read from its
  own copy; the room then picks one seed and runs the lobby, and its turn
  clock starts when every game has loaded instead of a fixed lobby time. A
  started room prints a summary every 5 s and when it closes: turns, game
  and wall seconds, pace, checksums compared, desyncs and stops.
- relay-agent `game` is host.ts's lobby and turn loop for one local game, with
  the remote players coming from the relay. `host` runs it over #36's link:
  once the room has arrived, a loopback TCP listener with `TCP_NODELAY`, LAN announcements to the client ports every
  250 ms, pings every 3 s before play, and each relay turn written as one
  IncomingAction when the jitter buffer feeds it. `keys` reads the game's
  key actions (0x79) and marks an action that releases a key whose press the
  relay has not yet acknowledged, so the relay places it a turn later
  (smashcraft#218).
- `cargo test -p relay-agent` replays
  `relay-agent/tests/fixtures/pool-lobby.packets`, a two-client pool lobby
  host.ts hosted on 24 October 2026, through two agents and the relay's
  lobby, and requires each client's received bytes up to the first turn to
  equal host.ts's, except the joiner's own address in slot-info-join and the
  ping ticks.
- `cargo test -p relay --test game` plays two scripted games through two
  agents and the relay over loopback sockets: both join, load and answer 200
  turns, a press and release sent together arrive in different turns, and no
  checksum differs.
- `wisp lan relayed MAP --relay-bin DIR --pair K` starts the relay and one
  agent per client inside the pair's namespace and joins each client to its
  own agent's game; logs land in the pair's `games/relayed-*` folder.

## Where the relay runs, NAT, and who can join (boxes R10, C1)

- **Host.** One relay on a public address. Nexus, the always-on server, is
  recommended. gex45 runs the native pool, whose load would show up as relay
  jitter, so it keeps the test relays inside pool namespaces. Opening a public
  UDP port on either server widens access, so R10 asks Tom first; he approved
  Nexus's on 25 October 2026. A second region waits until measured player
  RTTs call for one.
- **Port.** The public relay listens on UDP 7457, the binary's default
  `--bind` port, and nothing else. It runs on Nexus as a sandboxed systemd
  service: a dynamic user, a read-only filesystem, no capabilities, and a
  socket bind allowed only on UDP 7457, which is the one port its firewall
  rule opens. The `relay` binary has no TCP listener yet, so the TCP
  fallback (Transport, above) reaches the public relay only once it gains
  one on TCP 7457 (tompassarelli/wisp#49).
- **NAT.** Every agent sends first, to the relay's public address, so no hole
  punching, STUN or port forwarding is needed. CGNAT works. Traffic every
  turn period keeps NAT mappings open; in the lobby the agent sends at least
  once a second. A network that blocks UDP reaches the relay over TCP on the
  same port (Transport, above).
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
  is (wisp#33); method and gex45 trial in Baseline, above.
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
- **Depth rule at 5% loss (proxy, 25 October 2026).** Depth stays whole
  turns without the p95 − p5 margin, and the bar accepts 66.7 ms at 5%
  independent loss; at 8 ms that is D = 4–5, 40 ms (Protocol core and
  bench). Revisit after wisp#38's native cells.

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

Provenance: at most one underrun per 10 minutes (1.3 × 10⁻⁵ per turn at
8 ms) at RTT up to 200 ms and loss up to 5%, with D ≤ 3, judged in R6's
bench on independent, burst and recorded loss; origin prior-art (W3Champions'
October 2026 announcement of no loss spikes at 5% loss and 200 ms ping);
pointer this page, "Transport"; rationale not recorded; revisit when R6
reports its burst-loss cells. R6 reported them on 25 October 2026 (Protocol
core and bench): burst cells miss the bar at every depth up to the 100 ms
ceiling, now wisp#45, and independent loss meets it with depth up to 50 ms
at 1% and 66.7 ms at 5% (the proxy's bar of 25 October 2026, recorded
there). With wisp#45's burst cover, 11 of 12 burst cells meet the bar with
depth at most 64 ms, at 1.3–3.2 times the bytes down (Protocol core and
bench, "Burst cover").

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
