// When Warcraft III delivers a synchronized message (BlzSendSyncData), as
// native traces measured it (wisp:docs/network-model.md). Every client runs
// its timer callbacks 60 times a game second at the same game times, and
// receives a message at the same synchronized turn: the first 25 ms turn
// boundary after the send plus a one-way latency, plus a random number of
// further turns. A sender's messages arrive in the order it sent them.
// Plain TypeScript, so Lua programs such as a game's perf runs can use it.
import type { SyncMessage } from "./client";
import type { SyncDelivery } from "./lockstep";
import { Random } from "./random";
import { f32 } from "../sim/f32";

export interface SyncLatency {
  /** One-way latency in game milliseconds, before rounding up to a turn. */
  readonly latencyMs: number;
  /** Game milliseconds between synchronized turns. */
  readonly turnMs: number;
  /** Probabilities of 0, 1, 2, ... further turns; they sum to 1. */
  readonly extraTurns: readonly number[];
}

/**
 * Battle.net as Smashcraft's #26 runs r7 and r8 measured it on 5 October
 * 2026: two clients on one host, 765 own-echo samples from the unsaturated
 * first seconds of each match.
 */
export const MEASURED_BATTLE_NET: SyncLatency = {
  latencyMs: 80,
  turnMs: 25,
  extraTurns: [f32(0.4), f32(0.24), f32(0.144), f32(0.0864), f32(0.05184), f32(0.031104), f32(0.0186624), f32(0.01119744), f32(0.01679616)],
};

/** Game milliseconds between a client's timer callbacks. */
export const CALLBACK_MS = 1000 / 60;

/** The game milliseconds from a send during `frame`'s callback until every client receives it. */
export function syncAgeMs(latency: SyncLatency, frame: number, extraTurns: number): number {
  const sentMs = frame * CALLBACK_MS;
  const turn = Math.ceil((sentMs + latency.latencyMs) / latency.turnMs - f32(1e-9)) + extraTurns;
  return turn * latency.turnMs - sentMs;
}

/** Further turns for one draw in (0, 1). */
function turnsFor(probabilities: readonly number[], draw: number): number {
  let rest = draw;
  for (let turns = 0; turns < probabilities.length - 1; turns++) {
    rest -= probabilities[turns] ?? 0;
    if (rest <= 0) return turns;
  }
  return probabilities.length - 1;
}

/**
 * Lockstep delivery with the measured latency: a message sent during frame F
 * reaches every client before the callbacks of the first frame at or after
 * its arrival. Seeded, so a run repeats exactly.
 */
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

/** A message whose arrival a native capture measured: the first unused one `accepts` takes arrives at `atMs` on the delivery's clock. */
export interface ReplayedArrival {
  readonly accepts: (this: void, message: SyncMessage) => boolean;
  readonly atMs: number;
}

/**
 * Delivery that replays a capture's measured arrivals and leaves every other
 * message to `fallback`: a replayed message reaches every client at the
 * first frame due at or after `atMs`, where `nowMs` gives when the sending
 * frame was due on the same clock (RealtimeClients.frameDueMs), so frames run
 * late under load still land on the measured time. `arrivals` is read at each send, so a run can add
 * arrivals anchored to events it sees, such as when its Start press went in.
 * Each sender's messages still arrive in the order it sent them.
 */
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
