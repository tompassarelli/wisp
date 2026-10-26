import type { SyncMessage } from "./clientTypes";
import type { SyncDelivery } from "./lockstep";
import { Random } from "./random";
import { f32 } from "../sim/f32";
import { floorMod } from "../sim/intMath";
import { type CallbackTiming, FRAME_MS, FRAMES_PER_SECOND } from "./frameRate";

export { type CallbackTiming, EVEN_CALLBACKS } from "./frameRate";

export interface SyncLatency {

  readonly latencyMs: number;

  readonly turnMs: number;

  readonly extraTurns: readonly number[];
}

// Battle.net latency and turn probabilities use the native capture in wisp:docs/network-model.md.

export const MEASURED_BATTLE_NET: SyncLatency = {
  latencyMs: 80,
  turnMs: 25,
  extraTurns: [f32(0.4), f32(0.24), f32(0.144), f32(0.0864), f32(0.05184), f32(0.031104), f32(0.0186624), f32(0.01119744), f32(0.01679616)],
};

export const CALLBACK_MS = FRAME_MS;

// Turn arithmetic counts sixtieths of a millisecond, so frame n starts at n·1000 and whole-millisecond
// latencies and turns stay integers: a turn that ends on a frame boundary lands on that frame in Bun and in 32-bit Lua alike (wisp#71).
const UNITS_PER_FRAME = 1000;

function ceilDiv(a: number, b: number): number {
  let quotient = Math.ceil(a / b);
  while (quotient * b < a) quotient++;
  while ((quotient - 1) * b >= a) quotient--;
  return quotient;
}

function syncTurn(latency: SyncLatency, frame: number, extraTurns: number): number {
  return ceilDiv(frame * UNITS_PER_FRAME + latency.latencyMs * FRAMES_PER_SECOND, latency.turnMs * FRAMES_PER_SECOND) + extraTurns;
}

export function syncAgeMs(latency: SyncLatency, frame: number, extraTurns: number): number {
  return syncTurn(latency, frame, extraTurns) * latency.turnMs - frame * CALLBACK_MS;
}

function turnsFor(probabilities: readonly number[], draw: number): number {
  let rest = draw;
  for (let turns = 0; turns < probabilities.length - 1; turns++) {
    rest -= probabilities[turns] ?? 0;
    if (rest <= 0) return turns;
  }
  return probabilities.length - 1;
}

export function syncDelivery(latency: SyncLatency = MEASURED_BATTLE_NET, seed = 1): SyncDelivery {
  const total = latency.extraTurns.reduce((sum, p) => sum + p, 0);
  // Binary32 probabilities sum to 1 within a few of its ulps.
  if (Math.abs(total - 1) > f32(1e-6)) throw new Error(`extra-turn probabilities sum to ${total}, not 1`);
  if (!(latency.turnMs > 0) || !(latency.latencyMs >= 0)) throw new Error("turn length must be positive and latency not negative");
  const senders = new Map<number, { readonly random: Random; lastArrival: number }>();
  return {
    arrivalFrame: (sender: number, frame: number, _message: SyncMessage) => {
      let state = senders.get(sender);
      if (state === undefined) {
        state = { random: new Random(seed * 7919 + sender * 104729 + 1), lastArrival: 0 };
        senders.set(sender, state);
      }
      const turn = syncTurn(latency, frame, turnsFor(latency.extraTurns, state.random.next()));
      const arrival = Math.max(state.lastArrival, turn * latency.turnMs * FRAMES_PER_SECOND);
      state.lastArrival = arrival;
      return Math.max(frame + 1, ceilDiv(arrival, UNITS_PER_FRAME));
    },
  };
}

export interface ReplayedArrival {
  readonly accepts: (this: void, message: SyncMessage) => boolean;
  readonly atMs: number;
}

// Captured arrivals preserve each sender's message order even when frames run late.

export function replayedDelivery(arrivals: (this: void) => readonly ReplayedArrival[], fallback: SyncDelivery, nowMs: (this: void) => number): SyncDelivery {
  const used = new Set<ReplayedArrival>();
  const last = new Map<number, number>();
  return {
    arrivalFrame: (sender, frame, message) => {
      const replayed = arrivals().find((arrival) => !used.has(arrival) && arrival.accepts(message));
      let arrival: number;
      if (replayed === undefined) arrival = fallback.arrivalFrame(sender, frame, message);
      else {
        used.add(replayed);
        arrival = frame + Math.ceil((replayed.atMs - nowMs()) / CALLBACK_MS - f32(1e-9));
      }
      arrival = Math.max(frame + 1, last.get(sender) ?? 0, arrival);
      last.set(sender, arrival);
      return arrival;
    },
  };
}

