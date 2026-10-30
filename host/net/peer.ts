import { Effect, Option, Schema } from "effect";
import type { LockstepLink } from "../../src/headless/lockstep";
import { TurnLedger, type TurnPacket } from "../../src/headless/turnLedger";
import { FRAME_MS } from "../../src/headless/frameRate";
import { NetFailure } from "./failure";
import { type Endpoint, type Link, openDirectLink } from "./link";
import { openRelayLink } from "./relayLink";
import { type Datagram, decodeDatagram, encodeDatagram, fitTurns } from "./wire";

export { FRAME_MS };
const SILENCE_MS = 3000;
const START_LEAD_MS = 400;
const PINGS = 8;
const PING_SPACING_MS = 25;
const SLACK_MS = 4;
const RESEND_MS = FRAME_MS / 2;

class PeerSilent extends Schema.TaggedError<PeerSilent, { readonly brand: unique symbol }>()("PeerSilent", { slot: Schema.Finite, frame: Schema.Finite, silentMs: Schema.Finite }) {
  override get message(): string {
    return `slot ${this.slot} stopped sending: no packet for ${(this.silentMs / 1000).toFixed(1)} s, at frame ${this.frame}`;
  }
}

class PeerLeft extends Schema.TaggedError<PeerLeft, { readonly brand: unique symbol }>()("PeerLeft", { slot: Schema.Finite, frame: Schema.Finite, reason: Schema.String }) {
  override get message(): string {
    return `slot ${this.slot} left at frame ${this.frame}: ${this.reason}`;
  }
}

class NetDesync extends Schema.TaggedError<NetDesync, { readonly brand: unique symbol }>()("NetDesync", { frame: Schema.Finite, peer: Schema.Finite, local: Schema.String, remote: Schema.String }) {
  override get message(): string {
    return `checksums differ after frame ${this.frame}: here ${this.local}, slot ${this.peer} ${this.remote}`;
  }
}

export type NetError = NetFailure | PeerSilent | PeerLeft | NetDesync;

/** One client of a match, created before the handshake and started once both sides agree the turn delay. */
export interface NetSession {
  start(this: void): void;
  /** Hands the handshake's round trip to the map before `start`; it returns the input delay in frames that the map sets from it. */
  measured?(this: void, rttMs: number): number;
  step(this: void): void;
  frame(this: void): number;
  checksum(this: void): string;
  close(this: void): void;
}

export interface NetGame {
  readonly create: (this: void, link: LockstepLink, slot: number, humans: number) => Promise<NetSession>;
}

export interface NetPeerOptions {
  readonly role: NetRole;
  readonly game: string;
  readonly frames: number;
  readonly checksumEvery?: number;
  readonly delay?: number;
  /** The humans in a relayed match, 2 to 4; a joiner learns it from the room. */
  readonly humans?: number;
  /** Fault drills: stop sending, or leave, after this frame. */
  readonly freezeAt?: number;
  readonly quitAt?: number;
  /** Called once the host can be reached: with its UDP port, or the room its relay opened. */
  readonly listening?: (listening: NetListening) => void;
}

/** Which end of a match this process is, and how it reaches the other: straight over UDP, or through a relay's peer room. */
export type NetRole =
  | { readonly kind: "host"; readonly port: number }
  | { readonly kind: "join"; readonly to: Endpoint }
  | { readonly kind: "relayHost"; readonly relay: Endpoint }
  | { readonly kind: "relayJoin"; readonly relay: Endpoint; readonly room: bigint };

export type NetListening = { readonly port: number } | { readonly room: bigint };

export interface NetReport {
  readonly slot: number;
  readonly humans: number;
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
  /** On the wire, a relay's framing included: all bytes this side sent and took in, and its largest datagram in each direction. */
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly largestSent: number;
  readonly largestReceived: number;
  readonly wallMs: number;
}

const wallClock = () => performance.timeOrigin + performance.now();

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0;
}

/** Turns travel one way plus 4 ms for the sender's frame and timer jitter; a frame that waits longer stalls both sides briefly, and `paceShift` drops what a slow frame leaves behind. */
function turnDelay(rttMs: number): number {
  return Math.max(1, Math.ceil((rttMs / 2 + SLACK_MS) / FRAME_MS - 1e-9));
}

