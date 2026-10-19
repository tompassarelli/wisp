import { expect, test } from "bun:test";
import { CALLBACK_MS, MEASURED_BATTLE_NET, MEASURED_TURN_BURSTS, syncDelivery, turnBursts } from "../src/headless/syncChannel";

test("[invariant] delivery is seeded, later than the send, and keeps each sender's order", () => {
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

  expect(Math.min(...first.flat().map((arrival, index) => arrival - ((index % 600) + 1)))).toBeGreaterThanOrEqual(5);
});

test("[property seeds 1-3] turn bursts group 60 Hz callbacks into 25 ms turns of one or two, keep wall time on game time, and give each second's longest callback gap the measured Battle.net spread", () => {
  const seconds = 600;
  const timings = (seed: number) => {
    const timing = turnBursts(MEASURED_TURN_BURSTS, seed);
    return Array.from({ length: seconds * 60 + 1 }, (_, frame) => timing.wallMs(frame));
  };
  expect(timings(1)).toEqual(timings(1));
  expect(timings(2)).not.toEqual(timings(1));
  for (const seed of [1, 2, 3]) {
    const walls = timings(seed);
    const sizes: number[] = [];
    const longest: number[] = [];
    let drift = 0;
    for (let frame = 1; frame < walls.length; frame++) {
      const gap = (walls[frame] ?? 0) - (walls[frame - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(0);
      if (gap > 0 || frame === 1) sizes.push(1);
      else sizes[sizes.length - 1] = (sizes.at(-1) ?? 0) + 1;
      const second = Math.floor((frame - 1) / 60);
      if ((frame - 1) % 60 !== 0) longest[second] = Math.max(longest[second] ?? 0, gap);
      drift += (walls[frame] ?? 0) - frame * CALLBACK_MS;
    }
    expect(Math.abs(drift / (walls.length - 1))).toBeLessThan(1);
    expect(sizes.length / seconds).toBeGreaterThan(38);
    expect(sizes.length / seconds).toBeLessThanOrEqual(40);
    expect(sizes.filter((size) => size <= 2).length / sizes.length).toBeGreaterThan(0.99);
    const sorted = longest.toSorted((a, b) => a - b);
    const quantile = (q: number) => sorted[Math.floor(q * sorted.length)] ?? 0;
    expect(quantile(0.1)).toBeGreaterThan(31);
    expect(quantile(0.1)).toBeLessThan(35);
    expect(quantile(0.5)).toBeGreaterThan(34);
    expect(quantile(0.5)).toBeLessThan(38);
    expect(quantile(0.9)).toBeGreaterThan(39);
    expect(quantile(0.9)).toBeLessThan(52);
    expect(quantile(0.99)).toBeGreaterThan(80);
  }
});
