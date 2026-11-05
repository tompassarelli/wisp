import { expect, test } from "bun:test";
import * as nativeClock from "../src/game/native/clock";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { readNativeDeclarations } from "../host/headless/headless";

test("the native clock reads a binary32 span within rounding of whole frames as those frames, as 0.55 and 0.6 s fire on frames 33 and 36", () => {
  const client = new HeadlessClient({ screen: { width: 1920, height: 1080 }, slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "game-api", localNatives: {}, network: [] });
  const fired: string[] = [];
  bindWorld(client.world);
  for (const seconds of [0.55, 0.6, 0.555]) nativeClock.startTimer(nativeClock.createTimer(), Math.fround(seconds), false, () => { fired.push(`${seconds} ${client.frame}`); });
  bindWorld(undefined);
  for (let frame = 0; frame < 40; frame++) client.step(false);
  expect(fired).toEqual(["0.55 33", "0.555 34", "0.6 36"]);
});