const SLIP_FRAMES = 3;

/**
 * How far to push this side's frame schedule later, in ms. A side more than three frames behind its schedule
 * drops the backlog, so a slow frame costs a stutter instead of a lasting lag; a side whose schedule is ahead
 * of the peer's estimated frame slows by up to 1 ms a frame, half the difference, so both run frames together.
 */
function paceShift(at: { readonly scheduleFrame: number; readonly executed: number; readonly remoteExecuted: number; readonly sinceRemoteMs: number; readonly oneWayMs: number }): number {
  const backlog = at.scheduleFrame - at.executed;
  if (backlog > SLIP_FRAMES) return (backlog - 1) * FRAME_MS;
  const remoteNow = at.remoteExecuted + (Math.min(at.sinceRemoteMs, FRAME_MS) + at.oneWayMs) / FRAME_MS;
  const ahead = at.scheduleFrame - remoteNow;
  return ahead > 0.5 ? Math.min(1, ahead * FRAME_MS / 2) : 0;
}

/**
 * Plays one slot of a match of two to four humans over UDP: the host is slot 0, and a joiner's slot is its address's (direct) or the
 * relay room's. Each frame every side sends one packet of its turns to all the others; a frame runs once every peer's turns for it
 * are in (wisp:docs/network-model.md).
 */
