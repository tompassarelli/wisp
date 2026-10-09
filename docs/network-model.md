# Network and timing model

Two parts: Wisp's own [transport](#wisps-transport), which carries a match
between processes, and the [latency model](#what-it-models) that gives
headless clients in one process Warcraft's measured sync delays.

By default the [headless runtime](headless.md) delivers a synchronized
message before the frame after the one that sent it. Warcraft delivers it
several frames later. `syncDelivery()` (wisp:src/headless/syncChannel.ts)
gives headless clients the latency Smashcraft's native traces measured, so a
map's rollback, prediction and timeout logic meets realistic delays in a
second-long run.

```ts
import { MEASURED_BATTLE_NET, syncDelivery } from "wisp/src/headless/syncChannel";

const clients = headless.clients(entry, [0, 1], { delivery: syncDelivery(MEASURED_BATTLE_NET, 7) });
```

A `Lockstep` takes the same object as its `delivery` option. The seed makes
a run repeat exactly; change it to sample other delays.

## What it models

| Part | Model | Measured |
| --- | --- | --- |
| Callback cadence | Every client runs its timer callbacks 60 times a game second, at the same game times. | 16.66 game-ms between callbacks, identical on both clients, across every callback of #26 r7 and r8. |
| Turns | A message reaches every client at the same synchronized turn; turns are 25 game-ms apart. | Echo times fall on a 24.87–24.99 ms grid. |
| Latency | 80 ms after the send, rounded up to the next turn, plus 0, 1, 2, … further turns with probabilities 0.4, then each 0.6 of the one before (the ninth bucket holds the rest). | Own-echo ages p10/p25/p50/p75/p90/p95 86/95/115/137/194/212 ms; the model gives 83/92/117/150/192/225. |
| Order | Each sender's messages arrive in the order it sent them; arrivals land before that frame's callbacks. | |

The latency is fitted to the 765 own echoes of both clients 1.5–9.5 s into
the first match of Smashcraft's #26 runs r7 and r8 (Smashcraft 0.0.42,
5 October 2026, two clients on one host, before any backlog;
smashcraft:evidence/input-integrity-0042-r7-20261005/ and -r8-). Chat and key
events still arrive at once.

Hosting: r7 and r8 ran as a Battle.net Custom Game (`[TEST] sc-integrity-r7`/`-r8`,
created on signed-in client A and found by client B through the Custom Games
search), not on a LAN, so the fit describes Battle.net-hosted turns. Offline
pool games are relayed by Wisp's own LAN host, whose turn period is
`lan fresh --turn-ms` (default 30 ms); their echo ages are not yet measured.

## Replayed arrivals

`replayedDelivery(arrivals, fallback, nowMs)` replays the arrival times a
native capture measured for particular messages and leaves every other one
to `fallback` (usually `syncDelivery()`). Each `ReplayedArrival` names the
message it takes (`accepts`, used once) and the time it arrived (`atMs`). The
message reaches every client at the first frame due at or after that time;
`nowMs` gives when the sending frame was due on the same clock, so with
`RealtimeClients` it is `() => realtime.frameDueMs()` and frames run late
under load still land on the measured time. `arrivals` is read at every
send, so a consumer can anchor the times to its own run, such as the moment
its scripted Start press went in. A sender's messages still arrive in order.

