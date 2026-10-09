import { Effect, Option, Schema } from "effect";
import type { LockstepLink } from "../../../src/headless/lockstep";
import { TurnLedger, type TurnPacket } from "../../../src/headless/turnLedger";

export const FRAME_MS = 1000 / 60;
export const SILENCE_MS = 3000;
const START_LEAD_MS = 400;
const PINGS = 8;
const PING_SPACING_MS = 25;
const SLACK_MS = 4;
const RESEND_MS = FRAME_MS / 2;

export class NetFailure extends Schema.TaggedError<NetFailure>()("NetFailure", { problem: Schema.String }) {
  override get message(): string {
    return this.problem;
  }
}

export class PeerSilent extends Schema.TaggedError<PeerSilent>()("PeerSilent", { frame: Schema.Finite, silentMs: Schema.Finite }) {
  override get message(): string {
    return `the peer stopped sending: no packet for ${(this.silentMs / 1000).toFixed(1)} s, at frame ${this.frame}`;
  }
}

export class PeerLeft extends Schema.TaggedError<PeerLeft>()("PeerLeft", { frame: Schema.Finite, reason: Schema.String }) {
  override get message(): string {
    return `the peer left at frame ${this.frame}: ${this.reason}`;
  }
}

export class NetDesync extends Schema.TaggedError<NetDesync>()("NetDesync", { frame: Schema.Finite, local: Schema.String, remote: Schema.String }) {
  override get message(): string {
    return `checksums differ after frame ${this.frame}: here ${this.local}, the peer ${this.remote}`;
  }
}

export type NetError = NetFailure | PeerSilent | PeerLeft | NetDesync;

/** One client of a match, created before the handshake and started once both sides agree the turn delay. */
export interface NetSession {
  start(this: void): void;
  step(this: void): void;
  frame(this: void): number;
  checksum(this: void): string;
  close(this: void): void;
}

export interface NetGame {
  readonly create: (this: void, link: LockstepLink, slot: number) => Promise<NetSession>;
}

export interface NetPeerOptions {
  readonly role: { readonly host: { readonly port: number } } | { readonly join: { readonly address: string; readonly port: number } };
  readonly game: string;
  readonly frames: number;
  readonly checksumEvery?: number;
  readonly delay?: number;
  /** Fault drills: stop sending, or leave, after this frame. */
  readonly freezeAt?: number;
  readonly quitAt?: number;
}

export interface NetReport {
  readonly slot: number;
  readonly delay: number;
  readonly rttMs: number;
  readonly frames: number;
  readonly checksumsCompared: number;
  readonly mismatches: number;
  readonly deliveries: number;
  readonly deliveryMs: { readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number };
  readonly stepMs: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly slips: number;
  readonly lateFrames: number;
  readonly waitMs: number;
  readonly packetsSent: number;
  readonly packetsReceived: number;
  readonly wallMs: number;
}

const Whole = Schema.Finite;
const Event = Schema.Union([
  Schema.Struct({ sender: Whole, kind: Schema.Literal("sync"), prefix: Schema.String, data: Schema.String }),
  Schema.Struct({ sender: Whole, kind: Schema.Literal("key"), key: Whole, meta: Whole, down: Schema.Boolean }),
  Schema.Struct({ sender: Whole, kind: Schema.Literal("chat"), text: Schema.String }),
  Schema.Struct({ sender: Whole, kind: Schema.Literal("click"), frame: Whole }),
]);
const Datagram = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ t: Schema.Literal("hello"), game: Schema.String }),
  Schema.Struct({ t: Schema.Literal("refuse"), problem: Schema.String }),
  Schema.Struct({ t: Schema.Literal("ping"), id: Whole, at: Whole }),
  Schema.Struct({ t: Schema.Literal("pong"), id: Whole, at: Whole }),
  Schema.Struct({ t: Schema.Literal("delay"), delay: Whole, rttMs: Whole }),
  Schema.Struct({ t: Schema.Literal("ready") }),
  Schema.Struct({ t: Schema.Literal("go"), inMs: Whole }),
  Schema.Struct({
    t: Schema.Literal("turns"), from: Whole, frontier: Whole, ack: Whole, done: Schema.Boolean,
    turns: Schema.Array(Schema.Struct({ frame: Whole, at: Whole, events: Schema.Array(Event) })),
    checks: Schema.Array(Schema.Tuple([Whole, Schema.String])),
  }),
  Schema.Struct({ t: Schema.Literal("bye"), reason: Schema.String }),
]));
type Datagram = typeof Datagram.Type;
const decodeDatagram = Schema.decodeUnknownOption(Datagram);

