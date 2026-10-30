import { expect, test } from "bun:test";
import { Weathers } from "./weather";
import type { Handle } from "./clientTypes";

const fourCC = (id: string) => [...id].reduce((total, letter) => total * 256 + letter.charCodeAt(0), 0);

test("a weather effect reaches the scene until it is disabled or removed", () => {
  let next = 0;
  const weathers = new Weathers();
  const natives = weathers.behaviors({ handle: () => ({ id: ++next }) as unknown as Handle }) as Record<string, (...args: unknown[]) => unknown>;
  const rect = { minX: -8192, minY: -6144, maxX: 8192, maxY: 10240 };
  const blizzard = natives.AddWeatherEffect?.(rect, fourCC("SNbs"));
  const moon = natives.AddWeatherEffect?.(rect, fourCC("LRma"));
  expect(weathers.poses().map((pose) => pose.id)).toEqual(["SNbs", "LRma"]);
  expect(weathers.poses()[0]?.rect).toEqual([-8192, -6144, 8192, 10240]);
  natives.EnableWeatherEffect?.(blizzard, false);
  expect(weathers.poses().map((pose) => pose.id)).toEqual(["LRma"]);
  natives.EnableWeatherEffect?.(blizzard, true);
  natives.RemoveWeatherEffect?.(moon);
  expect(weathers.poses().map((pose) => pose.id)).toEqual(["SNbs"]);
});
