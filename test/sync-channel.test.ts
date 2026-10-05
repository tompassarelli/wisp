import { expect, test } from "bun:test";
import { MEASURED_BATTLE_NET, syncAgeMs, syncDelivery } from "../scripts/wisp/syncChannel";

/** Own-echo ages the model gives a message sent on any frame: the frame cycle repeats every 3 frames (2 turns). */
function modelAges(samples: number): number[] {
  const ages: number[] = [];
  for (let frame = 0; frame < 3; frame++) {
    MEASURED_BATTLE_NET.extraTurns.forEach((p, extra) => {
      for (let i = 0; i < Math.round(p * samples); i++) ages.push(syncAgeMs(MEASURED_BATTLE_NET, frame, extra));
    });
  }
  return ages.sort((a, b) => a - b);
}

const at = (sorted: readonly number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? Number.NaN;

test("the measured latency gives r7 and r8's unsaturated own-echo ages within 15 ms", () => {
  // 765 own echoes from both clients, 1.5-9.5 s into the first match of Smashcraft #26 r7 and r8.
  const measured = [[0.1, 86], [0.25, 95], [0.5, 115], [0.75, 137], [0.9, 194], [0.95, 212]] as const;
  const ages = modelAges(10000);
  for (const [p, ms] of measured) expect(Math.abs(at(ages, p) - ms)).toBeLessThanOrEqual(15);
});

test("delivery is seeded, later than the send, and keeps each sender's order", () => {
  const arrivals = (seed: number) => {
    const delivery = syncDelivery(MEASURED_BATTLE_NET, seed);
    const frames: number[][] = [[], []];
    for (let frame = 1; frame <= 600; frame++) {
      for (const sender of [0, 1]) frames[sender]?.push(delivery.arrivalFrame(sender, frame, { sender, prefix: "P", data: "" }));
    }
    return frames;
  };
  const first = arrivals(3);
  expect(arrivals(3)).toEqual(first);
  expect(arrivals(4)).not.toEqual(first);
  for (const frames of first) {
    frames.forEach((arrival, index) => {
      expect(arrival).toBeGreaterThan(index + 1);
      if (index > 0) expect(arrival).toBeGreaterThanOrEqual(frames[index - 1] ?? 0);
    });
  }
  // 80 ms plus at least part of a turn: no message arrives within 5 frames.
  expect(Math.min(...first.flat().map((arrival, index) => arrival - ((index % 600) + 1)))).toBeGreaterThanOrEqual(5);
});