const wallClock = () => performance.timeOrigin + performance.now();

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

/** Turns travel one way plus 4 ms for the sender's frame and timer jitter; a frame that waits longer stalls both sides briefly, and `paceShift` drops what a slow frame leaves behind. */
export function turnDelay(rttMs: number): number {
  return Math.max(1, Math.ceil((rttMs / 2 + SLACK_MS) / FRAME_MS - 1e-9));
}

const SLIP_FRAMES = 3;

/**
 * How far to push this side's frame schedule later, in ms. A side more than three frames behind its schedule
 * drops the backlog, so a slow frame costs a stutter instead of a lasting lag; a side whose schedule is ahead
 * of the peer's estimated frame slows by up to 1 ms a frame, half the difference, so both run frames together.
 */
export function paceShift(at: { readonly scheduleFrame: number; readonly executed: number; readonly remoteExecuted: number; readonly sinceRemoteMs: number; readonly oneWayMs: number }): number {
  const backlog = at.scheduleFrame - at.executed;
  if (backlog > SLIP_FRAMES) return (backlog - 1) * FRAME_MS;
  const remoteNow = at.remoteExecuted + (Math.min(at.sinceRemoteMs, FRAME_MS) + at.oneWayMs) / FRAME_MS;
  const ahead = at.scheduleFrame - remoteNow;
  return ahead > 0.5 ? Math.min(1, ahead * FRAME_MS / 2) : 0;
}

/**
 * Plays one slot of a two-player match over UDP: the host is slot 0, the joiner slot 1.
 * Each frame both send one packet of their turns; a frame runs once the peer's turns for it are in (wisp:docs/network-model.md).
 */