export interface TurnBurstModel {

  readonly turnMs: number;

  readonly jitterMs: number;

  readonly hitchChance: number;

  readonly hitchMeanMs: number;
}

// Turn jitter and hitches use the rates fit in wisp:docs/network-model.md.

export const MEASURED_TURN_BURSTS: TurnBurstModel = { turnMs: 25, jitterMs: 12, hitchChance: f32(0.005), hitchMeanMs: 30 };

export function turnBursts(model: TurnBurstModel = MEASURED_TURN_BURSTS, seed = 1): CallbackTiming {
  if (!(model.turnMs >= CALLBACK_MS) || !(model.jitterMs >= 0) || !(model.hitchChance >= 0 && model.hitchChance < 1) || !(model.hitchMeanMs >= 0)) {
    throw new Error("a turn must last at least one callback, and jitter, hitch chance and hitch length must not be negative");
  }
  const turnOf = (frame: number) => Math.max(1, ceilDiv(frame * UNITS_PER_FRAME, model.turnMs * FRAMES_PER_SECOND));
  let lag = 0;
  const cycle = 6000;
  for (let frame = 1; frame <= cycle; frame++) lag += turnOf(frame) * model.turnMs - frame * CALLBACK_MS;
  const offset = lag / cycle + model.jitterMs / 2 + model.hitchChance * model.hitchMeanMs;
  const random = new Random(seed * 7919 + 15485863);
  const walls: number[] = [];
  const turnWall = (turn: number): number => {
    while (walls.length < turn) {
      let jitter = random.next() * model.jitterMs;
      if (random.chance(model.hitchChance)) jitter -= model.hitchMeanMs * Math.log(1 - random.next());
      walls.push(Math.max(walls.at(-1) ?? 0, (walls.length + 1) * model.turnMs + jitter - offset));
    }
    return walls[turn - 1] ?? 0;
  };
  return { wallMs: (frame) => (frame <= 0 ? frame * CALLBACK_MS : turnWall(turnOf(frame))) };
}

export interface RelayLink {

  readonly rttMs: number;

  readonly loss: number;

  readonly depthTurns: number;
}

export interface RelayOutage {

  readonly atMs: number;

  readonly lengthMs: number;
}

export interface RelayTiming {

  readonly steps: readonly number[];

  readonly jitterMs: number;

  readonly links: readonly RelayLink[];

  readonly outage?: RelayOutage;
}

export const MEASURED_RELAY: RelayTiming = { steps: [8], jitterMs: 2, links: [{ rttMs: 120, loss: f32(0.02), depthTurns: 4 }] };

export const RELAY_LAG_STOP_MS = 1000;
export const RELAY_CATCH_UP_STEP_MS = 4;
export const RELAY_SLEW_HOLD_MS = 30000;

export interface RelayDelivery extends SyncDelivery {

  ageMs(this: void, sender: number, frame: number): number;
}

function checkRelay(timing: RelayTiming): void {
  if (timing.steps.length === 0 || !timing.steps.every((step) => step > RELAY_CATCH_UP_STEP_MS) || !(timing.jitterMs >= 0) || timing.links.length === 0) {
    throw new Error(`relay turns must be longer than ${RELAY_CATCH_UP_STEP_MS} ms, jitter not negative, and at least one link given`);
  }
  for (const link of timing.links) {
    if (!(link.rttMs >= 0) || !(link.loss >= 0 && link.loss < 1) || !Number.isInteger(link.depthTurns) || link.depthTurns < 0) {
      throw new Error("a relay link needs a round trip not negative, loss in [0, 1) and a whole depth not negative");
    }
  }
  if (timing.outage !== undefined && (!(timing.outage.atMs >= 0) || !(timing.outage.lengthMs >= 0))) throw new Error("an outage must start and last at least 0 ms");
}

