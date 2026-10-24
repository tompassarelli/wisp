import { expect, test } from "bun:test";
import { CALLBACK_MS, MEASURED_RELAY, RELAY_CATCH_UP_STEP_MS, type RelayTiming, relayCallbacks, relayDelivery } from "./syncChannel";
import { f32 } from "../sim/f32";

const quantile = (values: readonly number[], q: number) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ?? 0;
};

const ages = (timing: RelayTiming, seed: number, frames: number, every = 1) => {
  const delivery = relayDelivery(timing, seed);
  const out: number[] = [];
  for (let frame = 1; frame <= frames; frame += every) for (const sender of [0, 1]) out.push(delivery.ageMs(sender, frame));
  return out;
};

test("[spec relay-bench --grid --rtts 120, 120 ms 2% independent] own echo p50/p99 is within 5% of the bench's 158.5/168.3 ms", () => {
  for (const seed of [1, 2, 3]) {
    const echo = ages(MEASURED_RELAY, seed, 36000, 15);
    expect(Math.abs(quantile(echo, 0.5) / 158.5 - 1)).toBeLessThan(0.05);
    expect(Math.abs(quantile(echo, 0.99) / 168.3 - 1)).toBeLessThan(0.05);
  }
});

test("[invariant] relay delivery is seeded, lands on the turn grid, keeps each sender's order and drops nothing", () => {
  expect(ages(MEASURED_RELAY, 3, 600)).toEqual(ages(MEASURED_RELAY, 3, 600));
  expect(ages(MEASURED_RELAY, 4, 600)).not.toEqual(ages(MEASURED_RELAY, 3, 600));
  for (const steps of [[8], [17, 17, 16]]) {
    const timing: RelayTiming = { ...MEASURED_RELAY, steps };
    const delivery = relayDelivery(timing, 5);
    const period = steps.reduce((sum, step) => sum + step, 0);
    const grid = steps.map((_, index) => steps.slice(0, index).reduce((sum, step) => sum + step, 0));
    const last = [0, 0];
    for (let frame = 1; frame <= 1200; frame++) {
      for (const sender of [0, 1]) {
        const arrivalMs = frame * CALLBACK_MS + delivery.ageMs(sender, frame);
        const within = ((arrivalMs % period) + period) % period;
        expect(grid.some((start) => Math.abs(within - start) < 1e-6 || Math.abs(within - start - period) < 1e-6)).toBe(true);
        expect(arrivalMs).toBeGreaterThanOrEqual(last[sender] ?? 0);
        last[sender] = arrivalMs;
        const frames = relayDelivery(timing, 5).arrivalFrame(sender, frame, { sender, prefix: "P", data: "" });
        expect(frames).toBeGreaterThan(frame);
      }
    }
  }
  expect(() => relayDelivery({ ...MEASURED_RELAY, links: [{ rttMs: 120, loss: 1, depthTurns: 4 }] })).toThrow();
  expect(() => relayDelivery({ ...MEASURED_RELAY, steps: [RELAY_CATCH_UP_STEP_MS] })).toThrow();
});

test("[invariant] relay callbacks stay even without an outage and never burst", () => {
  const timing = relayCallbacks();
  for (let frame = 0; frame <= 600; frame++) expect(timing.wallMs(frame)).toBeCloseTo(frame * CALLBACK_MS, 9);
});

test("[spec relay-bench --grid --rtts 120, 120 ms 1% + 1 s blackout] an outage freezes the game, catches up at 4 ms a turn within 5% of the bench's 897 ms, and delays the messages it cut off", () => {
  const outage = { atMs: 10000, lengthMs: 1000 };
  const timing: RelayTiming = { ...MEASURED_RELAY, links: [{ rttMs: 120, loss: f32(0.01), depthTurns: 3 }], outage };
  const callbacks = relayCallbacks(timing);
  const walls = Array.from({ length: 60 * 60 }, (_, frame) => callbacks.wallMs(frame));
  const gaps = walls.slice(1).map((wall, index) => wall - (walls[index] ?? 0));
  expect(Math.min(...gaps)).toBeGreaterThan(0);
  const freeze = gaps.indexOf(Math.max(...gaps));
  expect(Math.max(...gaps)).toBeGreaterThan(outage.lengthMs - 24);
  expect(Math.max(...gaps)).toBeLessThan(outage.lengthMs);
  const lag = (frame: number) => (walls[frame] ?? 0) - frame * CALLBACK_MS;
  let drained = freeze + 1;
  while (lag(drained + 1) < lag(drained) - 1e-9) drained++;
  expect(gaps[freeze + 1]).toBeCloseTo((CALLBACK_MS * RELAY_CATCH_UP_STEP_MS) / 8, 6);
  const catchUpMs = (walls[drained] ?? 0) + 60 + 24 - outage.atMs - outage.lengthMs;
  expect(Math.abs(catchUpMs / 897 - 1)).toBeLessThan(0.05);
  expect(lag(drained + 30 * 60 + 600)).toBeLessThan(lag(drained));
  const delivery = relayDelivery(timing, 1);
  const cut = Math.floor((outage.atMs - 200) / CALLBACK_MS);
  const late = Array.from({ length: 12 }, (_, index) => delivery.ageMs(0, cut + index));
  expect(Math.max(...late)).toBeGreaterThan(500);
});
