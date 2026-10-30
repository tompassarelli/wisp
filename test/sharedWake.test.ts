import { expect, test } from "bun:test";
import { type Wake, publishWake, stopWakes, takeWakes, wakeBox } from "../host/window/sharedWake";

test("[spec docs/native-window-plan.md] a wake's numbers reach the stepping thread, and a stop is acknowledged only after its last wake", async () => {
  const box = wakeBox();
  const taken: Wake[] = [];
  const order: string[] = [];
  publishWake(box, 0, 7, 12.5, 0b101, 13.25);
  expect(stopWakes(box, 1)).toBe(false);
  const finished = takeWakes(box, (wake) => { taken.push(wake); order.push("wake"); }, () => order.push(stopWakes(box, 1) ? "acknowledged early" : "before acknowledging"));
  await finished;
  expect(taken).toEqual([]);
  expect(order).toEqual(["before acknowledging"]);
  expect(stopWakes(box, 1)).toBe(true);

  const live = wakeBox();
  publishWake(live, 0, 7, 12.5, 0b101, 13.25);
  const seen: Wake[] = [];
  await takeWakes(live, (wake) => { seen.push(wake); stopWakes(live, 1); }, () => undefined);
  expect(seen).toEqual([{ kind: 0, frame: 7, sampleNs: 12.5, mask: 0b101, handledNs: 13.25 }]);
});
