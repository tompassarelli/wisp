import { expect, test } from "bun:test";
import { MEASURED_BATTLE_NET, syncDelivery } from "../src/headless/syncChannel";


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
