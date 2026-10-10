import type { SyncMessage } from "./client";
import type { SyncDelivery } from "./lockstep";
import { Random } from "./random";
import { f32 } from "../sim/f32";
import { FRAME_MS } from "./frameRate";

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

export function syncAgeMs(latency: SyncLatency, frame: number, extraTurns: number): number {
  const sentMs = frame * CALLBACK_MS;
  const turn = Math.ceil((sentMs + latency.latencyMs) / latency.turnMs - f32(1e-9)) + extraTurns;
  return turn * latency.turnMs - sentMs;
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
  const senders = new Map<number, { readonly random: Random; lastArrivalMs: number }>();
  return {
    arrivalFrame: (sender: number, frame: number, _message: SyncMessage) => {
      let state = senders.get(sender);
      if (state === undefined) {
        state = { random: new Random(seed * 7919 + sender * 104729 + 1), lastArrivalMs: 0 };
        senders.set(sender, state);
      }
      const arrivalMs = Math.max(state.lastArrivalMs, frame * CALLBACK_MS + syncAgeMs(latency, frame, turnsFor(latency.extraTurns, state.random.next())));
      state.lastArrivalMs = arrivalMs;
      return Math.max(frame + 1, Math.ceil(arrivalMs / CALLBACK_MS - f32(1e-9)));
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