function relayShape(timing: RelayTiming) {
  const period = timing.steps.reduce((sum, step) => sum + step, 0);
  const meanStep = period / timing.steps.length;
  const ends = timing.steps.map((_, index) => timing.steps.slice(0, index + 1).reduce((sum, step) => sum + step, 0));
  const turnAfter = (relayMs: number): number => {
    const within = floorMod(relayMs, period);
    return relayMs - within + (ends.find((end) => end > within) ?? period);
  };
  const linkOf = (sender: number): RelayLink => timing.links[sender] ?? timing.links.at(-1) ?? { rttMs: 0, loss: 0, depthTurns: 0 };
  const depthMs = (link: RelayLink) => link.depthTurns * meanStep;
  const outage = timing.outage;
  const trailMs = Math.max(...timing.links.map((link) => link.rttMs + depthMs(link)));
  const shallowMs = Math.min(...timing.links.map((link) => depthMs(link)));
  const stopMs = outage === undefined ? 0 : Math.min(outage.atMs + outage.lengthMs, outage.atMs + Math.max(0, RELAY_LAG_STOP_MS - trailMs));
  const gapMs = outage === undefined ? 0 : outage.atMs + outage.lengthMs - stopMs;
  const extraMs = outage === undefined ? 0 : outage.lengthMs - shallowMs - gapMs;
  const drainMs = extraMs > 2 * meanStep ? ((extraMs - meanStep) * meanStep) / (meanStep - RELAY_CATCH_UP_STEP_MS) : 0;
  const settledMs = extraMs > 2 * meanStep ? meanStep : extraMs;
  const wallMs = (gameMs: number): number => {
    if (outage === undefined || gameMs <= outage.atMs || outage.lengthMs <= shallowMs) return gameMs;
    const since = gameMs - outage.atMs;
    let extra: number;
    if (since < drainMs) extra = extraMs - (since * (meanStep - RELAY_CATCH_UP_STEP_MS)) / meanStep;
    else if (since < drainMs + RELAY_SLEW_HOLD_MS) extra = settledMs;
    else extra = Math.max(0, settledMs - (since - drainMs - RELAY_SLEW_HOLD_MS) / meanStep);
    return gameMs + gapMs + extra;
  };
  return { meanStep, turnAfter, linkOf, depthMs, outage, stopMs, gapMs, wallMs };
}

export function relayDelivery(timing: RelayTiming = MEASURED_RELAY, seed = 1): RelayDelivery {
  checkRelay(timing);
  const shape = relayShape(timing);
  const anchorFraction = -Math.log(f32(0.95));
  const senders = new Map<number, { readonly random: Random; lastArrivalMs: number }>();
  const ageMs = (sender: number, frame: number): number => {
    let state = senders.get(sender);
    if (state === undefined) {
      state = { random: new Random(seed * 7919 + sender * 104729 + 3), lastArrivalMs: 0 };
      senders.set(sender, state);
    }
    const link = shape.linkOf(sender);
    const sentMs = frame * CALLBACK_MS;
    let upMs = shape.wallMs(sentMs) + link.rttMs / 2 + timing.jitterMs * anchorFraction + shape.depthMs(link);
    for (;;) {
      if (shape.outage !== undefined && upMs >= shape.outage.atMs && upMs < shape.outage.atMs + shape.outage.lengthMs) upMs = shape.outage.atMs + shape.outage.lengthMs;
      else if (state.random.chance(link.loss)) upMs += shape.meanStep;
      else break;
    }
    upMs += link.rttMs / 2 - timing.jitterMs * Math.log(1 - state.random.next());
    let relayMs = upMs;
    if (shape.outage !== undefined && upMs >= shape.stopMs) relayMs = upMs < shape.outage.atMs + shape.outage.lengthMs ? shape.stopMs : upMs - shape.gapMs;
    const arrivalMs = Math.max(state.lastArrivalMs, shape.turnAfter(relayMs));
    state.lastArrivalMs = arrivalMs;
    return arrivalMs - sentMs;
  };
  return {
    ageMs: (sender: number, frame: number) => ageMs(sender, frame),
    arrivalFrame: (sender: number, frame: number, _message: SyncMessage) => Math.max(frame + 1, Math.ceil(frame + ageMs(sender, frame) / CALLBACK_MS - f32(1e-9))),
  };
}

export function relayCallbacks(timing: RelayTiming = MEASURED_RELAY): CallbackTiming {
  checkRelay(timing);
  const shape = relayShape(timing);
  return { wallMs: (frame) => (frame <= 0 ? frame * CALLBACK_MS : shape.wallMs(frame * CALLBACK_MS)) };
}
