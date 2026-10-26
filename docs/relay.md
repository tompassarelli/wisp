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
  the running game. On 25 October 2026 Tom approved the same kind of switch
  for players, only as their opt-in to Smashcraft Servers
  (wisp:docs/clean-room.md, "Smashcraft Servers"). On 3.0.1.24371 the
  switch alone doesn't give a LAN provider (wisp#21), so players there reach
  the relay through Smashcraft Servers only after Tom decides the player
  question that follows wisp#21's offline work.

That last fact splits the plan in two:

1. **Build and measure on the pool.** Relay, agent, transport and jitter
   buffer can all be built now and measured natively on 3.0.0.24268 pool
   pairs, which are our own offline test clients.
2. **Reach players.** This needs a route by which an unmodified, signed-in
   live client joins a game the agent hosts. Box R0 found none from outside
   the game on 3.0.1.24371 (Reaching players, below). Players there reach
   the agent through Smashcraft Servers only after Tom decides the player
   question that follows wisp#21 (C3 and Decisions, below).

## Baseline: Wisp's TCP host on a lossy path (box R4)

Status: measured on the laptop's LAN pool on 25 October 2026 (wisp#33). The
gex45 trial of 24 October ran at 75–85% host CPU pressure and is replaced.

What the relay must beat: Wisp's own TCP host reached over an internet-like
path, as FLO's single TCP stream reaches a player. Measured 25 October 2026
on the laptop's pool pair 1 (Warcraft III 3.0.0.24268, offline LAN, 60 fps
cap). Each run had a pool session of its own, started fresh and stopped
with SIGINT, and the run was that session's first match: the standing
5-minute limit on native sessions leaves no room for a throwaway match.

- **Host.** Wisp's deadline-paced LAN host (wisp#30) at
  `--turn-ms 17,17,16`, from wisp 8820f59e.
