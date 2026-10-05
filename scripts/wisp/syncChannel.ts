// When Warcraft III delivers a synchronized message (BlzSendSyncData), as
// native traces measured it (wisp:docs/network-model.md). Every client runs
// its timer callbacks 60 times a game second at the same game times, and
// receives a message at the same synchronized turn: the first 25 ms turn
// boundary after the send plus a one-way latency, plus a random number of
// further turns. A sender's messages arrive in the order it sent them.
import type { SyncMessage } from "../../src/headless/client";
import type { SyncDelivery } from "../../src/headless/lockstep";

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
  extraTurns: [0.4, 0.24, 0.144, 0.0864, 0.05184, 0.031104, 0.0186624, 0.01119744, 0.01679616],
};

/** Game milliseconds between a client's timer callbacks. */
export const CALLBACK_MS = 1000 / 60;

/** Park-Miller minimal standard generator in Schrage's form: every product stays below 2^31. */
class Random {
  private state: number;

  constructor(seed: number) {
    this.state = (Math.abs(Math.trunc(seed)) % 2147483646) + 1;
  }

  /** Uniform in (0, 1). */
  next(): number {
    const high = Math.floor(this.state / 44488);
    const next = 48271 * (this.state - high * 44488) - 3399 * high;
    this.state = next > 0 ? next : next + 2147483647;
    return this.state / 2147483647;
  }
}

/** The game milliseconds from a send during `frame`'s callback until every client receives it. */
export function syncAgeMs(latency: SyncLatency, frame: number, extraTurns: number): number {
  const sentMs = frame * CALLBACK_MS;
  const turn = Math.ceil((sentMs + latency.latencyMs) / latency.turnMs - 1e-9) + extraTurns;
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
  if (Math.abs(total - 1) > 1e-9) throw new Error(`extra-turn probabilities sum to ${total}, not 1`);
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
      return Math.max(frame + 1, Math.ceil(arrivalMs / CALLBACK_MS - 1e-9));
    },
  };
}