Smashcraft's `pad SCRIPT --headless --replay-arrivals NATIVE_DIR` measures
its pause and resume control messages from a native run's helper journals
this way (wisp#86, [Pause and drawn-frame timing](headless.md#pause-and-drawn-frame-timing)).

## Limits

**Saturation is not modeled.** In r7, r8 and the 6 October send-rate sweep
(smashcraft:evidence/input-integrity-sendcap-20261006/), a client's own
echo grew to 1–2 s while input was dense and stayed there. A per-sender byte
budget does not explain it, though fitted to r8 alone (450 bytes a second
per sender) it reproduced r8's echo, stalls and opponent lateness. On the
sweep it failed: it predicted 22, 64 and 110 prediction stalls at 10, 15 and
20 messages a second; the clients had 109, 123 and 116. In the sweep the two
clients sent the same bytes, about 380 a second at the densest; the hosting
client A held a 1.0–1.4 s echo even while sending 65 bytes a second, and
client B's median per-second echo stayed at 78–106 ms.

What the saturated client shows instead is a game clock behind real time.
Its journal receipts reached its helper about 0.5–1.2 s later, relative to its
game clock, than when the match began: r7 client B 0.72 s while A stayed
within 0.13 s, r8 client A 0.83 s and B 0.50 s, and the sweep's client A
0.74–1.21 s in every match while B stayed within 0.34 s. A client behind
real time sends late, so every client receives its messages late; its own
echo and the others' prediction stalls follow. Why the client falls behind is not measured, so the model has
no client lag and does not predict saturation.

**Latency moves between sessions.** On the held-out sweep (Smashcraft's
TypeScript map, 6 October), unsaturated echo was faster than the model for
client B (p50 65–97 ms, p90 89–127 ms against the model's 114–124 and
189–199) and about as fast for client A (p50 90–162 ms).

Neither session crossed the internet beyond one host and Battle.net; other
hosts, regions and hosting services are unmeasured.

## Wisp's transport

Two processes, one client each, play one match over UDP: the host is slot 0
and listens; the joiner is slot 1 and sends to the host's address and port
(LAN or a direct address; no relay, no Battle.net message, no W3GS).
wisp:src/headless/turnLedger.ts is the pure core; wisp:scripts/wisp/net/peer.ts
(`runNetPeer`) is the Effect shell that owns the socket, the frame clock and
the handshake.

**Events.** Every synchronized event a client raises goes over the wire:
`BlzSendSyncData` messages, player key events, chat and frame clicks. A
`Lockstep` created with `link` (a `TurnLedger`) and `humans` (every slot in the
match) runs only the local slot's client and hands each event to the link
instead of delivering it in process.

**Turns and order.** There is one turn per frame (16.7 ms). An event raised
while frame n runs is due at frame n + d, one raised between frames n and n + 1
at n + 1 + d, where d is the turn delay. Every client delivers a frame's
events before its callbacks, the lower slot's first, each sender's in the order
it sent them, so every client sees the same events on the same frame. A frame
runs only once the peer has promised all of its events for that frame.

**Packets.** After every frame, and every 8 ms while waiting, each side sends
one packet: its frontier (the last frame whose events it has promised), every
turn after the peer's last acknowledgement, its acknowledgement of the peer's
frontier, and its last four checksums. A lost packet is repaired by the next
one, a frame later; there is no retransmission timer.

**Delay.** The host measures the round trip with eight pings and picks
d = ceil((round trip / 2 + 4 ms) / 16.7 ms), at least 1: the one-way time plus
room for the sender's frame and timer jitter. On one host that is 1 frame; at
60 ms round trip 3, at 120 ms 4. Both sides start their clients, then the host
names a start time that the joiner shifts by half the round trip.

**Pacing.** Frames run on a 60 Hz schedule. A side more than three frames behind
its schedule (a slow frame, a long wait) drops the backlog instead of racing to
catch up (a slip); a side whose schedule is ahead of the peer's estimated frame
slows by up to 1 ms a frame (`paceShift`).

**Checksums.** Every 60 frames each side records the game's checksum; packets
carry the last four, and the first difference ends the match with
`NetDesync` naming the frame and both values.

**Ending.** A peer that sends nothing for 3 s ends the match with `PeerSilent`;
a peer that leaves sends a goodbye, and the other side ends at once with
`PeerLeft` unless it already has every turn it needs. A finished side keeps
sending until the peer has its last turns and checksums (at most 3 s), then
says goodbye.

### Run it

A game exposes the command with `makeNet(load, name, gameFlags)`
(wisp:scripts/wisp/commands/net.ts); `load` returns a `NetGame` whose `create`
builds a session for one slot from the link. The sample's is
wisp:examples/sample/test/net.ts, which types `-ping` every two seconds per
player:

```sh
bun examples/sample/scripts/sample.ts net pair --frames 10000
bun examples/sample/scripts/sample.ts net pair --frames 1200 --rtt 120 --loss 0.01
bun examples/sample/scripts/sample.ts net pair --frames 1200 --freeze-at 300
```

`host [--port N]` and `join ADDRESS:PORT` run one side each; `pair` runs both
on this machine and prints one line per side. With `--rtt MS` or `--loss P`,
`pair` puts `net proxy` between them: a separate process that holds every
datagram half the round trip in each direction and drops it with probability
P (seeded by `--seed`). `--freeze-at F` makes the joiner stop sending after
frame F, `--quit-at F` makes it leave; `--delay N` fixes the turn delay.
Each side's line gives the frames, delay, checksums compared and mismatches,
delivery time p50/p95/p99/max (from the moment the remote event was raised to
the frame that delivered it here, both on this host's clock), its step cost,
slips and late frames.

For timings off a shared machine, dispatch wisp:.github/workflows/net-timing.yml:
it runs one `pair` per round trip on its own hosted runner, for this
repository's sample or a game's (`repository`, `ref`, `directory`, `pair`).

### Measured (9 October 2026)

- Sample, two processes on one host, loopback, 10,000 frames, delay 1: 166
  checksums compared per side, 0 mismatches; delivery p95 20.9 ms (host) and
  19.1 ms (joiner).
- A joiner that stops sending at frame 300 (`--freeze-at 300`) ends the host
  with `PeerSilent` "no packet for 3.0 s", also at 120 ms round trip and 1%
  loss; one that leaves (`--quit-at 300`) ends the host with `PeerLeft` 0.05 s
  later.

The delivery time is the turn delay plus how late the receiving frame runs.
Late frames come from the map's own slow frames (Smashcraft's step max was
60–190 ms, at its setup and while warming up) and from packets that arrive
after their frame was due.