export const runNetPeer = (game: NetGame, options: NetPeerOptions, log: (line: string) => void = console.error) => Effect.scoped(Effect.gen(function*() {
  const hosting = "host" in options.role;
  const slot = hosting ? 0 : 1;
  const ledger = new TurnLedger(slot, 1 - slot, wallClock);
  const inbox: Datagram[] = [];
  const pongs: number[] = [];
  let peer: { address: string; port: number } | undefined = "join" in options.role ? { ...options.role.join } : undefined;
  let received = 0, sent = 0;
  let lastHeard = wallClock();

  const socket = yield* Effect.acquireRelease(Effect.tryPromise({
    try: () => Bun.udpSocket({
      hostname: "0.0.0.0",
      port: "host" in options.role ? options.role.host.port : 0,
      socket: {
        data: (_socket, data, port, address) => {
          const decoded = decodeDatagram(new TextDecoder().decode(data));
          if (Option.isNone(decoded)) return;
          if (peer === undefined && decoded.value.t === "hello") peer = { address, port };
          if (peer === undefined || peer.port !== port) return;
          received++;
          lastHeard = wallClock();
          if (decoded.value.t === "pong") pongs.push(lastHeard - decoded.value.at / 1000);
          else inbox.push(decoded.value);
        },
      },
    }),
    catch: (cause) => new NetFailure({ problem: `UDP socket: ${String(cause)}` }),
  }), (socket) => Effect.sync(() => socket.close()));
  if (hosting) log(`net: hosting slot 0 on UDP port ${socket.port}`);

  const send = (datagram: Datagram) => Effect.sync(() => {
    const to = peer;
    if (to === undefined) return;
    const bytes = JSON.stringify(datagram);
    sent++;
    // A peer that has gone answers with ICMP port unreachable; silence and goodbyes decide that, not a send.
    try {
      socket.send(bytes, to.port, to.address);
    } catch {
      return;
    }
  });
  const nap = (ms: number) => Effect.sleep(Math.max(0, ms));

  const session = yield* Effect.tryPromise({ try: () => game.create(ledger, slot), catch: (cause) => new NetFailure({ problem: `creating slot ${slot}'s client: ${String(cause)}` }) });
  yield* Effect.addFinalizer(() => Effect.sync(() => session.close()));

  let rttMs = 0, startAt = 0;
  const handshakeEnd = wallClock() + 30_000;
  if (hosting) {
    while (peer === undefined) {
      if (wallClock() > handshakeEnd) return yield* new NetFailure({ problem: "no player joined within 30 s" });
      yield* nap(5);
    }
    const hello = inbox.find((datagram) => datagram.t === "hello");
    if (hello?.t === "hello" && hello.game !== options.game) {
      yield* send({ t: "refuse", problem: `the host plays ${options.game}, the joiner ${hello.game}` });
      return yield* new NetFailure({ problem: `the joiner plays ${hello.game}, not ${options.game}` });
    }
    for (let id = 0; id < PINGS * 3 && pongs.length < PINGS; id++) {
      yield* send({ t: "ping", id, at: Math.round(wallClock() * 1000) });
      yield* nap(PING_SPACING_MS);
    }
    inbox.length = 0;
    const rtts = pongs;
    if (rtts.length === 0) return yield* new NetFailure({ problem: "the joiner answered no ping" });
    rttMs = [...rtts].sort((a, b) => a - b)[Math.floor(rtts.length / 2)] ?? 0;
    ledger.delay = options.delay ?? turnDelay(rttMs);
    const announce = send({ t: "delay", delay: ledger.delay, rttMs: Math.round(rttMs) });
    yield* announce;
    log(`net: slot ${slot}, round trip ${rttMs.toFixed(1)} ms, turn delay ${ledger.delay} frames (${(ledger.delay * FRAME_MS).toFixed(1)} ms)`);
    session.start();
    let ready = false, lastAnnounced = 0;
    while (!ready) {
      if (wallClock() > handshakeEnd) return yield* new NetFailure({ problem: "the joiner did not start its client within 30 s" });
      if (wallClock() - lastAnnounced >= 50) {
        lastAnnounced = wallClock();
        yield* announce;
      }
      yield* nap(1);
      for (let datagram = inbox.shift(); datagram !== undefined; datagram = inbox.shift()) if (datagram.t === "ready") ready = true;
    }
    startAt = wallClock() + START_LEAD_MS + rttMs;
  } else {
    let agreed = false, lastHello = 0;
    while (!agreed) {
      if (wallClock() > handshakeEnd) return yield* new NetFailure({ problem: `the host at ${peer?.address}:${peer?.port} did not answer within 30 s` });
      if (wallClock() - lastHello >= 50) {
        lastHello = wallClock();
        yield* send({ t: "hello", game: options.game });
      }
      yield* nap(1);
      for (let datagram = inbox.shift(); datagram !== undefined; datagram = inbox.shift()) {
        if (datagram.t === "refuse") return yield* new NetFailure({ problem: `the host refused: ${datagram.problem}` });
        if (datagram.t === "ping") yield* send({ t: "pong", id: datagram.id, at: datagram.at });
        if (datagram.t === "delay" && !agreed) {
          agreed = true;
          rttMs = datagram.rttMs;
          ledger.delay = datagram.delay;
        }
      }
    }
    log(`net: slot ${slot}, round trip ${rttMs.toFixed(1)} ms, turn delay ${ledger.delay} frames (${(ledger.delay * FRAME_MS).toFixed(1)} ms)`);
    session.start();
    let lastReady = 0;
    while (startAt === 0) {
      if (wallClock() > handshakeEnd + 30_000) return yield* new NetFailure({ problem: "the host did not start the match within 30 s of this client" });
      if (wallClock() - lastReady >= 20) {
        lastReady = wallClock();
        yield* send({ t: "ready" });
      }
      yield* nap(1);
      for (let datagram = inbox.shift(); datagram !== undefined; datagram = inbox.shift()) {
        if (datagram.t === "go") startAt = wallClock() + datagram.inMs - rttMs / 2;
      }
    }
  }

  const report = (): NetReport => {
    const sorted = [...ledger.latencies].sort((a, b) => a - b);
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      slot, delay: ledger.delay, rttMs: round(rttMs), frames: session.frame(),
      checksumsCompared: ledger.compared, mismatches: ledger.mismatch === undefined ? 0 : 1,
      deliveries: sorted.length,
      deliveryMs: { p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), p99: round(percentile(sorted, 0.99)), max: round(sorted.at(-1) ?? 0) },
      stepMs: (() => {
        const costs = [...steps].sort((a, b) => a - b);
        return { p50: round(percentile(costs, 0.5)), p95: round(percentile(costs, 0.95)), max: round(costs.at(-1) ?? 0) };
      })(),
      slips, lateFrames, waitMs: round(waitMs), packetsSent: sent, packetsReceived: received, wallMs: round(wallClock() - startAt),
    };
  };
  const checkEvery = options.checksumEvery ?? 60;
  const steps: number[] = [];
  let lastFrontier = -1, lastSent = 0, remoteSeenAt = wallClock(), pacedFrame = -1, slips = 0;
  let lateFrames = 0, waitMs = 0, waitingSince: number | undefined, lingerUntil: number | undefined, startSent = 0;
  lastHeard = wallClock();
  const sendTurns = (done: boolean) => Effect.suspend(() => {
    lastFrontier = ledger.frontier();
    lastSent = wallClock();
    return send({ t: "turns", ...ledger.packet(done) });
  });
  const leave = (reason: string) => send({ t: "bye", reason }).pipe(Effect.andThen(send({ t: "bye", reason })));
  const body = Effect.gen(function*() {
    for (;;) {
      for (let datagram = inbox.shift(); datagram !== undefined; datagram = inbox.shift()) {
        if (datagram.t === "turns") {
          const before = ledger.remoteFrontier;
          ledger.receive(datagram satisfies TurnPacket);
          if (ledger.remoteFrontier > before) remoteSeenAt = wallClock();
        }
        else if (datagram.t === "bye" && !ledger.ready(options.frames)) return yield* new PeerLeft({ frame: session.frame(), reason: datagram.reason });
        else if (datagram.t === "ping") yield* send({ t: "pong", id: datagram.id, at: datagram.at });
      }
      if (ledger.mismatch !== undefined) return yield* new NetDesync(ledger.mismatch);
      const now = wallClock();
      if (session.frame() !== pacedFrame && ledger.remoteFrontier > 0) {
        pacedFrame = session.frame();
        const shift = paceShift({ scheduleFrame: (now - startAt) / FRAME_MS, executed: session.frame(), remoteExecuted: ledger.remoteFrontier - ledger.delay, sinceRemoteMs: now - remoteSeenAt, oneWayMs: rttMs / 2 });
        if (shift > 0) {
          startAt += shift;
          if (shift > FRAME_MS) slips++;
        }
      }
      const due = Math.min(options.frames, Math.floor((now - startAt) / FRAME_MS));
      while (session.frame() < due && ledger.ready(session.frame() + 1)) {
        const frame = session.frame() + 1;
        if (waitingSince !== undefined) {
          waitMs += wallClock() - waitingSince;
          waitingSince = undefined;
        }
        if (wallClock() - (startAt + frame * FRAME_MS) > FRAME_MS) lateFrames++;
        const stepped = performance.now();
        session.step();
        steps.push(performance.now() - stepped);
        if (frame % checkEvery === 0) ledger.check(frame, session.checksum());
        if (frame < options.frames) yield* sendTurns(false);
        if (frame === options.quitAt) {
          yield* leave("it was told to quit");
          return yield* new NetFailure({ problem: `quit at frame ${frame} as told` });
        }
        if (frame === options.freezeAt) {
          log(`net: frozen at frame ${frame} as told; sending nothing`);
          return yield* Effect.never;
        }
      }
      if (session.frame() < due && waitingSince === undefined) waitingSince = wallClock();
      const finished = session.frame() >= options.frames;
      if (finished && lingerUntil === undefined) lingerUntil = wallClock() + SILENCE_MS;
      if (hosting && ledger.remoteFrontier === 0 && startSent < 200) {
        startSent++;
        yield* send({ t: "go", inMs: Math.round(startAt - wallClock()) });
      }
      if (ledger.frontier() !== lastFrontier || wallClock() - lastSent >= RESEND_MS) yield* sendTurns(finished);
      if (finished) {
        const settled = ledger.remoteFrontier >= options.frames && ledger.peerAck >= options.frames
          && ledger.lastCompared >= options.frames - (options.frames % checkEvery);
        if (settled || ledger.remoteDone && ledger.remoteFrontier >= options.frames || wallClock() > (lingerUntil ?? 0)) {
          if (ledger.mismatch !== undefined) return yield* new NetDesync(ledger.mismatch);
          yield* leave("its match ended");
          return report();
        }
      }
      const silent = wallClock() - lastHeard;
      if (silent > SILENCE_MS && !(finished && ledger.remoteDone)) return yield* new PeerSilent({ frame: session.frame(), silentMs: silent });
      const next = startAt + (session.frame() + 1) * FRAME_MS;
      yield* nap(session.frame() < due ? 1 : Math.min(next - wallClock(), FRAME_MS));
    }
  });
  return yield* body.pipe(Effect.tapError((error) => error._tag === "PeerLeft" || error._tag === "PeerSilent" ? Effect.void : leave(error.message)));
}));