export const runNetPeer = (game: NetGame, options: NetPeerOptions, log: (line: string) => void = console.error) => Effect.scoped(Effect.gen(function*() {
  const { role } = options;
  const hosting = role.kind === "host" || role.kind === "relayHost";
  const inbox: { readonly from: number; readonly datagram: Datagram }[] = [];
  const pongs = new Map<number, number[]>();
  const heard = new Map<number, number>();
  let received = 0, sent = 0;

  const receive = (payload: Uint8Array, from: number) => {
    const decoded = decodeDatagram(payload);
    if (Option.isNone(decoded) || (decoded.value.t === "turns" && decoded.value.from !== from)) return;
    received++;
    heard.set(from, wallClock());
    if (decoded.value.t === "pong") pongs.set(from, [...pongs.get(from) ?? [], wallClock() - decoded.value.at / 1000]);
    else inbox.push({ from, datagram: decoded.value });
  };
  let link: Link;
  let slot = hosting ? 0 : 1;
  let humans = options.humans ?? 2;
  if (role.kind === "relayHost" || role.kind === "relayJoin") {
    const relayed = yield* openRelayLink({ relay: role.relay, opening: role.kind === "relayHost" ? { create: true, players: humans } : { join: role.room }, receive });
    link = relayed;
    slot = relayed.slot;
    humans = relayed.players;
    if (role.kind === "relayHost") {
      log(`net: hosting slot 0 of ${humans} in relay room ${relayed.room.toString(16)} on ${role.relay.address}:${role.relay.port}`);
      options.listening?.({ room: relayed.room });
    }
  } else {
    if (humans !== 2) return yield* new NetFailure({ problem: `a direct match has two humans; ${humans} play through a relay` });
    const direct = yield* openDirectLink({
      port: role.kind === "host" ? role.port : 0,
      ...(role.kind === "join" ? { peer: role.to } : {}),
      learn: (payload) => {
        const decoded = decodeDatagram(payload);
        return Option.isSome(decoded) && decoded.value.t === "hello";
      },
      receive: (payload) => receive(payload, 1 - slot),
    });
    link = direct;
    if (role.kind === "host") {
      log(`net: hosting slot 0 on UDP port ${direct.port}`);
      options.listening?.({ port: direct.port });
    }
  }
  const where = role.kind === "join" ? `${role.to.address}:${role.to.port}` : role.kind === "relayJoin" ? `relay ${role.relay.address}:${role.relay.port}` : "";
  const peers = Array.from({ length: humans }, (_, member) => member).filter((member) => member !== slot);
  const ledger = new TurnLedger(slot, peers, wallClock);
  const startHeard = wallClock();
  for (const peer of peers) heard.set(peer, startHeard);

  const send = (datagram: Datagram) => Effect.sync(() => {
    sent++;
    link.send(encodeDatagram(datagram));
  });
  const nap = (ms: number) => Effect.sleep(Math.max(0, ms));

  const session = yield* Effect.tryPromise({ try: () => game.create(ledger, slot, humans), catch: (cause) => new NetFailure({ problem: `creating slot ${slot}'s client: ${String(cause)}` }) });
  yield* Effect.addFinalizer(() => Effect.sync(() => session.close()));

  let rttMs = 0, ownRttMs = 0, startAt = 0;
  const showMapDelay = () => {
    const inputDelay = session.measured?.(rttMs);
    if (inputDelay !== undefined) log(`net: slot ${slot}, map input delay ${inputDelay} frames (${(inputDelay * FRAME_MS).toFixed(1)} ms)`);
  };
  const handshakeEnd = wallClock() + 30_000;
  if (hosting) {
    const joined = new Set<number>();
    while (joined.size < peers.length) {
      if (wallClock() > handshakeEnd) return yield* new NetFailure({ problem: `${joined.size} of ${peers.length} players joined within 30 s` });
      yield* nap(5);
      for (const { from, datagram } of inbox.splice(0)) {
        if (datagram.t !== "hello") continue;
        if (datagram.game !== options.game) {
          yield* send({ t: "refuse", problem: `the host plays ${options.game}, the joiner ${datagram.game}` });
          return yield* new NetFailure({ problem: `the joiner in slot ${from} plays ${datagram.game}, not ${options.game}` });
        }
        joined.add(from);
      }
    }
    for (let id = 0; id < PINGS * 3 && peers.some((peer) => (pongs.get(peer)?.length ?? 0) < PINGS); id++) {
      yield* send({ t: "ping", id, at: Math.round(wallClock() * 1000) });
      yield* nap(PING_SPACING_MS);
    }
    inbox.length = 0;
    const rtts: number[] = Array.from({ length: humans }, () => 0);
    for (const peer of peers) {
      const sample = pongs.get(peer) ?? [];
      if (sample.length === 0) return yield* new NetFailure({ problem: `the joiner in slot ${peer} answered no ping` });
      rtts[peer] = [...sample].sort((a, b) => a - b)[Math.floor(sample.length / 2)] ?? 0;
    }
    rttMs = Math.max(...rtts);
    ledger.delay = options.delay ?? turnDelay(rttMs);
    const announce = send({ t: "delay", delay: ledger.delay, rtts: rtts.map(Math.round) });
    yield* announce;
    log(`net: slot ${slot} of ${humans}, round trip ${rttMs.toFixed(1)} ms, turn delay ${ledger.delay} frames (${(ledger.delay * FRAME_MS).toFixed(1)} ms)`);
    showMapDelay();
    session.start();
    const ready = new Set<number>();
    let lastAnnounced = 0;
    while (ready.size < peers.length) {
      if (wallClock() > handshakeEnd) return yield* new NetFailure({ problem: `${peers.length - ready.size} joiners did not start their clients within 30 s` });
      if (wallClock() - lastAnnounced >= 50) {
        lastAnnounced = wallClock();
        yield* announce;
      }
      yield* nap(1);
      for (const { from, datagram } of inbox.splice(0)) if (datagram.t === "ready") ready.add(from);
    }
    startAt = wallClock() + START_LEAD_MS + rttMs;
  } else {
    let agreed = false, lastHello = 0;
    while (!agreed) {
      if (wallClock() > handshakeEnd) return yield* new NetFailure({ problem: `the host at ${where} did not answer within 30 s` });
      if (wallClock() - lastHello >= 50) {
        lastHello = wallClock();
        yield* send({ t: "hello", game: options.game });
      }
      yield* nap(1);
      for (const { from, datagram } of inbox.splice(0)) {
        if (from !== 0) continue;
        if (datagram.t === "refuse") return yield* new NetFailure({ problem: `the host refused: ${datagram.problem}` });
        if (datagram.t === "ping") yield* send({ t: "pong", id: datagram.id, at: datagram.at });
        if (datagram.t === "delay" && !agreed) {
          agreed = true;
          rttMs = Math.max(...datagram.rtts);
          ownRttMs = datagram.rtts[slot] ?? rttMs;
          ledger.delay = datagram.delay;
        }
      }
    }
    log(`net: slot ${slot} of ${humans}, round trip ${rttMs.toFixed(1)} ms, turn delay ${ledger.delay} frames (${(ledger.delay * FRAME_MS).toFixed(1)} ms)`);
    showMapDelay();
    session.start();
    let lastReady = 0;
    while (startAt === 0) {
      if (wallClock() > handshakeEnd + 30_000) return yield* new NetFailure({ problem: "the host did not start the match within 30 s of this client" });
      if (wallClock() - lastReady >= 20) {
        lastReady = wallClock();
        yield* send({ t: "ready" });
      }
      yield* nap(1);
      for (const { from, datagram } of inbox.splice(0)) {
        if (from === 0 && datagram.t === "go") startAt = wallClock() + datagram.inMs - ownRttMs / 2;
      }
    }
  }

  const report = (): NetReport => {
    const sorted = [...ledger.latencies].sort((a, b) => a - b);
    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      slot, humans, delay: ledger.delay, rttMs: round(rttMs), frames: session.frame(),
      checksumsCompared: ledger.compared, mismatches: ledger.mismatch === undefined ? 0 : 1,
      deliveries: sorted.length,
      deliveryMs: { p50: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), p99: round(percentile(sorted, 0.99)), max: round(sorted.at(-1) ?? 0) },
      stepMs: (() => {
        const costs = [...steps].sort((a, b) => a - b);
        return { p50: round(percentile(costs, 0.5)), p95: round(percentile(costs, 0.95)), max: round(costs.at(-1) ?? 0) };
      })(),
      slips, lateFrames, waitMs: round(waitMs), packetsSent: sent, packetsReceived: received,
      bytesSent: link.traffic.bytesSent, bytesReceived: link.traffic.bytesReceived, largestSent: link.traffic.largestSent, largestReceived: link.traffic.largestReceived, wallMs: round(wallClock() - startAt),
    };
  };
  const checkEvery = options.checksumEvery ?? 60;
  const steps: number[] = [];
  const departed = new Set<number>();
  let lastFrontier = -1, lastSent = 0, remoteSeenAt = wallClock(), pacedFrame = -1, slips = 0;
  let lateFrames = 0, waitMs = 0, waitingSince: number | undefined, lingerUntil: number | undefined, startSent = 0;
  for (const peer of peers) heard.set(peer, wallClock());
  const sendTurns = (done: boolean) => Effect.suspend(() => {
    lastFrontier = ledger.frontier();
    lastSent = wallClock();
    return Effect.sync(() => {
      const { bytes } = fitTurns(ledger.packet(done), link.maxPayload);
      sent++;
      link.send(bytes);
    });
  });
  const leave = (reason: string) => send({ t: "bye", reason }).pipe(Effect.andThen(send({ t: "bye", reason })));
  const body = Effect.gen(function*() {
    for (;;) {
      for (const { from, datagram } of inbox.splice(0)) {
        if (datagram.t === "turns") {
          const before = ledger.remoteFrontier;
          ledger.receive(datagram satisfies TurnPacket);
          if (ledger.remoteFrontier > before) remoteSeenAt = wallClock();
        }
        else if (datagram.t === "bye") {
          if (ledger.frontierOf(from) < options.frames) return yield* new PeerLeft({ slot: from, frame: session.frame(), reason: datagram.reason });
          departed.add(from);
          ledger.depart(from);
        }
        else if (datagram.t === "ping" && from === 0) yield* send({ t: "pong", id: datagram.id, at: datagram.at });
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
      const quiet = peers.filter((peer) => !departed.has(peer)).map((peer) => ({ peer, silent: wallClock() - (heard.get(peer) ?? wallClock()) })).sort((a, b) => b.silent - a.silent)[0];
      if (quiet !== undefined && quiet.silent > SILENCE_MS && !(finished && ledger.remoteDone)) return yield* new PeerSilent({ slot: quiet.peer, frame: session.frame(), silentMs: quiet.silent });
      const next = startAt + (session.frame() + 1) * FRAME_MS;
      yield* nap(session.frame() < due ? 1 : Math.min(next - wallClock(), FRAME_MS));
    }
  });
  return yield* body.pipe(
    Effect.tapError((error) => error._tag === "PeerLeft" || error._tag === "PeerSilent" ? Effect.void : leave(error.message)),
    Effect.onInterrupt(() => leave("it closed")),
  );
}));
