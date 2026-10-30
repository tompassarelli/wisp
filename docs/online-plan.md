# Online play on Wisp (plan)

Status: planned, 30 October 2026, and revised once after an adversarial
review. This page plans only; each box at the end is its own issue.

Online Smashcraft runs in Wisp's own window (`wisp play --standalone`, with
art read from each player's Warcraft install), not on Battle.net and not
through an in-game LAN switch. Tom set this direction on 30 October 2026, for
reasons recorded in earlier decisions:

- Battle.net's 25 ms turns set an input-delay floor and add rollback depth
  (wisp:docs/relay.md, "What decides the design").
- Battle.net offers no ladder, no server placement and no ping correction.
- The in-game route stalled because writing a LAN provider into the running
  3.0.1 game was blocked (wisp#21).

He also asked for the rollback to live in Wisp, which reverses the
26 October call that Smashcraft keeps its own copy.

The plan has four parts, in order:

1. Smashcraft's netcode moves onto Wisp's.
2. Smashcraft plays online in the standalone window at parity with the
   Warcraft build.
3. Standalone play goes through Wisp's relay, with a region the player picks.
4. A ladder stub.

## What exists

- **Wisp's rollback core** (wisp:src/netcode/, wisp:docs/netcode.md), lifted
  from Battlecraft on 29 October (wisp#73). It has these modules:
  - `RowCodec`, `frameRing` and the input ledger;
  - batched delta messages and wire varints;
  - `session`, which predicts, rolls back and confirms.

  `Simulation.step(state, rows)` returns a new state and must not change the
  old one. The session keeps 128 of those states to roll back to. It admits
  a row against its own confirmed frame (`acceptRows`, a ledger of 256
  frames). It finds a misprediction by comparing each arriving row with the
  row it ran (`receive`). Battlecraft's `main.ts` and `rollback.tests.ts` use
  it.
- **Smashcraft's own netcode**, in smashcraft:ts/src/game/netcode/: 1754
  lines with the companion journal. Its parts:
  - `InputLedger`, which admits against the common frontier K and has epochs,
    a participant mask, retained history (64 + 2 × 128 frames),
    `discardThrough`, `takeLowestAccepted` and the receipts `wrongEpoch` and
    `storageFull`;
  - `FrameRing`, with `vacant`, `release` and `clear`;
  - `Capture` results;
  - `FixedInputSchedule`, which is lockstep;
  - `ShadowInputSchedule`, which keeps a speculative cursor and a confirmed
    cursor, with `captureLocalAt` and `rewindSpeculative`;
  - `delayPolicy` and `machineRate`;
  - the journal transport (editbox, carrier keys, companion files).

  Its world is mutable. Speculative and confirmed play run in two worlds.
  A late row is found by `takeLowestAccepted` together with reconciliation
  against the accepted-packet count (`ShadowInputPlayback`), and a
  correction restores a replay snapshot (smashcraft:ts/src/game/replay/). It
  can also repair only the fighters a late row touched (`scopedRepair`). The
  loop that drives all of this is smashcraft:ts/src/host/loop/rollback.ts
  and netDelay.ts.
- **Both games pin Wisp.** Each installs Wisp from a vendored tarball:
  Smashcraft at 1cbe2513 (smashcraft:ts/package.json, refreshed with
  `bun run update:wisp`) and Battlecraft at 1684927e (battlecraft:wisp.lock).
  A Wisp change reaches a game only when that game bumps its pin.
- **Standalone host and join** (wisp:docs/play.md, "Host and join";
  wisp:docs/network-model.md, "Wisp's transport"). These work over UDP on a
  LAN or to a forwarded port, with no relay and no hole punching.
  - It plays two slots only: the host is slot 0 and the joiner slot 1
    (wisp:host/net/peer.ts). The socket takes a peer by address and port,
    and the ledger has a single remote.
  - The transport is lockstep with one turn per frame. Its turn delay comes
    from eight pings at the start: d = ceil((RTT/2 + 4 ms) / 16.7 ms). It
    stays fixed for the match.
  - Each datagram is JSON. A `turns` packet repeats every turn since the
    peer's last acknowledgement, along with four checksums.
  - The map's own rollback runs on top. Local input reaches the map on the
    next frame (wisp#112). Smashcraft's own RTT estimate comes from the echo
    of its own sync rows (netDelay.ts), not from peer.ts's pings.

  Smashcraft already plays this way: `play --standalone --host/--join`,
  `net pair` and `net-accept`. The last runs 20 three-stock matches at 0, 60
  and 120 ms with 1% loss. It fails on a missed result, any checksum
  mismatch or a p99 rollback depth past the window
  (smashcraft:docs/commands/play.md).
- **Wisp's relay** (wisp:docs/relay.md, wisp:relay/). It is Rust, built for
  Warcraft turns: it clocks turns and feeds the agent's W3GS host. Its
  packets are at most 1200 bytes (relay-proto `MAX_PACKET`). It is deployed
  on Nexus, which is DigitalOcean sgp1 in Singapore
  (south:agents/decisions/infra/nexus-plan.md), on UDP 7457; its TCP
  fallback is not public yet (wisp#49). Its address handshake (Challenge,
  Verify), codes and abuse limits are reusable. Its room is tied to the turn
  clock (relay:src/room.rs, game_room.rs), so a room without a clock is new
  code.

## 1. Smashcraft's netcode on Wisp's core

**Gain.** One rollback core for every Wisp game. Smashcraft's fixes, such as
its ledger's common future limit (#60) and the echo stall (#233), reach
Battlecraft, and the ping-based delay becomes something any game opts into.
**Cost.** Four boxes, about 1000 lines moved, and two pin bumps per game. The
risk is in one place: Wisp's `session` gets rebuilt over the schedule layer.
That changes Battlecraft's admission at the edges, and Battlecraft's native
proof (battlecraft#3) then holds only through its tests and its golden.

### Why the session doesn't fit Smashcraft as it is

Wisp's `session` owns the stepping and keeps immutable states. Smashcraft
can't take that over without keeping a whole copy of its world for every
frame. Today it changes one world in place and restores a snapshot only when
a correction comes. The same goes for its two-world design and its scoped
repair. The generic part of Smashcraft's netcode is the layer below the
stepping: the ledger plus the speculative/confirmed cursor schedule. That
layer moves into Wisp. Wisp's `session` is rebuilt as a thin driver over it
for games with immutable state (Battlecraft), so both games share one
admission and prediction core.

### Generic (moves into wisp:src/netcode/)

- **`ledger`**: Smashcraft's admission rules made generic over `RowCodec`.
  That means admission against K, epochs, a participant mask, retained
  history with `discardThrough`, `takeLowestAccepted` and the receipts
  `wrongEpoch` and `storageFull`. Wisp's `leave`/`goneAfter` stays. A packet
  of N rows is all or nothing.
- **`frameRing`**: Wisp's functional ring gains `vacant`, `release` and
  `clear`; Smashcraft's class goes.
- **`schedule`**: `Capture`, `FixedInputSchedule` and `ShadowInputSchedule`
  written over `RowCodec`. That covers capture and `captureLocalAt`, both
  cursors, `rewindSpeculative`, `remoteThrough`/`othersThrough`,
  `awaitedSlots` and `mayAdvanceSpeculative` with its future-limit check
  (#233). Prediction calls `RowCodec.hold`, which is Smashcraft's
  `predictInto`. The bound `REPLAY_MAX_CORRECTION_FRAMES` (24) becomes a
  schedule setting, and `REPLAY_HISTORY_CAPACITY` (64) becomes the history
  length.
- **Late-row detection**: `takeLowestAccepted` becomes the one way the
  schedule reports the first frame a sender's new rows touch. Wisp's
  `session` and Smashcraft's playback both compare from there.
- **`delay`**: these move from `delayPolicy` with their integer-only rule:
  - the RTT estimate (an EWMA in eighths);
  - `oneWayFrames` (RTT × 0.03, rounded up);
  - `autoDelay` (one-way frames minus the rollback budget, clamped);
  - `nextDelay`'s lowering hysteresis (34 ms);
  - `agreedDelay` (the highest request), with manual override;
  - `correctDelay` (raised after 3 errored seconds in 5, lowered after 30
    clean ones);
  - `timeSyncWait`.

  Its tests move with it.
- **`rate`**: `machineRate`'s slow-machine detection (under 55 fps with at
  least 750 ms busy, sustained for 2 s). The player-facing text stays in
  Smashcraft.
- **`session`**: rebuilt over `schedule`. It keeps today's API (`tick`,
  `receive`, `leave`, `NET_SETTINGS`).

### Smashcraft-only (stays in smashcraft)

- `InputRow`, its codec, `participants` and the packet wire in
  smashcraft:ts/src/game/input/wire.ts. These are fighter rows with analog
  axes, SDI and throw fields. The row's codec becomes a `RowCodec<InputRow>`.
- `ReplayHistory`, `ShadowInputPlayback`, snapshots, `scopedRepair` and
  `fourFighterRollback`. These are the stepping and repair that sit on
  Wisp's schedule.
- The journal transport: editbox, carrier keys and the companion journal's
  files. They are Warcraft and smashcraft-client protocol.
- netDelay.ts's HUD, its `SC_DY` proposal messages and the host's manual
  delay. These are UI and message names on top of Wisp's `delay`.
- `InputBatch` (1–2 row packets) for now. Moving to Wisp's 64-frame
  messages is a wire change, so it waits for its own measured box (Deferred,
  below).

### Migration with no behaviour change for Smashcraft

1. **N1, golden records first, on main before any move.** Two kinds:
   - **A packet-level golden** for each game drives its ledger and schedule
     (Smashcraft) or session (Battlecraft) through seeded sequences. The
     sequences include in-order, late, duplicate and conflicting rows, rows
     past the future limit and out of history, epoch changes, a leave, and a
     prediction window held long enough to hit #233's stall. For every
     input it records the receipt, the Capture result, the cursors, K,
     held/stall counts and the first late frame.
   - **A match golden** builds on smashcraft:ts/test/online-rollback.test.ts,
     which runs two headless clients with Battle.net-measured delivery and
     no loss. It adds seeded 1% loss and a four-human case, and records
     every 60th frame's confirmed checksum and each rollback's from-frame
     and depth.

   Each golden test runs its seeds in Bun and in 32-bit Lua and fails on any
   difference between them or from the committed fixture.
2. **N2.** Wisp gains `ledger`, `frameRing` and `schedule` as above, and
   `session` is rebuilt on them. Battlecraft bumps its pin and adopts
   K-based admission. Its packet golden changes at the edges and is
   re-recorded in its own commit with the reason. Its match golden's
   confirmed checksums must not change.
3. **N3.** `delay` and `rate` move to Wisp. Smashcraft bumps its pin and
   imports them, and both of its goldens are unchanged.
4. **N4.** Smashcraft bumps its pin, deletes
   `game/netcode/{ledger,frameRing,capture,fixedSchedule,shadowSchedule}.ts`
   and imports Wisp's. Both goldens must match byte for byte, and
   net-accept must still pass.

   "No behaviour change" means Smashcraft's fixtures are unchanged. A
   deliberate change re-records a fixture in its own commit, with the
   reason.

## 2. Smashcraft online in the standalone window

**Gain.** Players play online without Battle.net. That is what parts 3 and
4 are for. **Cost.** Five boxes. Most of the work is an audit, a peer.ts
rewrite for four players, and the player build; the window itself and
two-player online play already exist.

### Gaps against the Warcraft build

Measured facts first, then the parts the audit must settle:

- **Players.** The transport plays two slots. Smashcraft online in Warcraft
  plays up to four humans. Four needs a peer.ts rewrite (P4):
  - a handshake with every peer;
  - a turn delay set from the largest round trip;
  - one ledger remote per peer;
  - packets told apart by member rather than by port.

  It follows the relay link, because a relay room is the natural hub.
- **Getting it.** The window runs from a source checkout. It needs Bun,
  Chrome and Smashcraft's private asset store. Players have none of these.
  - Map imports should come from the Hive map file the player already
    downloads. Stock art should come from their Warcraft install (P3).
  - `runStandalone` refuses to open Chrome without a GPU lease
    (`requireGpuLease`, wisp:host/play/standalone.ts). That is a development
    guard, and a player build must run without it.
  - Shipping a player build is Tom's call (P5).
- **The window.** The standalone window becomes a native Rust program in place
  of Chrome, because Chrome can add one to two frames of input lag (Tom,
  30 October 2026). Its plan and boxes W1 to W9 are
  [native-window-plan.md](native-window-plan.md); the player build (P5) ships
  that window, not Chrome.
- **Simulation.** It must match the Warcraft build exactly. The native corpus
  (smashcraft:docs/commands/parity.md) already holds native replays whose
  frames carry fighter digests, and `parity corpus` replays them in Bun and
  Lua32. The standalone window's own path is not covered yet: its pad and
  input feed, and the presentation profile. Scripts default to `native`
  presentation, but live play defaults to `pool-predicted`
  (smashcraft:docs/play.md). P2 compares a standalone run's digests with a
  native corpus recording of the same pad, under both profiles.
- **Rendering, menus, sound and input.** These are judged by the audit (P1),
  surface by surface, with Wisp's existing checks:
  - Rendering, through `wisp fidelity check` levers on paired captures
    (wisp:docs/fidelity.md).
  - Sound, through each run's audio events and missing-sound count in
    `standalone.json` against the native audio events
    (wisp:docs/audio.md).
  - Menus and HUD, through the map's declared frames on both sides
    (wisp:docs/ui.md). Today a standalone pair meets at fighter selection
    with no Warcraft lobby.
  - Input, through net-accept's press accounting. No press may be lost or
    extra, and press to view must stay within 3 ticks.
  - Frame time, through `net-accept --four-fighters` (p95 at most 16.7 ms
    in both windows).

  P1 writes one line per surface: what differs, the check that shows it, and
  either a box to fix it or a reason it stays.

## 3. Standalone play through the relay, by region

**Gain.** A join works through any NAT, CGNAT included, with no port
forward, which the direct join can't do. A region list replaces guesswork
about where to host. **Cost.** Five boxes in Wisp and Smashcraft, plus a
second server that Tom decides on.

### Shape

The relay gains a **peer room**: a room kind beside the game room, with no
turn clock. Its members are 2 to 4 standalone clients that have passed the
relay's existing address handshake. The relay forwards each member's
datagram, unchanged, to the other members, so it adds only its forwarding
time. The existing limits apply: per address, per room, and at most
1200 bytes per packet.

peer.ts's socket becomes a `Link` with two implementations:
- direct, as today;
- relayed, which speaks the relay's control messages (Create, Join,
  Challenge, Verify with its cookie, Leave, Refused) and wraps each datagram
  in the peer-room frame.

The relay protocol stays in relay-proto (Rust). The Bun side carries a
TypeScript codec of those messages. A shared test-vector file, checked by
both `cargo test` and `bun test`, keeps the two byte-identical.

- **Packets under the cap.** Today's JSON `turns` packet repeats every
  unacknowledged turn. At about 170 ms the turn delay is 6 frames and a turn
  waits about 10 more frames for its acknowledgement, so about 16 turns are
  in flight. As JSON that is about 2 KB, over the 1200-byte cap and over a
  typical path MTU. The relayed link therefore needs a compact binary
  encoding of `turns`, with the in-flight turns capped so a packet stays
  under 1200 bytes. L2 builds it, and the direct link uses it too.
- **Codes.** `--host --relay REGION` asks the relay for a room and prints a
  code that names the region and the room. `--join CODE` reaches it the same
  way. The direct code stays for LAN play.
- **Regions.** A published list of relay addresses. Before hosting, the
  window pings each one and shows the host its round trip; the host picks a
  region, and the nearest is the default. The joiner sees its own ping to
  that region before joining.
- **Delay from measured ping.** peer.ts's eight pings run end to end, so
  through a relay they measure the relayed path, and the transport's turn
  delay follows from them. Smashcraft's map today estimates RTT from the
  echo of its own sync rows, and under the lockstep link that echo is a
  whole number of turns, so it can only see d. L3 hands peer.ts's measured
  RTT to the map, and Wisp's `delay` sets the map's delay from it. Both
  delays are shown before the match.
- **NAT.** Each client sends to the relay first, so the relay's existing NAT
  rules cover it. Packets every frame keep the mapping open
  (wisp:docs/relay.md, "Where the relay runs"). A network that blocks UDP
  can't play until the relay's TCP fallback is public (wisp#49).

### What a region buys, measured

A relay can't beat the direct backbone path between two players. Placed on
that path it adds almost nothing; placed off it, it adds the detour. Hats
Network's August 2026 ICMP rounds give these round trips:
- Los Angeles to Singapore: 168 ms;
- Los Angeles to Tokyo: 101 ms;
- Tokyo to Singapore: 69 ms.

So a US player and a Singapore host meet at about 170 ms through Tokyo, about
170 ms through Singapore (Nexus) and about 170 ms through a US-West relay. A
Tokyo region doesn't halve that pair's round trip. The pair that pays is a
match between two US players. Through Nexus it detours to Singapore at about
2 × 168 ≈ 340 ms; through a US-West relay it stays near their own distance.
That match drops by more than half.

The region list therefore starts with Nexus, which serves Asia-Pacific and
US-to-Asia matches at no added cost. A US-West relay comes second (L5), once there are US-to-US matches. An
EU relay comes after that, when measured players call for one. A player's
own consumer route can be worse than the backbone path, and L4's real-path
run measures how often that happens.

At about 170 ms, Smashcraft's policy gives one-way 6 frames. Minus the
rollback budget of 4 that leaves 2, which is the floor delay of 2 frames.
The remaining 4 frames are rollback, which equals the budget.

### Server price (cost: Tom decides)

Prices are from Hetzner's public pages as fetched on 30 October 2026, and
exclude VAT. The page marks every plan "currently unavailable", so ordering
may wait.

- **US West (Hillsboro)**: CPX11, 2 vCPU and 2 GB, €17.99 a month with 1 TB
  of traffic; more traffic is €1.00 per TB
  (hetzner.com/cloud/regular-performance). Hetzner sells its cheaper CPX02
  only in the EU and Singapore.
- **EU (Falkenstein, Nuremberg or Helsinki)**: CPX02, 1 vCPU and 1 GB,
  €6.49 a month with 20 TB (same page).
- **A second Asia-Pacific relay, if ever needed**: CPX02 in Singapore,
  1 vCPU and 1 GB, €7.99 a month with 0.5 TB; more traffic is €7.40 per TB
  (same page).
- **Tokyo**: Hetzner has no location there. Vultr's $5-a-month plan carried
  400 GB in Tokyo from July 2024 (blogs.vultr.com, "More bandwidth in
  Australia and Japan"). Its pricing page refused the fetch, so recheck the
  price before any order.

Traffic is bounded until L2 measures it. Each member sends 60 packets a
second, and the relay receives and resends each one. At the 1200-byte cap,
a two-player match moves at most about 290 KB/s, or about 120 MB per
7-minute match: about 8,000 matches per TB. The compact encoding should
sit far below the cap, and L2's Done when records the real bytes per
match.

## 4. Ladder (stub)

**Gain.** Ranked play, which Battle.net doesn't offer for this map.
**Cost.** One stub box now. Ratings, identity and anti-abuse wait for Tom's
decision on accounts.

- **G1 stub.** At a match's end, each client sends the relay a result
  message: a peer-room control message beside the forwarded datagrams,
  carrying the result, the final confirmed checksum and the measured RTT.
  The relay appends one line per room with room, region and both reports. A
  disagreement or a missing report is recorded as such. Reports from the
  clients alone are easy to forge, so this only proves a result can be
  collected; it is not a ladder.
- **Later, not boxed.** Identity, either a per-install key pair or an
  account provider; who hosts the records; forgery resistance, such as the
  relay replaying the forwarded inputs; Glicko-2 ratings; queue-based
  matchmaking that picks the region with the lowest summed ping. Accounts
  and any hosted store are Tom's decision.

## Deferred

- Smashcraft on Wisp's 64-frame batched messages instead of its 1–2 row
  packets. That is a wire change, so it re-records the golden and must pass
  net-accept.
- A transport that doesn't wait on the peer each frame, so that rollback
  alone covers a late packet rather than the turn delay. The lockstep link
  keeps every client's sync events on the same frame, which Smashcraft's
  ledger relies on today, and net-accept passes on it at 120 ms. Revisit if
  L4's real-path run shows stalls.
- Choosing the region automatically from both players' pings.

## Boxes

Order:
- N1, P1, P2, P3 and L1 start now. N2 and N3 follow N1, and N4 follows both.
- L2 follows L1. L3 follows L2. L4 follows L3 and N4, so the relay is
  accepted on Wisp's netcode. L5 waits for US-to-US matches.
- P4 follows L2. P5 follows P1 to P3 and Tom's call.
- G1 follows L2.

Command flags and test files named in a Done when that don't exist yet are
created by that box.

- **N1 Golden rollback records for Smashcraft and Battlecraft** ([smashcraft#802](https://github.com/tompassarelli/smashcraft/issues/802); smashcraft,
  battlecraft). A packet-level golden per game, and a match golden for
  Smashcraft (2 and 4 humans; 0, 60 and 120 ms; 1% loss), recorded on main
  and run in Bun and 32-bit Lua. Done when:
  `cd ~/code/smashcraft/main/ts && bun test test/netcode-golden.test.ts test/online-golden.test.ts && cd ~/code/battlecraft/main && bun test test/rollback-golden.test.ts`
- **N2 Wisp's schedule layer, with the session rebuilt on it** ([wisp#96](https://github.com/tompassarelli/wisp/issues/96); wisp,
  battlecraft). Generic `ledger`, `frameRing` and `schedule`, with `session`
  over them. Battlecraft's pin is bumped, and its re-recorded packet golden
  lands in its own commit. Done when:
  `cd ~/code/wisp/main && bun test test/netcode.test.ts test/runtime.test.ts && cd ~/code/battlecraft/main && grep -q "$(git -C ~/code/wisp/main rev-parse origin/main)" wisp.lock && bun test test/rollback-golden.test.ts`
- **N3 Ping-based delay and machine rate in Wisp** ([wisp#97](https://github.com/tompassarelli/wisp/issues/97); wisp, smashcraft).
  `delay` and `rate` with their tests; Smashcraft bumps its pin and imports
  them. Done when:
  `cd ~/code/wisp/main && bun test test/netcode.test.ts && cd ~/code/smashcraft/main/ts && test ! -e src/game/netcode/delayPolicy.ts && bun test test/netcode-golden.test.ts test/online-golden.test.ts`
- **N4 Smashcraft runs on Wisp's netcode** ([smashcraft#803](https://github.com/tompassarelli/smashcraft/issues/803); smashcraft). It bumps its pin and
  deletes its ledger, frameRing, capture, fixedSchedule and shadowSchedule;
  both goldens stay unchanged in Bun and Lua32. Done when:
  `cd ~/code/smashcraft/main/ts && test ! -e src/game/netcode/shadowSchedule.ts && git diff --exit-code origin/main~1 -- test/fixtures/netcode-golden test/fixtures/online-golden && bun test test/netcode-golden.test.ts test/online-golden.test.ts && bun wisp net-accept --out build/net-accept-n4`
- **P1 Standalone parity audit** ([smashcraft#804](https://github.com/tompassarelli/smashcraft/issues/804); smashcraft). One line per surface
  (rendering, menus and HUD, sound, input, frame time), each with its check
  and a box or a reason. It is written to smashcraft:docs/standalone-parity.md.
  Done when: `test "$(grep -c '^- \*\*' ~/code/smashcraft/main/docs/standalone-parity.md)" -ge 5`
- **P2 Standalone and native agree frame for frame** ([smashcraft#806](https://github.com/tompassarelli/smashcraft/issues/806); smashcraft). A
  scripted standalone run of `cpu-expert.pad`, under both `native` and
  `pool-predicted` presentation, carries the same per-frame fighter digests
  as a native corpus recording of that pad. Done when:
  `cd ~/code/smashcraft/main/ts && bun wisp parity standalone test/native/pads/cpu-expert.pad --presentation native,pool-predicted`
- **P3 Assets from the player's own files** ([wisp#98](https://github.com/tompassarelli/wisp/issues/98); wisp, smashcraft). The window
  reads map imports from a given `.w3x` and stock art from the Warcraft
  install, with no private asset store and no GPU lease. Done when:
  `cd ~/code/smashcraft/main/ts && bun wisp play --standalone --map build/release/Smashcraft.w3x --player-assets-only --script test/native/pads/cpu-expert.pad --headless --frames 1070 --out build/p3`
  exits 0.
- **P4 Four humans in a standalone match** ([wisp#99](https://github.com/tompassarelli/wisp/issues/99); wisp, smashcraft). peer.ts and
  TurnLedger take N peers through a peer room: a handshake per peer, a turn
  delay from the largest round trip and one remote per peer. Done when:
  `cd ~/code/smashcraft/main/ts && bun wisp net pair --humans 4 --relay local --script test/native/pads/cpu-expert.pad --frames 3600`
  reports matching checksums on all four.
- **P5 Player build of the standalone window** ([smashcraft#807](https://github.com/tompassarelli/smashcraft/issues/807); cost and publication: Tom
  decides). A packaged player download that needs no source tree, Bun or
  lease. It ships the native window, with no Chrome
  ([native-window-plan.md](native-window-plan.md), "Player build"). Done when:
  `smashcraft-play --version` runs on a clean Windows runner.
- **L1 Relay peer room** ([wisp#100](https://github.com/tompassarelli/wisp/issues/100); wisp relay/). A clockless room kind that forwards
  opaque datagrams among 2 to 4 handshaken members under the existing
  limits, with the control messages' test vectors shared with TypeScript.
  Done when:
  `cd ~/code/wisp/main/relay && cargo test -p relay-proto peer_room && cargo test -p relay peer_room && cd .. && bun test test/relayVectors.test.ts`
- **L2 Standalone host and join through a relay** ([wisp#101](https://github.com/tompassarelli/wisp/issues/101); wisp). peer.ts's `Link`
  goes direct or relayed; `turns` gets a compact encoding under 1200 bytes;
  `--relay REGION` and region-named codes; bytes per match measured. Done
  when: `cd ~/code/wisp/main && bun test test/netRelay.test.ts`
  plays two peers through a local relay binary behind `net proxy --rtt 170`
  with matching checksums, no packet over 1200 bytes, and the measured bytes
  per match printed.
- **L3 Region list, ping display and ping-set delay** ([wisp#102](https://github.com/tompassarelli/wisp/issues/102); wisp, smashcraft). It
  pings each region before hosting; the host picks and the nearest is the
  default; peer.ts's RTT sets the map's delay through Wisp's `delay`; both
  delays are shown before the match. Done when:
  `cd ~/code/wisp/main && bun wisp net regions` prints each region with its
  measured round trip, and
  `cd ~/code/smashcraft/main/ts && bun test test/pingDelay.test.ts` passes.
- **L4 Smashcraft net-accept through the relay** ([smashcraft#808](https://github.com/tompassarelli/smashcraft/issues/808); smashcraft). It runs
  net-accept's cells through a local relay, plus one real-path match from the
  laptop to gex45 through Nexus with its stall and depth figures recorded.
  Done when:
  `cd ~/code/smashcraft/main/ts && bun wisp net-accept --relay local --out build/net-accept-relay`
- **L5 US-West relay** ([wisp#103](https://github.com/tompassarelli/wisp/issues/103); waits until there are US-to-US matches; the server is then Tom's cost call, Hetzner
  Hillsboro CPX11 at €17.99 a month on 30 October 2026). A second region
  with the same service as Nexus. Nothing is bought now: Tom plays from
  UTC+7, next to the Singapore relay (2026-10-30). Done when:
  `cd ~/code/wisp/main && bun wisp net regions | grep us-west`
  shows a measured round trip.
- **G1 Ladder stub: match results at the relay** ([wisp#104](https://github.com/tompassarelli/wisp/issues/104); wisp). A result control
  message from each client and one result line per finished peer room, with
  disagreements and missing reports marked. Done when:
  `cd ~/code/wisp/main/relay && cargo test -p relay peer_room_result`

## Sources

- Hetzner Cloud, Regular Performance plans and prices by location, fetched
  30 October 2026: https://www.hetzner.com/cloud/regular-performance/
- Hetzner price adjustment, 15 June 2026:
  https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Vultr, "More bandwidth in Australia and Japan", 1 July 2024:
  https://blogs.vultr.com/more-bandwidth-in-australia-and-japan
- Hats Network latency pairs, August 2026:
  https://hatsnet.io/docs/network/latency/pairs/lax-sin-rtt,
  https://hatsnet.io/docs/network/latency/pairs/lax-tyo-rtt,
  https://hatsnet.io/docs/network/latency/pairs/tyo-sin-rtt