- **Path.** `wisp lan netem --pair 1 ... --tcp-port PORT` on the port
  `lan fresh` hosts on, applied as soon as the host writes it and before the
  first client joins, so lobby, load and play all cross the impaired path
  and nothing else on the loopback does (wisp:docs/lan.md, "Simulated
  latency and loss"). RTT and loss are round-trip figures; jitter 20 ms
  varies each send by ±10 ms and reorders packets; "bursts" is netem's
  Gilbert model with a mean burst of four sends at the same long-run loss.
- **Map and probe.** Smashcraft's integrity build of 59824cc9b (the R3 map),
  Rifleman quick match, and the turn-rate sweep's probe
  (smashcraft:docs/warcraft-api-netcode-findings.md, "Input sampling against
  the LAN host's turn interval"): `-dev callback-clock 3600` stamps every
  60 Hz callback with `os.clock` and the raw `BlzIsKeyPressed` state of `c`;
  a host-side driver taps `c` on both clients every 280–520 ms for 50–90 ms
  through private-desktop XTEST (seed 7); heavy input adds a random tap of
  `[ ] ; ' t v 1 2` every 30–80 ms. 60 s of callbacks per run: a pool takes
  about 160 s to bring both clients to their menus and the match about 45 s
  to start, so 60 s is what fits in a 5-minute session.
- **Host load.** A run's pool started only with at most 6 live Warcraft
  clients on the laptop and both machine-capacity's
  `protectedCpuSomeAvg10` and the system `/proc/pressure/cpu` some avg10
  under 20. Each row gives the most clients live during the run, the mean
  and peak of `protectedCpuSomeAvg10` and the mean of the system some avg10,
  sampled every second, both values when the probe started, and the other
  laptop pairs whose clients were live then.

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

| Path | Input | Run | Callback gap p50/p99/max ms | Taps seen (a, b) | Press-to-sample spread ms (frames p5–p95) | Rollbacks/min (a, b) | Deepest rollback | Longest stall ms | Host waits (longest ms) | Desyncs | Pace | Callbacks/s | Load avg before–after | Live clients (max) | protectedCpuSomeAvg10 mean (max) | System CPU some avg10 mean | At start: protectedCpuSomeAvg10, /proc/pressure/cpu some avg10 | Other laptop pairs running |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | light | `r0-light` | 20.0/29.0/40 | 138/138, 138/139 | 26, 29 (1, 1) | 248, 243 | 8 | 40 | 0 (0) | 0 | 1.000 | 60.0 | 9.59–8.37 | 2 | 0.0 (max 0.0) | 0.1 | 0.04, 0.32 | none |
| none | heavy | `r0-heavy` | 18.0/29.0/38 | 138/138, 141/141 | 38, 37 (2, 2) | 578, 581 | 12 | 38 | 0 (0) | 0 | 1.000 | 60.0 | 4.71–4.66 | 2 | 0.0 (max 0.0) | 0.1 | 0, 0.18 | none |
| 120 ms, 2% | light | `r120-l2-light` | 17.0/55.0/1791 | 127/138, 127/139 | 77, 57 (1, 2) | 236, 232 | 24 | 1883 | 2 (1151) | 0 | 0.985 | 58.8 | 5.31–5.57 | 2 | 0.0 (max 0.1) | 0.2 | 0.09, 0.40 | none |
| 120 ms, 2% | light | `r120-l2-light-b` | 17.0/77.0/178 | 129/138, 134/139 | 79, 62 (1, 1) | 237, 224 | 24 | 178 | 0 (0) | 0 | 1.000 | 60.0 | 3.79–3.85 | 2 | 0.0 (max 0.0) | 0.2 | 0, 0.20 | none |
| 120 ms, 2% | heavy | `r120-l2-heavy` | 15.0/48.0/179 | 133/138, 134/141 | 57, 79 (2, 2) | 537, 529 | 24 | 215 | 0 (0) | 0 | 1.000 | 60.0 | 5.10–5.29 | 2 | 0.0 (max 0.0) | 0.1 | 0, 0.18 | none |
| 120 ms, 5% | light | `r120-l5-light` | 12.0/147.0/344 | 131/138, 123/139 | 68, 65 (2, 2) | 236, 233 | 24 | 344 | 0 (0) | 0 | 1.000 | 60.0 | 5.94–5.32 | 2 | 0.0 (max 0.0) | 0.1 | 0, 0.20 | none |
| 120 ms, 5% | heavy | `r120-l5-heavy` | 12.0/145.0/542 | 129/138, 122/141 | 89, 66 (2, 2) | 493, 495 | 24 | 542 | 0 (0) | 0 | 1.000 | 60.0 | 5.78–6.98 | 2 | 0.0 (max 0.2) | 0.3 | 0, 0.34 | none |
| 200 ms, 2% | light | `r200-l2-light` | 15.0/58.0/443 | 125/138, 127/139 | 58, 50 (1, 2) | 221, 216 | 24 | 443 | 1 (48) | 0 | 0.999 | 59.9 | 7.94–6.12 | 2 | 0.0 (max 0.0) | 0.3 | 0.02, 0.34 | none |
| 200 ms, 2% | heavy | `r200-l2-heavy` | 13.0/61.0/323 | 123/138, 124/141 | 63, 51 (2, 2) | 495, 500 | 24 | 323 | 0 (0) | 0 | 1.000 | 60.0 | 5.07–5.59 | 2 | 0.0 (max 0.0) | 0.1 | 0, 0.35 | none |
| 200 ms, 5% | light | `r200-l5-light` | 8.0/225.0/596 | 104/138, 108/139 | 77, 64 (2, 3) | 193, 199 | 24 | 596 | 4 (201) | 0 | 0.995 | 59.9 | 4.69–4.47 | 2 | 0.0 (max 0.0) | 0.1 | 0, 0.31 | none |
| 200 ms, 5% | heavy | `r200-l5-heavy` | 10.0/219.0/535 | 113/138, 97/141 | 80, 68 (3, 5) | 388, 396 | 24 | 535 | 2 (100) | 0 | 0.998 | 59.7 | 3.99–7.55 | 2 | 0.3 (max 1.2) | 0.9 | 0, 0.18 | none |
| 120 ms, 2%, jitter 20 ms | light | `r120-l2-j20-light` | 16.0/84.0/357 | 133/138, 129/139 | 78, 52 (1, 1) | 231, 248 | 24 | 357 | 0 (0) | 0 | 1.000 | 60.0 | 5.22–6.53 | 2 | 0.0 (max 0.4) | 0.1 | 0, 0.17 | none |
| 120 ms, 2%, jitter 20 ms | heavy | `r120-l2-j20-heavy` | 14.0/67.0/334 | 129/138, 132/141 | 78, 62 (2, 2) | 535, 523 | 24 | 334 | 0 (0) | 0 | 1.000 | 60.0 | 5.46–5.30 | 2 | 0.0 (max 0.0) | 0.0 | 0, 0.21 | none |
| 120 ms, 2%, bursts | light | `r120-l2-burst-light` | 18.0/35.0/175 | 133/138, 133/139 | 85, 42 (1, 0) | 246, 239 | 22 | 175 | 0 (0) | 0 | 1.000 | 60.0 | 5.42–4.60 | 2 | 0.0 (max 0.0) | 0.1 | 0, 0.18 | none |
| 120 ms, 2%, bursts | heavy | `r120-l2-burst-heavy` | 15.0/53.0/410 | 133/138, 129/141 | 76, 62 (2, 2) | 535, 529 | 24 | 410 | 0 (0) | 0 | 1.000 | 60.0 | 4.92–4.31 | 2 | 0.0 (max 0.0) | 0.1 | 0, 0.18 | none |

Notes:

- **Pool sessions**, start to stop, in seconds (pool ready at, then
  stopped at): `r0-light` 156.3, 272.4; `r0-heavy` 155.2, 270.6;
  `r120-l2-light` 154.5, 270.0; `r120-l2-light-b` 153.4, 268.9;
  `r120-l2-heavy` 154.6, 269.5; `r120-l5-light` 153.5, 268.9;
  `r120-l5-heavy` 155.1, 270.0; `r200-l2-light` 154.2, 270.2;
  `r200-l2-heavy` 155.6, 271.5; `r200-l5-light` 152.4, 267.8;
  `r200-l5-heavy` 154.5, 270.0; `r120-l2-j20-light` 152.5, 268.5;
  `r120-l2-j20-heavy` 152.5, 269.5; `r120-l2-burst-light` 155.1, 270.5;
  `r120-l2-burst-heavy` 153.5, 269.5. The driver cuts a run at 290 s and
  skips one whose pool is ready after 170 s. Two sessions were cut and
  discarded: an 80 s `r0-light` (stopped at 295.0 s), and the first
  `r200-l2-heavy`, whose pool relaunched a client with no window and was
  ready only at 194.2 s (stopped at 295.3 s).
- **`r120-l2-light` stalled on the host's disk, not the path.** Its 1.8 s
  stall and 1151 ms host wait at 71 s sit on the only second of the run
  where `/proc/pressure/io` full rose, to 371 and 255 ms a second against
  about 3 elsewhere, with CPU pressure at 0. `r120-l2-light-b` reran the
  cell: 60.0 callbacks/s, pace 1.000, no host wait.

Output directories are `~/.local/state/wisp-33/laptop-runs/runs/CELL` on
the laptop, one per row (`r120-l2-light` is RTT 120, loss 2%, light input;
`-j20` jitter; `-burst` bursts; `r0-*` no impairment; `-b` a rerun), each
with the callback clocks, the stimulus record, the action log, the netem
setting, the gate record, the pool session's timings and the per-second
host samples.

What the relay must beat, read from the table:

- **Game time held.** Apart from the disk stall above, every cell kept pace
  0.995 or better and both clients at 59.7 callbacks a second or more, with
  no desync. Host waits came only at 200 ms: one of 48 ms at 2% and 2–4 of
  at most 201 ms at 5%. TCP retransmission never put the host behind for
  long.
- **Cadence and taps paid.** Without impairment the p99 callback gap is
  29 ms, the longest single gap 38–40 ms, every probe tap is seen and the
  deepest rollback is 8–12 frames. At 2% loss the p99 gap is 48–77 ms with
  single gaps of 178–443 ms, and 123–134 of 138–141 taps are seen; at 5% it
  is 145–147 ms at 120 ms RTT and 219–225 ms at 200 ms, with single gaps of
  344–596 ms and as few as 97 taps seen. Every impaired run but one reached
  a 24-frame rollback, and the press-to-sample spread widened from 1–2
  frames to up to 5.
- **RTT costs most at 5%.** At 2%, 200 ms sits near 120 ms (p99 58–61 against
  48–77 ms); at 5% it adds about 75 ms to the p99 gap and costs another
  15–30 taps per client.
- **Jitter at 2%** raised the p99 gap to 67–84 ms; **bursts at 2%** cost no
  more than plain 2% (35–53 ms).
- **The yardstick for the relay** (box R9) is the 200 ms, 5% cell, where
  W3Champions claims no lag spikes: a p99 callback gap near 220 ms, single
  gaps near 600 ms and up to 44 taps in 141 lost.

Two findings from the earlier gex45 runs, which do not count
(`~/.local/state/smashcraft/wisp-33/` on gex45):

- **Host load, not the path, made the big stalls.** The same cells taken
  earlier with up to 14 live clients on gex45 gave 18–441 host waits, pace
  0.645–0.976 and stalls of 0.8–6.6 s (`runs-discarded-clients`). Rerun with
  at most 6 clients, the same cells held pace 1.000.
- **Switching loss on mid-match crashed a client.** With netem turned on
  2–3 s before the probe started, client a wrote a crash report (exception
  0xC00000E5) in 2 of 4 lossy runs (`runs-whole-loopback`,
  `runs-tcp-midmatch`). None of the 26 lossy runs with the path impaired from
  the host's start crashed.


## Relay under internet conditions (box R9)

Status: passed on the laptop's LAN pool on 25 October 2026 (wisp#38), once
wisp#56 moved the agent's feed wait onto a high-resolution timer. In the
rerun the agent's feed deviation p99 is 0.066–0.092 ms in every cell against
a 2 ms bar. Every probe tap is seen apart from presses that fall on a stall
of both clients. The light-input spread is at most 1 frame, there are zero
desyncs, and one callback per burst is 100% outside host stalls (Notes).
The heavy burst cell, which met every bar, and the blackout stand from the
first run (Before wisp#56, below).

The same probe as the baseline above, through the relay instead of Wisp's
TCP host: pool pair 0 (Warcraft III 3.0.0.24268, offline LAN, 60 fps cap),
each run in a fresh pool session of its own, started for that run and
stopped with SIGINT.

- **Relay.** `wisp lan relayed MAP --relay-bin DIR --pair 0` at the default
  8 ms turn, relay and agents built from wisp fdaac7e6, which carries
  wisp#56's `ppoll` feed wait (0d60b0d4). The relay binds
  `127.0.0.1:17000 + pair` inside the pair's namespace, so the path is
  `wisp lan netem --pair 0 ... --udp-port 17000`, applied before
  `lan relayed` starts: the agents' relay link crosses the impaired path and
  each client's TCP link to its own agent does not. Every counted run shows
  netem's packet counter rising through the probe (28,576–29,468 packets in
  the jitter cells, 50,350 in the burst cell, in `netem-stats.txt`).
- **Map and probe.** The baseline's: Smashcraft 59824cc9b (`w32-echo.w3x`,
  sha256 26b206e48e3f6b7b…), `-dev quick hero rifleman stocks 9`, then
  `-dev callback-clock 3600`, each sent from client a and confirmed by a new
  `Chat(` line in `relay.log` (every chat landed on its first send), and
  the seed-7 tap driver with light or heavy input. 60 s of callbacks per run,
  to fit the 5-minute session.
- **Cells.** The 8 jitter cells and `r120-l2-burst-light`, the cells that
  missed a bar in the first run.
- **Host load.** Each run started with both `protectedCpuSomeAvg10` and the
  system `/proc/pressure/cpu` some avg10 under 20 and with no other session
  on pair 0, under a quiet native capacity session; a run with any
  per-second reading at 20 or above would have been discarded, and none
  was. `r200-l2-j20-light` ran beside another session's native capture on
  pair 1 (one client, 14 computer players, load average up to 11.4); its
  pressures peaked at 1.36 and 1.75. The other runs had only pair 0's two
  clients.

Columns as in the first run (Before wisp#56), with one change: one callback
per burst treats callbacks under 2.5 ms apart as one burst, since a gap of
about 2 ms is two Smashcraft frames in one 16.7 ms drawn frame whether the
clock reads 1.998 or 2.000 ms (wisp-lead2's ruling of 25 October 2026 on
wisp#38). The first run counted only gaps under 2 ms, and its runs give the
same shares under either rule.

| Path | Input | Run | Feed deviation p99 ms | Underruns | D (turns) | Taps seen (a, b) | Press-to-sample median ms | Spread ms (frames p5–p95) | Rollbacks/min (a, b) | Deepest rollback | Desyncs | One callback per burst | Callback gap p50/p99/max ms | Pace | At start / end: protectedCpuSomeAvg10, system some avg10 | Peak: protected, system | wisp#33 same cell: gap; taps; spread; rollbacks/min; deepest; desyncs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 120 ms, 2%, jitter 20 ms | light | `r120-l2-j20-light` | 0.067, 0.067 | 0, 0 | 5, 5 | 137/138, 138/139 | 9, 9 | 32 (1), 34 (0) | 257, 246 | 18 | 0 | 100.00%, 100.00% | 19.0/33.0/43 | 1.000 | 0, 0.05 / 0, 0.00 | 0, 0.18 | `r120-l2-j20-light`: 16.0/84.0/357; 133/138, 129/139; 78, 52 (1, 1); 231, 248; 24; 0 |
| 120 ms, 2%, jitter 20 ms | heavy | `r120-l2-j20-heavy` | 0.067, 0.066 | 0, 0 | 5, 5 | 138/138, 141/141 | 2, 8 | 43 (2), 37 (2) | 582, 581 | 21 | 0 | 100.00%, 100.00% | 18.0/33.0/48 | 1.000 | 0.02, 1.63 / 0, 0.00 | 0.02, 1.63 | `r120-l2-j20-heavy`: 14.0/67.0/334; 129/138, 132/141; 78, 62 (2, 2); 535, 523; 24; 0 |
| 120 ms, 5%, jitter 20 ms | light | `r120-l5-j20-light` | 0.068, 0.068 | 0, 0 | 5, 5 | 137/138, 138/139 | 9, 10 | 32 (1), 31 (1) | 246, 234 | 17 | 0 | 100.00%, 100.00% | 19.0/33.0/73 | 1.000 | 0, 0.49 / 0, 0.00 | 0, 0.58 | `r120-l5-light`: 12.0/147.0/344; 131/138, 123/139; 68, 65 (2, 2); 236, 233; 24; 0 |
| 120 ms, 5%, jitter 20 ms | heavy | `r120-l5-j20-heavy` | 0.067, 0.068 | 0, 0 | 6, 5 | 138/138, 139/141 | 3, 3 | 44 (2), 45 (2) | 579, 579 | 24 | 0 | 100.00%, 100.00% | 18.0/33.0/153 | 1.000 | 0.02, 0.32 / 0, 0.00 | 0.02, 0.32 | `r120-l5-heavy`: 12.0/145.0/542; 129/138, 122/141; 89, 66 (2, 2); 493, 495; 24; 0 |
| 200 ms, 2%, jitter 20 ms | light | `r200-l2-j20-light` | 0.092, 0.091 | 0, 0 | 5, 5 | 137/138, 138/139 | 6, 6 | 44 (1), 37 (1) | 246, 245 | 21 | 0 | 100.00%, 100.00% | 18.0/33.0/75 | 1.000 | 0.97, 1.08 / 1, 1.02 | 1.36, 1.75 | `r200-l2-light`: 15.0/58.0/443; 125/138, 127/139; 58, 50 (1, 2); 221, 216; 24; 0 |
| 200 ms, 2%, jitter 20 ms | heavy | `r200-l2-j20-heavy` | 0.068, 0.068 | 0, 0 | 5, 5 | 138/138, 140/141 | 2, 7 | 51 (2), 39 (1) | 582, 582 | 24 | 0 | 100.00%, 100.00% | 18.0/33.0/53 | 1.000 | 0.02, 0.25 / 0.02, 0.03 | 0.18, 0.25 | `r200-l2-heavy`: 13.0/61.0/323; 123/138, 124/141; 63, 51 (2, 2); 495, 500; 24; 0 |
| 200 ms, 5%, jitter 20 ms | light | `r200-l5-j20-light` | 0.066, 0.067 | 0, 0 | 5, 5 | 137/138, 138/139 | 8, 9 | 33 (1), 29 (1) | 251, 253 | 21 | 0 | 100.00%, 100.00% | 18.0/33.0/43 | 1.000 | 0, 0.04 / 0, 0.04 | 0, 0.43 | `r200-l5-light`: 8.0/225.0/596; 104/138, 108/139; 77, 64 (2, 3); 193, 199; 24; 0 |
| 200 ms, 5%, jitter 20 ms | heavy | `r200-l5-j20-heavy` | 0.067, 0.067 | 0, 0 | 5, 5 | 138/138, 141/141 | 4, 3 | 72 (2), 48 (3) | 581, 583 | 24 | 0 | 99.86%, 99.86% (100.00% outside host stalls) | 17.0/34.0/185 | 1.000 | 0, 0.07 / 0, 0.15 | 0, 0.28 | `r200-l5-heavy`: 10.0/219.0/535; 113/138, 97/141; 80, 68 (3, 5); 388, 396; 24; 0 |
| 120 ms, 2%, bursts | light | `r120-l2-burst-light` | 0.082, 0.082 | 1, 1 (turn 1068, before the probe) | 4, 4 | 137/138, 138/139 | 8, 9 | 36 (1), 32 (1) | 248, 235 | 17 | 0 | 100.00%, 100.00% | 19.0/33.0/39 | 1.000 | 0, 0.12 / 0, 0.00 | 0.18, 0.22 | `r120-l2-burst-light`: 18.0/35.0/175; 133/138, 133/139; 85, 42 (1, 0); 246, 239; 22; 0 |

Notes:

- **Pool sessions**, start to stop, in seconds (pool ready at, then
  stopped at): `r120-l2-j20-light` 154.7, 276.8; `r120-l2-j20-heavy` 156.4,
  279.7; `r120-l5-j20-light` 155.8, 278.5; `r120-l5-j20-heavy` 154.8, 277.5;
  `r200-l2-j20-light` 157.6, 281.4; `r200-l2-j20-heavy` 159.0, 283.3;
  `r200-l5-j20-light` 152.8, 274.7; `r200-l5-j20-heavy` 154.8, 276.8;
  `r120-l2-burst-light` 154.8, 276.6. The driver cuts a session at 290 s;
  none was cut. Two `r120-l2-j20-heavy` attempts were discarded unmeasured
  (`runs-rerun/discarded`): one pool was interrupted at 100 s, before it was
  ready, and one was stopped mid-session to free the laptop.
- **Feed deviation is off the kernel tick.** With the agent waiting in
  `ppoll` on a nanosecond timeout, the p99 is 0.07–0.09 ms where it was
  2.4–2.9 ms in the jitter cells, and through every probe window (the turns
  from the `-dev callback-clock` chat on) the largest deviation is 0.24–1.47 ms
  on either agent. The exception is `r200-l2-j20-light`, the run beside the
  pair-1 capture: 2 and 3 of about 8,045 feeds there reach 2.8 and 3.1 ms.
- **Host stalls** are stalls that hit both clients at the same game moment
  while both agents fed every probe turn within 1.5 ms of schedule with no
  underrun; they don't count against the relay (wisp-lead2's ruling of
  25 October 2026 on wisp#38). `r200-l5-j20-heavy` has four, at callbacks
  323 (141 ms on both clients), 2149–2150 (185 and 165 ms), 2177 (93 and
  94 ms) and 3468–3469 (136 and 145 ms), with agent feeds in the probe at
  most 0.26 ms (a) and 0.39 ms (b) from schedule, system pressure at most
  0.28 and only pair 0's clients running. Its five short gaps per client
  (1.998 ms, one 2.014 ms; callbacks 343, 2172, 2175, 3493 and 3496 on a,
  343, 2172, 2175, 2187 and 3493 on b) each come 10–27 callbacks after one of
  these stalls, as the client finishes catching up: within 8 ms of where it
  would have run without the stall. Outside these catch-ups every burst holds
  one callback. The first run's doubles in this cell came mid-run with no
  stall near them, and none recurs.
- **Other stalls of both clients cost taps, not bursts.**
  `r120-l5-j20-heavy` stalls both clients at callbacks 1386–1387 (55 and
  63 ms) and 3217–3218 (153 and 145 ms), and client b's presses 50 and 128
  fall on those stalls with no edge in the game, the case the release mark
  cannot reach; its agents fed every probe turn within 1.3 ms. In
  `r200-l2-j20-heavy` both clients slow together for 2.6 s from 28.2 s into
  the probe (gaps of 41–53 ms), and client b's press 67, held 50.7 ms, falls
  on a 41 ms gap there and leaves no down or up edge; the agents fed every
  probe turn within 0.8 ms. `r120-l5-j20-light` (72–73 ms at callback 2072)
  and `r200-l2-j20-light` (54–75 ms at 2474–2475) also stall both clients,
  with no tap or burst lost.
- **Taps.** Apart from those, the one press each light run misses is the
  probe's first press, which its matcher cannot place, as in the first run.
- **The burst cell's underrun** is one turn, 1068, on both agents at once,
  about 8.5 s into the match and before the probe; no turn underran in any
  probe window.

Output directories are `~/.local/state/wisp-38/runs-rerun/CELL` on the
laptop, laid out as the first run's.

What the relay changes, read against the baseline, in both runs:

- **Loss stops reaching the game.** The callback gap p99 is 33–34 ms in
  every cell, the unimpaired baseline's 29 ms plus a few, against 48–84 ms
  at 2% and 145–225 ms at 5% over TCP; the 200 ms, 5% yardstick goes from a
  219–225 ms p99 and single gaps near 600 ms to 33–34 ms, with single gaps
  of 43–53 ms apart from host stalls. No agent underran in a probe window;
  D settled at 4–6 turns (32–48 ms).
- **Taps and spread.** Every probe tap is seen apart from the cases in the
  notes, against 97–134 of 138–141 over TCP; the light-input spread is at
  most 1 frame p5–p95 in every cell, against up to 3 over TCP.
- **Rollbacks match the unimpaired baseline**, about 250 a minute with
  light input and 580 with heavy (baseline `r0`: 243–248 and 578–581),
  where TCP's impaired cells ran 193–248 and 388–537; the deepest is
  17–24 frames.
- **Zero desyncs** and pace 1.000 in every cell.

### Before wisp#56 (first run)

The first run, relay and agents built from wisp f1d01a83, waited for each
feed under `SO_RCVTIMEO`. It ran all 10 cells and the blackout under the
same setup, except that each run started with at most 6 live Warcraft
clients and no other laptop pair. Netem counted 27,000–43,000 packets per
run (7,180 in the blackout run, whose switch resets it), and `tc filter`
matched both ports at 0x4268. Columns as above, with one callback per
burst counting callbacks under 2 ms apart. Not passed then: the agent's feed
deviation p99 was 2.4–2.9 ms in every jitter cell, and three cells fell short
of one callback per burst on every frame (99.92–99.97%).

| Path | Input | Run | Feed deviation p99 ms | Underruns | D (turns) | Taps seen (a, b) | Press-to-sample median ms | Spread ms (frames p5–p95) | Rollbacks/min (a, b) | Deepest rollback | Desyncs | One callback per burst | Callback gap p50/p99/max ms | Pace | At start / end: protectedCpuSomeAvg10, system some avg10 | Peak: protected, system | wisp#33 same cell: gap; taps; spread; rollbacks/min; deepest; desyncs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 120 ms, 2%, jitter 20 ms | light | `r120-l2-j20-light` | 2.72, 2.67 | 0, 0 | 5, 5 | 137/138, 138/139 | 12, 8 | 30 (1), 34 (1) | 249, 242 | 19 | 0 | 100.00%, 100.00% | 19.0/33.0/126 | 1.000 | 0, 0.02 / 0, 0.00 | 0, 0.18 | `r120-l2-j20-light`: 16.0/84.0/357; 133/138, 129/139; 78, 52 (1, 1); 231, 248; 24; 0 |
| 120 ms, 2%, jitter 20 ms | heavy | `r120-l2-j20-heavy` | 2.44, 2.38 | 0, 0 | 5, 5 | 138/138, 140/141 | -1, 4 | 47 (2), 39 (1) | 580, 582 | 21 | 0 | 100.00%, 100.00% | 18.0/33.0/47 | 1.000 | 0, 0.04 / 0, 0.00 | 0, 0.04 | `r120-l2-j20-heavy`: 14.0/67.0/334; 129/138, 132/141; 78, 62 (2, 2); 535, 523; 24; 0 |
| 120 ms, 5%, jitter 20 ms | light | `r120-l5-j20-light` | 2.76, 2.72 | 0, 0 | 6, 5 | 137/138, 138/139 | 10, 11 | 31 (1), 29 (1) | 253, 252 | 17 | 0 | 100.00%, 100.00% | 19.0/34.0/46 | 1.000 | 0, 0.28 / 0, 0.03 | 0, 0.28 | `r120-l5-light`: 12.0/147.0/344; 131/138, 123/139; 68, 65 (2, 2); 236, 233; 24; 0 |
| 120 ms, 5%, jitter 20 ms | heavy | `r120-l5-j20-heavy` | 2.82, 2.77 | 0, 0 | 5, 5 | 138/138, 141/141 | 3, 6 | 39 (2), 43 (2) | 579, 581 | 20 | 0 | 100.00%, 100.00% | 18.0/33.0/42 | 1.000 | 0, 0.06 / 0, 0.00 | 0, 0.06 | `r120-l5-heavy`: 12.0/145.0/542; 129/138, 122/141; 89, 66 (2, 2); 493, 495; 24; 0 |
| 200 ms, 2%, jitter 20 ms | light | `r200-l2-j20-light` | 2.73, 2.69 | 0, 0 | 5, 5 | 137/138, 138/139 | 10, 9 | 35 (1), 31 (1) | 252, 229 | 22 | 0 | 100.00%, 100.00% | 18.0/33.0/42 | 1.000 | 0, 0.06 / 0, 0.18 | 0, 0.19 | `r200-l2-light`: 15.0/58.0/443; 125/138, 127/139; 58, 50 (1, 2); 221, 216; 24; 0 |
| 200 ms, 2%, jitter 20 ms | heavy | `r200-l2-j20-heavy` | 2.47, 2.52 | 0, 0 | 5, 5 | 138/138, 141/141 | 5, 3 | 46 (1), 41 (3) | 578, 580 | 24 | 0 | 99.97%, 100.00% | 18.0/33.0/44 | 1.000 | 0, 0.02 / 0, 0.00 | 0, 0.02 | `r200-l2-heavy`: 13.0/61.0/323; 123/138, 124/141; 63, 51 (2, 2); 495, 500; 24; 0 |
| 200 ms, 5%, jitter 20 ms | light | `r200-l5-j20-light` | 2.73, 2.72 | 0, 0 | 5, 5 | 137/138, 138/139 | 7, 9 | 29 (1), 31 (1) | 255, 237 | 22 | 0 | 100.00%, 100.00% | 19.0/33.0/43 | 1.000 | 0, 0.05 / 0, 0.00 | 0, 0.2 | `r200-l5-light`: 8.0/225.0/596; 104/138, 108/139; 77, 64 (2, 3); 193, 199; 24; 0 |
| 200 ms, 5%, jitter 20 ms | heavy | `r200-l5-j20-heavy` | 2.85, 2.91 | 0, 0 | 5, 6 | 138/138, 141/141 | 5, 4 | 47 (1), 43 (2) | 582, 581 | 24 | 0 | 99.92%, 100.00% | 18.0/33.0/53 | 1.000 | 0, 0.50 / 0, 0.10 | 0, 0.79 | `r200-l5-heavy`: 10.0/219.0/535; 113/138, 97/141; 80, 68 (3, 5); 388, 396; 24; 0 |
| 120 ms, 2%, bursts | light | `r120-l2-burst-light` | 0.62, 0.61 | 0, 0 | 5, 6 | 137/138, 138/139 | 9, 8 | 36 (1), 39 (1) | 247, 246 | 22 | 0 | 99.97%, 99.97% | 18.0/33.0/277 | 1.000 | 0.01, 0.76 / 0.24, 0.60 | 0.68, 1.46 | `r120-l2-burst-light`: 18.0/35.0/175; 133/138, 133/139; 85, 42 (1, 0); 246, 239; 22; 0 |
| 120 ms, 2%, bursts | heavy | `r120-l2-burst-heavy` | 0.44, 0.66 | 0, 0 | 5, 4 | 138/138, 140/141 | 3, 5 | 48 (2), 40 (2) | 579, 582 | 22 | 0 | 100.00%, 100.00% | 18.0/34.0/71 | 1.000 | 0, 0.55 / 0, 0.34 | 0, 0.76 | `r120-l2-burst-heavy`: 15.0/53.0/410; 133/138, 129/141; 76, 62 (2, 2); 535, 529; 24; 0 |

Notes:

- **Pool sessions**, start to stop, in seconds (pool ready at, then
  stopped at): `r120-l2-j20-light` 158.3, 279.3; `r120-l2-j20-heavy` 155.8,
  278.0; `r120-l5-j20-light` 154.7, 277.4; `r120-l5-j20-heavy` 157.8, 279.9;
  `r200-l2-j20-light` 154.7, 277.5; `r200-l2-j20-heavy` 156.3, 280.1;
  `r200-l5-j20-light` 153.8, 276.1; `r200-l5-j20-heavy` 153.8, 276.0;
  `r120-l2-burst-light` 157.4, 280.4; `r120-l2-burst-heavy` 157.4, 280.5;
  `blackout` 156.4, 279.1. The relayed match played 22–25 s after the pool
  was ready. The driver cuts a session at 290 s; none was cut.
- **Five earlier runs are discarded** (`runs/discarded/wrong-setup`): their
  driver sent `-dev setup time 2;quick stage 2 pair rifleman / illidan`
  instead of the baseline's quick match, so stage and fighters differed, and
  under heavy input the match ended 10–30 s into the probe (Smashcraft's
  frame counter stops while callbacks go on), which also produced 8–14%
  double callbacks on the end screen.
- **Feed deviation sits on the kernel's 1 ms tick.** In the jitter cells
  58–86% of an agent's feeds land in the same tenth of a millisecond of
  wall time and deviations cluster at 0, 1 and 2 ms; in the burst cells,
  which have no jitter, p99 is 0.44–0.66 ms. The agent waits for its next
  feed in `recv_from` under `SO_RCVTIMEO` (`relay-agent/src/link.rs`), which
  the kernel counts in jiffies (`CONFIG_HZ=1000` on the laptop): a feed
  that no packet arrival wakes for in time wakes on a later tick. Jittered
  arrivals no longer line up with the feed schedule, so more feeds wait out
  the timeout. Underruns stayed 0 and the clients drew one callback per
  burst through it, so the bar misses on timer resolution, not on turns
  reaching Warcraft late. Under `CONFIG_HZ=250` a timeout under a tick
  sleeps two ticks, 8 ms, so a live agent fed only when a packet came:
  after a 250 ms hold it fed every 8 ms with 210–220 ms of extra delay
  instead of catching up at 4 ms (wisp#53). The agent now waits in
  `ppoll` on a high-resolution timer (wisp#56), and catches up at 4 ms.
- **The short shares** are 4 readings: `r200-l2-j20-heavy` one callback gap
  of 1.998 ms on client a and `r200-l5-j20-heavy` three, each between gaps
  of 17–28 ms (os.clock steps in about 1 ms, so these are 2 ms steps just
  under the burst rule's 2 ms); and in `r120-l2-burst-light` one double per
  client inside the catch-up after a 269–277 ms stall.
- **Both clients stall together at one game moment** in two light cells:
  124–126 ms at callback 2899 in `r120-l2-j20-light` and 269–277 ms at
  callbacks 2998–2999 in `r120-l2-burst-light`. The agents fed every turn on
  schedule through both (no underrun, backlog at most D), and CPU and disk
  pressure stayed flat, so the stall is in the game, not the path.
- **Taps.** The one press each light run misses is the probe's first press,
  which its matcher cannot place (the baseline's client b misses it too).
  `r120-l2-j20-heavy` client b's press 117 shows a down edge at a 1164 ms
  press-to-sample lag, 2 ms under the 1166–1206 ms the run's other presses
  matched at, so the matcher drops a seen tap. `r120-l2-burst-heavy` client
  b's press 105 has no down edge: it falls on a 71 ms stall of that client,
  the case the release mark cannot reach.

Output directories are `~/.local/state/wisp-38/runs/CELL` on the laptop,
each with the callback clocks, the stimulus record, the relayed game folder
(`relay.log`, `agent-{a,b}.log` and `.trace`), the netem setting and
`netem-stats.txt` counters at probe start and end, the gate record, the
pool session's timings and the per-second host samples.

### Blackout

One run (`blackout`, 120 ms RTT with 20 ms jitter and no loss, light input)
switched the relay link to 100% loss 30 s into the probe and back. Each
switch is a `wisp lan netem` call of about 0.33 s, so the link lost
everything for 1.34 s (applied 1792901154.134, restored 1792901155.472,
Unix seconds), longer than the 1 s asked.

- **Drain.** Feeding resumed after a 1221 ms gap on agent a (1203 ms on
  b) with 110 turns waiting. Catch-up fed a turn every 4–5 ms and the
  backlog was back to D + 1 and held there 1358 ms after feeding resumed on
  agent a (D = 4) and 1156 ms on agent b (D = 6), inside the 2 s bound.
  `extra_us` then settles at 5.2 and 6.7 ms, under the catch-up exit of one
  turn plus the floor.
- **Game.** 0 desyncs, one underrun per agent (the outage itself), and one
  relay lag stop; pace over the match fell to 0.9953. Both clients froze
  for up to 1227 ms and lost probe presses 72–74, the three that fell in
  the outage; the light spread stayed at 1 frame.

Agent a's depth trace around the outage, in its link clock (s since the
handshake; the agents' clocks start about 0.24 s apart), per 100 ms: turns
fed, most turns waiting (`backlog`), largest added delay (`extra_us`) and
largest feed deviation, then the first fed lines after the outage
(`fed index wall_us scheduled_us backlog extra_us`):

```
start_s fed max_backlog max_extra_ms dev_max_ms
83.9 13 4 0.0 2.2
84.0 13 10 0.0 2.1
84.1 5 4 0.0 1.1
84.2-85.2 0 (no turn arrives; underrun at 84.127, turn 7234)
85.3 8 110 1213.0 0.0
85.4 21 106 773.0 -2.0
85.5 20 91 709.0 -1.0
85.6 19 84 647.2 -1.5
85.7 20 78 594.2 -2.0
85.8 20 70 536.2 -2.0
85.9 19 62 474.2 -1.2
86.0 19 55 424.2 -1.0
86.1 20 49 372.2 -2.0
86.2 19 42 311.2 -1.0
86.3 20 34 257.6 -1.0
86.4 20 28 200.2 -2.0
86.5 19 20 142.0 -1.2
86.6 20 13 87.2 -2.0
86.7 15 7 26.3 2.0
86.8 13 4 5.2 2.0
86.9 12 4 5.2 1.0
87.0 13 4 5.2 2.0

fed 7233 84119383 84119263 0 0
fed 7234 85340301 85340301 110 1213038
fed 7235 85346383 85348301 109 1211120
fed 7236 85351398 85770521 109 791997
fed 7237 85355401 85359398 108 788000
fed 7238 85360388 85363401 108 784987
```

Agent b's trace (`runs/blackout/depth-b.txt`) has the same shape: 110 turns
at 85.1 s on its clock, 12 by 86.2 s, and 6–7 from 86.3 s on.

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
  two of history fits). The relay can't learn the new address before the
  first up packet from it arrives, and until then it sends to the old
  mapping, which the NAT drops: the agent loses its downstream for about one
  RTT plus one turn. With depth below the RTT that is one underrun, which
  catch-up drains, with no stop or desync. R10 measured it (Where the relay
  runs, below).
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
  `--lobby-ms`). The agent picks its depth at the first packet with a base,
  once it has measured at least one second of packets
  (`depth::min_packets`, 125 at 8 ms); a lobby that ends sooner leaves the
  choice pending until then (TCP fallback, below).
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
and their times, and delivery p50/p99/p99.9.

The grid ran on gex45 on 2026-10-24 in its own `unshare -rn` namespace with
the qdisc `impairCommands` builds for `--udp-port 7457`, jitter 20 ms and
`--match-s 270`, on relay cc7adbb. A cell counts only if
protectedCpuSomeAvg10 and `/proc/pressure/cpu` some avg10, sampled every
10 s, both stay below 20 from start to finish; five attempts above it were
discarded and rerun. Every cell's `min_one_way_ms` equals RTT/2 − 10, and
none underran; each p99 is within 4% of the bench's (70.1, 72.0, 110.1 and
111.9 ms). One discarded 200 ms / 2% attempt, at host pressure 92, underran
once in both agents at the same 179.166 s: a shared host stall, not loss.
Directories are under `~/.local/state/wisp/relay-w36/20261024T221811Z-quiet/`.

| Cell | Depth (a/b) | Max depth | Underruns | Delivery p50/p99/p99.9 | Relay CPU | Max pressure (protected, host) | DIR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 120 ms, 2% per send | 6/5, 48.0 ms | 48.0 ms | 0/0 | 60.8/71.6/77.5 ms | 0.8% | 9.7, 13.6 | `rtt120-loss2-a2` |
| 120 ms, 5% per send | 6/6, 48.0 ms | 48.0 ms | 0/0 | 61.0/74.4/79.7 ms | 0.9% | 9.8, 19.7 | `rtt120-loss5-a2` |
| 200 ms, 2% per send | 5/5, 40.0 ms | 40.0 ms | 0/0 | 100.6/111.1/117.6 ms | 0.7% | 2.5, 3.4 | `rtt200-loss2-a4` |
| 200 ms, 5% per send | 6/6, 48.0 ms | 48.0 ms | 0/0 | 100.9/114.2/119.2 ms | 0.7% | 6.2, 8.5 | `rtt200-loss5-a1` |

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
- **Relay binary (wisp#49).** `relay --bind ADDR` binds TCP on the UDP
  socket's address and port. One thread reads UDP, one accepts TCP, and each
  connection has a reader and a writer thread; all feed one bounded queue
  that the server loop drains, and replies to a TCP player go out on its
  connection. A TCP peer is a different address from a UDP peer on the same
  IP and port, cookie included. Limits are in "Where the relay runs" below;
  `--tcp-idle-ms` sets the idle limit. `relay/tests/tcp.rs` runs the binary
  with one `relay-agent` UDP link and one framed TCP agent for 250 turns
  (same turns in order, each side's actions land once and in order, no
  desync) and checks the ninth connection from one address, an oversized
  frame, a silent connection and a chatty one that holds no room slot are
  each closed.
- **Property test** (`relay-proto/tests/property.rs`): the first 48 of the
  128 scenarios rerun with UDP dropped entirely for every agent (the lobby
  and outages moved 3 s later so the lobby outlasts the fallback). Every
  agent ends on TCP and feeds the same turn sequence byte for byte (each
  fed turn as encoded on the wire), with the checks above. 16 scenarios run
  with every second agent blocked, in one room with UDP agents.
- **TCP depth rule (wisp#47).** Over TCP nothing shows as a missing
  sequence number: a lost segment shows as a stall, a packet whose delay
  jumps more than two turns above the one before it, holding every later
  packet behind it. The agent counts the lobby's stalls and records each
  stall's hold (its delay above the anchor, about one RTT plus three turns).
  The stall rate per packet takes the same upper bound as UDP's loss,
  (stalls + 1 + 2√(stalls + 1)) / (packets + 2). A retransmission is lost
  as often as the original, so k losses in a row hold the stream k times as
  long. At slack S (depth plus margin) the predicted late rate is
  exp(−S / jitter) + Σₖ qᵏ × (share of holds h with k·h > S), k = 1..8,
  where the jitter is the mean delay above the anchor of packets outside
  stalls. With no stall seen the holds are unknown and every stall counts
  as late. The smallest D that meets the bar is chosen, under the same
  100 ms ceiling; UDP's rule is unchanged (the UDP cells of the grid are
  identical).
- **Lobby before the first packet.** A lobby that ends before the agent
  has heard from the relay (an agent still waiting out the 2 s fallback,
  say) used to choose from no packets: too poor, an anchor of 0, and turns
  fed far off schedule for the rest of the match. The agent now keeps the
  choice pending until it has measured `depth::min_packets` (one second of
  turn periods), and the turns already due then drain at 4 ms a turn
  through the catch-up instead of feeding at once. Property tests run rooms
  of UDP agents and of UDP-blocked agents whose lobby ends at 0.
- **Measured** (bench, one hour, 8 ms turns, 24 October 2026). The first
  row is `--grid` as shipped; the others lift the ceiling
  (`--max-depth-ms 400`, and `--margin 0.95`) to measure what the rule needs:

| RTT | Loss | D (A/B), depth | Max depth | Underruns per 10 min (A/B) | Delivery p50/p99/p99.9 | Own echo p50/p99 | Bytes/s down/up |
|---|---|---|---|---|---|---|---|
| 100 ms | UDP blocked, 1% over TCP | 12!/12!, 96.0 ms | 255.2 ms | 732.83/762.00 | 51.9/174.5/229.3 ms | 209.8/333.3 ms | 6459/5797 |
| 100 ms | same, ceiling 400 ms | 33/33, 264.0 ms | 264.0 ms | 0.00/0.00 | 51.9/174.5/229.3 ms | 371.6/493.8 ms | 6459/5797 |
| 100 ms | same, ceiling 400 ms, margin 0.95 | 21/21, 261.7 ms | 261.7 ms | 0.00/0.00 | 51.9/174.5/229.3 ms | 368.2/490.7 ms | 6459/5797 |

- **Why no depth within the ceiling meets the bar.** The bar at 8 ms is
  1.3 × 10⁻⁵ underruns per turn. Below one hold (100 ms RTT + 24 ms ≈
  124 ms) every lost segment stalls the feed once, about p × 125 a second:
  the cell sees the same 733/762 underruns at 96 ms as #41's rule did at
  48 ms. Covering one hold leaves the lost retransmissions, p² per packet,
  7.5 per 10 minutes at 1%; #41's `--margin 0.99` run (140.3 ms, 8.33/8.00)
  measured that. Only depth past two holds, about 250 ms, leaves p³
  (0.08 per 10 minutes), which is what the rule picks with the ceiling
  lifted and meets with 0 underruns. That is 2.5 times the 100 ms ceiling,
  so the ceiling stays and a UDP-blocked player at 1% loss and 100 ms RTT is
  reported too poor at 12 turns (96 ms). The depth bar stays in
  milliseconds (66.7 ms at 5%, proxy 25 October 2026). Bytes include the
  2-byte prefix and are about half UDP's, because nothing is repeated.

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
  granular. C2 checks the feed schedule on Windows and Linux: the Windows
  workflow's relay pacer job feeds 7,500 turns of 8 ms on windows-latest
  and ubuntu-latest and fails on a p99 above 1 ms. The loopback
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
  and the rest must fit the rollback budget. Depth is not cover beside the
  budget: every turn of D adds 8 ms to the age the budget must absorb.
- **Shared budget (25 October 2026).** Smashcraft's rollback budget R is 6
  on Battle.net. Relayed matches get R 7 (smashcraft#240), measured by
  smashcraft#219 on `relayDelivery` with `MEASURED_RELAY`: 8 ms turns, 2 ms
  jitter, 2% loss, D = 4 turns (32 ms) on every link, with D added on each
  message's age after upstream and the turn wait. So R 7 holds for D ≤ 32 ms.
  The relay's depth bar allows up to 66.7 ms, and its bench picks 48–64 ms on
  burst cells, about 2 frames more age at D = 8. smashcraft#240's headless
  box measures D = 4 and D = 8 and records the deepest D where R 7 holds;
  the map uses R 7 only up to that depth. wisp#53's choice for spiky paths
  is judged against the same model.
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
    Over TCP it uses the TCP depth rule instead (TCP fallback, below).
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
  the seeds of the grid's first round trip, `--no-cover` turns burst
  cover off, and `--trace FILE` replays a recorded path instead; see "Recorded
  trace cell", below): two agents, each cell an hour of play (450,000 turns at 8 ms)
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
- **Recorded path traces.** `relay/relay-bench/traces/` holds traces of real
  paths in `relay path trace v1` (wisp:relay/relay-proto/src/trace.rs): a
  header with the turn period and the path's median action-acknowledgement
  RTT, then one line per turn: the one-way delay in microseconds above the
  path's floor of the downstream packet whose newest turn it is, or `-` when
  none arrived. Cover packets share the downstream packet sequence, so the
  recorder keys packets by turn, not by sequence (wisp#39). The floor is a
  line through each 10 s window's smallest delay, which removes the two
  clocks' drift. `relay-synthetic --trace FILE` records one from a
  one-player room; a replay takes the RTT's half as the base one-way delay.
  `gex45-wired-to-nexus-2026-10-25.trace` is gex45's wired path from
  Hetzner (wisp#53): 74,679 packets, none lost, delay above the floor
  p50/p99/max 0.3/2.8/16.4 ms at a 184 ms RTT; its bench cell chose 24 ms
  and had 1 underrun per 10 minutes.
  `laptop-wifi-match-to-nexus-2026-10-26.trace` is the laptop host's own
  arrivals during wisp#39's 10-minute match against gex45 (`--create 2
  --trace`): 74,980 packets, 88 lost, delay above the floor p50/p99/max
  2.8/58.9/236.5 ms at a 43 ms RTT. Replayed with `--raise-headroom-ms 100
  --max-total-depth-ms 100` it has 20.01 underruns per 10 minutes, against
  22 in the live match.

### Recorded trace cell (wisp#45)

Built 25 October 2026: `cargo run --release -p relay-bench -- --trace
traces/laptop-wifi-to-nexus-2026-10-25.trace` (a path relative to the
working directory or to `relay/relay-bench`; under a second) replays
wisp#39's trace of the laptop's Wi-Fi path to Nexus as a cell at 8 ms turns.
`relay-bench` is now the package's default binary, since `relay-native`
made `cargo run -p relay-bench` ambiguous.

- **How the cell uses the trace.** Agent A is the laptop. A packet to or
  from it sent at time t takes the delay of the trace's slot ⌊(t − match start) /
  8 ms⌋, or is lost where the slot is `-`, on top of the RTT's half
  (22.0 ms) each way; the sim's jitter and loss draws are off for it. Slots
  wrap, so the match runs the trace's 74,738 slots (597.9 s) once and the
  20 s lobby replays its last 20 s. Every packet sent within one slot (a
  down packet and any cover packets) takes that slot's delay, so a stall
  lasts the time it lasted on the path, not a number of packets.
- **Upstream.** The trace is downstream only. Upstream replays the same
  trace at the same time, with no offset: a rescan takes the radio off its
  channel both ways at once, so the laptop's actions, acknowledgements and
  checksums stall with its turns. An offset would put upstream stalls
  between downstream ones, which a rescan doesn't do. Upstream delay causes
  no underruns; it moves own echo, the acknowledgements that bound the
  bytes down, and the checksums that can stop the clock. Agent B, the other
  side of #39's match, is the bench's path at the same 44 ms RTT: 2 ms mean
  jitter, no loss.
- **Rescan windows.** The trace doesn't mark them, so the bench finds them
  by shape and period: at least 15 rises above 80 ms, each within 0.5 s of
  the last (3 where a rescan is clipped by the trace's start or end), from
  the first rise until the delay falls below 10 ms. That finds 16 windows,
  at 0.0 (clipped), 37.0, 76.8, … 555.4 and 595.1 s (clipped): median
  39.87 s start to start, 2.7–7.9 s long, 14,407 packets (115.3 s). Nothing
  else meets the rule; the 254.8 ms spike at 20.7 s and the 3 s cluster of
  up to 214 ms at 375–379 s stay in. The second row replays the trace with
  those windows cut out and the rest joined (60,331 slots, 482.6 s). Its
  delay above the floor is p50/p99/p99.9/max 2.7/39.3/112.7/254.8 ms, with
  0.70% of packets more than 48 ms late (#39's 77.3 ms p99 and 1.8% came
  from its own window bounds).
- **Rows.** The bytes column is compared with the bench's independent-loss
  cells at the trace's 44 ms RTT, run for the same 597.9 s with seeds
  `0x5eed_7002`–`7005` (largest 9,774 down and 9,200 up); the trace cells
  take `0x5eed_7000` and `7001`.

| RTT | Loss | D (A/B), depth | Max depth | Underruns per 10 min (A/B) | Catch-up after blackout | Delivery p50/p99/p99.9 | Own echo p50/p99 | Bytes/s down/up | Clock stops | Desync | Bar |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 44 ms | laptop Wi-Fi trace, whole | 5/3, 40.0 ms | 254.1 ms | 661.31/0.00 | – | 25.1/119.6/164.1 ms | 98.8/195.1 ms | 10542/10056 | 0 | none | fail (underruns) |
| 44 ms | laptop Wi-Fi trace, rescans cut | 4/3, 32.0 ms | 254.1 ms | 220.04/0.00 | – | 24.7/60.6/134.6 ms | 90.8/139.6 ms | 10108/9517 | 0 | none | fail (underruns) |

- **Bar.** Both rows miss the underrun bar; depth and bytes meet it. The
  whole trace chose D = 5 (40 ms) and gave the laptop 661 underruns per
  10 minutes, against 580 per 10 minutes (290 in 5) at 48 ms in #39's live
  match. Bytes are 1.08 times down and 1.09 up of the largest 44 ms
  independent-loss cell. With the rescans cut, the lobby chose D = 4
  (32 ms) and the laptop still had 220 underruns per 10 minutes, at 1.03
  times the bytes both ways. B had none in either row; no clock stop, no
  desync.
- **Cause.** Fixing firn#37 leaves the depth rule missing the bar on this
  path. Outside the rescans the trace still crosses 32 ms 291 times per
  10 minutes, 48 ms 121 times, 66.7 ms 58 times and 100 ms 20 times, all
  delay with no loss. No depth up to the bar's 66.7 ms covers spikes that
  pass it 58 times in 10 minutes, so no depth rule can meet the bar here.
  This one did worse: its 20 s lobby showed too few of them and it picked
  32 ms. The trace answers "What the bench can't say": this path's bursts
  are stalls fixed in time, not lost packets. The lobby saw no loss, so the
  agent asked for no cover, and cover wouldn't help, because every copy in
  a slot waits out the same stall. The depth rule is unchanged in this box.

#### Fixed depth and visible stalls (wisp#53, box B1)

`--depth-ms MS` fixes the laptop's (agent A's) depth instead of the depth
rule's choice, rounded to whole 8 ms turns; the D column says `fixed` after
A's turns, and names the rounding when the asked depth isn't a whole number
of turns. B keeps the rule's choice. Without the flag the depth is the
rule's, as above.

Trace tables (not `--grid`, whose output is byte-identical) gain columns
at the end, per agent, counted on the agent's clock between match start and
match end. Box B1b counts them in Warcraft callbacks: the game runs one
callback per 16.7 ms of game time, and each fed 8 ms turn adds 8 ms of game
time, so a callback falls at the feed that carries game time past each
16.7 ms mark. Steady feeding gives callback gaps of 16 and 24 ms. Rates are
per 10 minutes of match.

- **Callback-less frames.** 60 Hz frames drawn with no callback: each
  callback gap, rounded to whole frames, less one.
- **Visible stalls ≥ 1 frame.** Runs of consecutive callback gaps of at
  least 25 ms (1.5 frames), one per run.
- **Visible stalls ≥ 2 frames.** Those runs holding a gap of at least
  41.7 ms (2.5 frames).
- **2× catch-up s.** Time spent feeding at the catch-up gap (4 ms a turn).
- **Double-callback frames.** Callback gaps under 8.3 ms (half a frame).
- **Max turns per poll.** The most turns fed at one instant.
- **Peak lag.** The furthest the agent's game time fell behind the relay's
  clock as the agent reads it (depth included), in ms.
- **Lag events ≥ 2 / ≥ 4 frames.** Runs of fed turns at least one frame
  later than their depth's schedule, counted when the run's peak reaches 2
  or 4 frames (the extra frames the opponent rolls back by).

These measure; no agent behaviour changes. The laptop's columns at 32 and
64 ms (`--trace traces/laptop-wifi-to-nexus-2026-10-25.trace --depth-ms 32`,
then `64`; B, at 3 turns, has none of these, a 24.0 ms peak lag and one turn
a poll), against probe53/model3.awk's estimates (wisp#53):

| D (A/B), depth | Loss | Underruns | Callback-less | Stalls ≥ 1 | Stalls ≥ 2 | 2× s | Double | Per poll | Peak lag ms | Lag ≥ 2 | Lag ≥ 4 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 fixed/3, 32.0 ms | trace, whole | 723.53 | 2163.56 | 619.16 | 566.98 | 38.08 | 3838.41 | 1 | 254.1 | 565.98 | 214.75 |
| 4 fixed/3, 32.0 ms | trace, rescans cut | 220.04 | 243.66 | 109.40 | 52.21 | 4.82 | 405.26 | 1 | 254.1 | 48.48 | 18.65 |
| model3, 32 ms | rescans cut | 213.8 | 247.4 | 115.6 | 49.7 | 4.9 | 396.6 | 1 | 254.8 | 48.5 | 18.6 |
| 8 fixed/3, 64.0 ms | trace, whole | 593.07 | 1031.60 | 553.94 | 283.99 | 18.55 | 1784.23 | 1 | 254.1 | 259.91 | 35.12 |
| 8 fixed/3, 64.0 ms | trace, rescans cut | 54.70 | 95.72 | 33.56 | 23.62 | 1.65 | 150.42 | 1 | 254.1 | 19.89 | 6.22 |
| model3, 64 ms | rescans cut | 57.2 | 93.2 | 32.3 | 21.1 | 1.6 | 152.9 | 1 | 254.8 | 21.1 | 6.2 |

The bench's underruns are within 5% of the model's, and its other columns
within 12%. With the rescans cut, doubling the depth from 32 to 64 ms takes
the laptop from 109 visible stalls and 244 callback-less frames per
10 minutes to 34 and 96; the whole trace still loses 1,032 frames' callbacks
per 10 minutes at 64 ms, most of them in the rescans.

#### Spiky paths (wisp#53)

On a path whose delay spikes pass the depth again and again, the agent
raises its delay (box B3, ruling (a′) on wisp#53). After a second stall
within 60 s (a run of callback gaps of at least 33.3 ms, 2 frames, with
callbacks placed as in box B1b), it marks the path spiky and sets a floor
under its extra delay equal to the raise. Catch-up then stops at one turn
above the floor, and any shortfall below the floor is added 1 ms a turn. The
depth itself never changes, and neither do the turns fed or the game's
steps: only feed times move, which the property
`the_raise_moves_feed_times_but_never_the_fed_turns` checks against the same
packet stream with the raise on and off. The raise is
`AgentConfig::raise_headroom_us` (Smashcraft's headroom, the depth that
keeps `connectionPoor` false), capped so that depth plus raise stays within
`AgentConfig::max_total_depth_us` (100 ms by default), then rounded down to
whole 8 ms steps; the agent computes it when it chooses its depth. Without a
headroom, below 8 ms, or with the depth already within 8 ms of the cap, the
agent marks the path spiky (`AgentStats::spiky`) and doesn't raise. The
bench gives the laptop's agent a headroom with `--raise-headroom-ms MS` and
a total cap with `--max-total-depth-ms MS`; the D column then says `raised`
and the raise.

Gate 49 (2026-10-25) allows adaptive depth up to about 100 ms on paths with
repeated stalls to reach at most 10 visible stalls per 10 minutes, keeps the
clean wired path at its baseline with no raise and keeps the in-match
warning, and drops the slowdown.

**Bar (gate 49).** Per 10 minutes with the Wi-Fi rescans cut: at most
10 visible stalls and at most 100 callback-less frames, at a depth plus
raise of at most 100 ms.

The laptop's rows (`--trace traces/laptop-wifi-to-nexus-2026-10-25.trace`
with `--depth-ms 32`, `--depth-ms 64`, then `--depth-ms 32
--raise-headroom-ms 32`; columns as in box B1b):

| D (A/B), depth | Loss | Underruns | Callback-less | Stalls ≥ 1 | Stalls ≥ 2 | 2× s | Double | Per poll | Peak lag ms | Lag ≥ 2 | Lag ≥ 4 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 fixed/3, 32.0 ms | trace, whole | 723.53 | 2163.56 | 619.16 | 566.98 | 38.08 | 3838.41 | 1 | 254.1 | 565.98 | 214.75 |
| 4 fixed/3, 32.0 ms | trace, rescans cut | 220.04 | 243.66 | 109.40 | 52.21 | 4.82 | 405.26 | 1 | 254.1 | 48.48 | 18.65 |
| 8 fixed/3, 64.0 ms | trace, whole | 593.07 | 1031.60 | 553.94 | 283.99 | 18.55 | 1784.23 | 1 | 254.1 | 259.91 | 35.12 |
| 8 fixed/3, 64.0 ms | trace, rescans cut | 54.70 | 95.72 | 33.56 | 23.62 | 1.65 | 150.42 | 1 | 254.1 | 19.89 | 6.22 |
| 4 fixed raised 32.0 ms/3, 32.0 ms | trace, whole | 593.07 | 1035.62 | 553.94 | 285.00 | 18.58 | 1786.24 | 1 | 254.1 | 259.91 | 36.13 |
| 4 fixed raised 32.0 ms/3, 32.0 ms | trace, rescans cut | 60.91 | 98.21 | 36.05 | 21.13 | 1.71 | 157.88 | 1 | 254.1 | 19.89 | 6.22 |

With the rescans cut the raise fires 3.8 s into the match (the model
said 3.3 s) and holds 32 + 32 = 64 ms from then on. It gives 98.2
callback-less frames per 10 minutes, inside the bar, and 36.1 visible
stalls, 1.1 over it. Fixed at 64 ms from the first turn the laptop has
33.6; the raised row adds the two stalls at 32 ms that detect the path,
2.5 per 10 minutes of this 8-minute trace. In the model the raised row
equals its fixed-64 row (32.3). On the whole trace the rescans still dominate (554 visible
stalls per 10 minutes), as the plan expected. `--grid` is byte-identical,
since no grid agent has a headroom.

The total cap swept on the rescans-cut laptop trace (`--depth-ms 32
--raise-headroom-ms 200 --max-total-depth-ms CAP`, so the cap binds; the
raise is CAP − 32 ms rounded down to 8 ms):

| Cap | D (A/B), depth | Loss | Underruns | Callback-less | Stalls ≥ 1 | Stalls ≥ 2 | 2× s | Double | Per poll | Peak lag ms | Lag ≥ 2 | Lag ≥ 4 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 64 ms | 4 fixed raised 32.0 ms/3, 32.0 ms | trace, rescans cut | 60.91 | 98.21 | 36.05 | 21.13 | 1.71 | 157.88 | 1 | 254.1 | 19.89 | 6.22 |
| 72 ms | 4 fixed raised 40.0 ms/3, 32.0 ms | trace, rescans cut | 54.70 | 79.56 | 29.84 | 17.40 | 1.33 | 124.31 | 1 | 254.1 | 14.92 | 6.22 |
| 80 ms | 4 fixed raised 48.0 ms/3, 32.0 ms | trace, rescans cut | 39.78 | 65.89 | 22.38 | 12.43 | 1.13 | 100.69 | 1 | 254.1 | 9.95 | 4.97 |
| 88 ms | 4 fixed raised 56.0 ms/3, 32.0 ms | trace, rescans cut | 32.32 | 54.70 | 18.65 | 8.70 | 0.92 | 82.05 | 1 | 254.1 | 8.70 | 4.97 |
| 96 ms | 4 fixed raised 64.0 ms/3, 32.0 ms | trace, rescans cut | 24.86 | 46.00 | 13.67 | 8.70 | 0.77 | 69.62 | 1 | 254.1 | 6.22 | 4.97 |
| 100 ms | 4 fixed raised 64.0 ms/3, 32.0 ms | trace, rescans cut | 24.86 | 46.00 | 13.67 | 8.70 | 0.77 | 69.62 | 1 | 254.1 | 6.22 | 4.97 |

Cap 100 ms (`max_total_depth_us` 100_000; the raise is 64 ms after 8 ms
rounding, 96 ms in all) gives 13.67 visible stalls and 46.00 callback-less
frames per 10 minutes. The bar of 10 visible stalls is not met within
100 ms, and gate 49 says to stop at 100 ms and report the number, so the
cap stays there. The plan's model at a fixed 100 ms gave 11.2. The 64 ms
row reproduces the earlier 32 + 32 row. Beyond the gate, 104 and 112 ms
give 11.19 and 12.43 visible stalls and 120 ms would give 9.95, the first
cap under 10, but that is outside the gate. On the clean wired trace
(`traces/gex45-wired-to-nexus-2026-10-25.trace`) with 100 ms of headroom
the agent sees no visible stall and never raises, which
`the_clean_wired_trace_never_raises_with_100_ms_of_headroom` checks.

The raise counts a stall at 2 frames, not at box B1b's 1.5 (wisp#53).
Steady feeding of 8 ms turns gives callback gaps of 16 and 24 ms, so at
25 ms a live agent's 1 ms of feed jitter counted as a stall and could flag
and raise a clean path; 33.3 ms leaves 9.3 ms for jitter.
`feeds_up_to_3_ms_late_on_8_ms_turns_are_no_stall_and_never_raise` feeds a
minute of 8 ms turns up to 3 ms late and checks no stall, flag or raise.
The bench's visible-stall columns keep box B1b's 25 ms definition. Every
row above is unchanged by it: `--grid`, the laptop's raised rows at 32 ms
with 100 ms of headroom (raised 64.0 ms, 13.67 visible stalls and 46.00
callback-less frames per 10 minutes with the rescans cut) and the clean
wired trace (no raise) are byte-identical: in both laptop rows the two
stalls that flag the path are longer than 2 frames, so the raise starts at
the same feed.

Live agents take the same two settings: `relay-agent --raise-headroom-ms MS`
sets `raise_headroom_us` and `--max-total-depth-ms MS` sets
`max_total_depth_us`; without them the agent never raises and keeps the
100 ms cap, as before. `wisp lan relayed --raise-headroom-ms MS` passes the
headroom to both agents (off by default). The agent's summary line ends
`spiky BOOL stalls N raise_ms MS` (`AgentStats::spiky`, `visible_stalls`,
the stalls of 2 frames the raise counts, and the raise in ms), and its trace
gets `spiky at_us` when the path is flagged and `raise R_us at_us` when the
floor first rises (see "Lobby and game on the agent").
`relay-agent/tests/spiky.rs` holds a loopback relay's packets back twice
within 60 s and checks both: with 100 ms of headroom the agent reports
`spiky true`, the stalls and a raise, and traces it; without a headroom it
reports the stalls but `raise_ms 0.0`. Run 20 times, four at once, with no
holds and 100 ms of headroom, each agent reports the stalls of 2 frames that
its own fed turns in its trace hold, and `spiky false` and `raise_ms 0.0`
whenever they are fewer than two, so a pause of the test machine is not
taken for a wrong flag. After one 250 ms hold, with no headroom, each feed
until the extra delay is back within a turn of its value before the hold
comes at least 4 ms after the last and lowers the extra delay by exactly how
far it ran ahead of schedule, the catch-up rule, and the extra delay is back
within 2 s. The in-match warning stays the map's job, but the map reads
nothing yet: no carrier reaches a map (wisp#54).

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
- **No relay mark.** A relayed match is not distinguishable by the map:
  every turn carries only the actions its players sent. wisp#52 led the
  first turn with a `BlzSendSyncData` action so a map could tell a relayed
  match from Battle.net (smashcraft#240), but native runs (gex45, 25 October
  2026, wisp#37 and wisp#54) showed no carrier a map can read without
  changing what players see. A changed copy of a player's own action drops
  that player, an opponent's id desyncs, and an id no player holds never
  reaches the map. On gate 48 the decision was neither carrier: Smashcraft
  keeps rollback budget 6 for every match and parks smashcraft#240, so the
  mark was removed (wisp#54).
- **Conformance.** host.ts's `onPacket` hook records a pool session's bytes.
  The agent must produce the same lobby bytes for the same room. That
  transcript test keeps the two hosts from drifting.
- **Expected map.** `HostConfig::expect_map_sha1` lets an embedder such as
  smashcraft-client (smashcraft-client#26) name the map SHA-1 its player
  has. When the room's facts arrive with a different SHA-1, the AgentHost
  leaves the room and `run` returns an `InvalidData` error naming both
  SHA-1s in hex, before the game sees the room, so no countdown starts. The
  relay does not let a joiner leave and rejoin a slot, so the check belongs
  in the agent, not before it. `None` (the binary's choice) skips the check.
- **Stop per host.** `AgentHost::stop_handle` returns a `StopHandle` that
  stops that host's `run` alone; `run` also stops on the process-wide
  SIGINT/SIGTERM flag, which the binary keeps using. Several AgentHosts in
  one process can then be cancelled one at a time.

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
  `--raise-headroom-ms MS` passes the spiky-path raise to both agents (off
  by default; see "Spiky paths (wisp#53)").
- `relay-agent --raise-headroom-ms MS` and `--max-total-depth-ms MS` set
  the agent's raise headroom and its cap on depth plus raise (no raise and
  100 ms when absent). The `agent summary:` line is `turns N underruns N
  depth D releases N spiky BOOL stalls N raise_ms MS`; the first four fields
  keep their order, so older parsers still read them.
- `relay-agent --trace FILE` (off by default) writes the jitter buffer's
  timeline, one line per event in the agent's link clock (µs since the
  handshake): `fed index wall_us scheduled_us backlog extra_us` per fed turn
  (`scheduled_us` is `Agent::scheduled(index)` as it was fed, `backlog` the
  turns already received behind it, `extra_us` the added delay after
  settling), `depth D at_us` when D (turns) is chosen, and
  `underrun index at_us` per underrun, `spiky at_us` once when the path is
  flagged spiky and `raise R_us at_us` once when the floor first rises. It
  is buffered and flushed at least
  once a second and on exit. SIGINT and SIGTERM stop the agent's loop, so it
  still leaves the room, flushes the trace and prints its `agent summary:`
  line. `wisp lan relayed` writes `agent-<side>.trace` beside each
  `agent-<side>.log` (wisp#38).

## Where the relay runs, NAT, and who can join (boxes R10, C1)

- **Host.** One relay on a public address. Nexus, the always-on server, is
  recommended. gex45 runs the native pool, whose load would show up as relay
  jitter, so it keeps the test relays inside pool namespaces. Opening a public
  UDP port on either server widens access, so R10 asks Tom first; he approved
  Nexus's on 25 October 2026. A second region waits until measured player
  RTTs call for one.
- **Ports.** The relay binary listens on two ports at its `--bind` address:
  UDP 7457, the default, and TCP 7457 for the agent's fallback (Transport,
  above). The public relay on Nexus runs as a sandboxed systemd service: a
  dynamic user, a read-only filesystem, no capabilities, and a socket bind
  allowed only on UDP 7457, which is the one port its firewall rule opens.
  TCP 7457 is the second port; it is a separate opening, so the service's
  `SocketBindAllow=tcp:7457` and the firewall rules for it wait on their own
  approval after a security review of the listener (tompassarelli/wisp#49),
  and until then the fallback cannot reach the public relay. The TCP
  listener holds at most 8 connections per address (per /64 for IPv6) and
  256 in all, counted from accept, refuses a frame over 1200 bytes, closes a
  connection that sends no frame for 15 s or holds no room slot 15 s after
  opening, and drops one that falls 128 packets behind. TCP events take at
  most half of the shared queue and are dropped beyond it, so a TCP flood
  never stalls the UDP reader.
- **NAT.** Every agent sends first, to the relay's public address, so no hole
  punching, STUN or port forwarding is needed. CGNAT works. Traffic every
  turn period keeps NAT mappings open; in the lobby the agent sends at least
  once a second. A network that blocks UDP reaches the relay over TCP on the
  same port (Transport, above).
- **Measured through the public relay (wisp#39, 25 October 2026).** Nexus ran
  the relay at wisp d56c10cf; both agents were `relay-synthetic` built from
  ecc7dccb (sha256 d2a5a9a6…e05c2), the laptop on home Wi-Fi behind its NAT
  and gex45 in Hetzner's network. In a 5-minute match the laptop measured a
  38 ms handshake round trip and action acknowledgements at p50/p99
  45/154 ms, chose depth 6 turns (48 ms) and had 290 underruns; gex45
  measured 185/195 ms, chose 2 turns and had 2, neither near one of its own
  late wakes. The laptop's port change at 150 s cost one underrun: its
  downstream went silent for 57 ms (one RTT plus a turn) and the first
  Challenge and Verify restored it with no stop or desync. A capture on the
  laptop showed the relay sending a handshake's unverified address 11 bytes
  for 20, and the rebound port 1204 bytes for 1339 before its Verify landed
  (at most 1.48× when counting only up packets sent a round trip before
  each reply).
- **The laptop's Wi-Fi path.** A 10-minute one-player trace
  (`relay/relay-bench/traces/laptop-wifi-to-nexus-2026-10-25.trace`) lost
  none of 74,738 packets, but its delay above the floor was p50/p99/max
  3.1/98.4/254.8 ms. The desktop bar ran `nmcli dev wifi` every 40 s, which
  starts a 7.8 s rescan when the last is over 30 s old; during a rescan the
  radio leaves the channel for about 100 ms every 210 ms. 89% of the match
  host's underruns and 83% of the trace agent's fell inside those rescans.
  Outside them the trace was p50/p99 2.7/77.3 ms, with 1.8% of packets
  more than 48 ms late. Real bursts on this path are fixed-time stalls with
  no loss, which no depth under the 100 ms ceiling covers (Protocol core and
  bench, "What the bench can't say").
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
  place. Smashcraft Servers is that kind of switch, allowed only as the
  player's opt-in (wisp:docs/clean-room.md, "Smashcraft Servers").

So no route from outside the game reaches a 127.0.0.1 host on 3.0.1.24371.
On that build the switch alone doesn't give a LAN provider (wisp#21), so
players reach the relay through Smashcraft Servers only after Tom decides
the player question that follows wisp#21's offline work (Decisions, below). R0
is rerun when a new live build ships, since a route from outside would need
no switch.

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
  is (wisp#33); measured on the laptop pool in Baseline, above.
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
- **C3** Smashcraft Servers: the opt-in LAN switch beside Battle.net,
  unavailable on unchecked builds, tested end to end on the spare signed-in
  account before players see it (smashcraft-client#28). Players on
  3.0.1.24371 get Smashcraft Servers only after Tom decides the player
  question that follows wisp#21.

Order: R0, R1, R5 and R6 start now. R2 and R3 follow R1; R4 follows R1 and
R5; R7 follows R5 and R6; R8 follows R1 and R6; R9 follows R3, R4, R7 and
R8; R10 follows R7 and Tom's approval of the port; R11 follows R6; S1 follows
R11; C3 follows wisp#21, the scan that locates the LAN provider on
3.0.1.24371 on offline pool clients; C1 follows R8, R10 and C3; C2 follows
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

- **Players on the live build (Tom, 25 October 2026).** Without an R0
  route, the relay reached only our 3.0.0.24268 pool, and gate 41 asked what
  players get. Weighing W3Champions' years of running the same kind of
  in-game LAN switch for most active Reforged players without known bans,
  Tom approved shipping it to players as an opt-in named Smashcraft Servers,
  beside Battle.net, whose opt-in text says Smashcraft changes how Warcraft
  connects while it runs and that Blizzard has not approved it. He also
  approved scanning the live build, 3.0.1.24371, on our own offline pool
  clients to locate its LAN provider (gate 38, wisp#21). The limits are in
  wisp:docs/clean-room.md, "Smashcraft Servers". C3 and then C1
  can now proceed.
- **Players on 3.0.1.24371 (Tom, open).** On that build the switch alone
  doesn't give a LAN provider (wisp#21), and wisp:docs/clean-room.md allows
  writing one only on our own offline test clients. Players there reach the
  relay through Smashcraft Servers only after Tom decides the player
  question that follows wisp#21's offline work.
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
