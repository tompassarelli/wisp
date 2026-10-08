# Network and timing model

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
