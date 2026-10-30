import { expect, test } from "bun:test";
import type { Frame } from "../host/os/platform/services";
import { changedPixels, pressLatencyArguments, response, type Sample } from "../host/play/pressLatency";

const frame = (width: number, height: number, lit: readonly (readonly [number, number])[] = []): Frame => {
  const rgb = new Uint8Array(width * height * 3);
  for (const [x, y] of lit) rgb.fill(255, (y * width + x) * 3, (y * width + x) * 3 + 3);
  return { width, height, rgb };
};

test("[spec docs/online-plan.md] a press's response is the first grab past the threshold, bracketed by the grab before it", () => {
  const still = frame(4, 4);
  const moved = frame(4, 4, [[1, 1], [2, 1], [3, 3]]);
  const region = { x: 0, y: 0, width: 3, height: 3 };
  expect(changedPixels(still, moved, region)).toBe(2);
  const ms = 1_000_000;
  const samples: Sample[] = [
    { frame: still, beforeNs: 20 * ms, afterNs: 36 * ms },
    { frame: still, beforeNs: 36 * ms, afterNs: 52 * ms },
    { frame: moved, beforeNs: 52 * ms, afterNs: 68 * ms },
  ];
  expect(response(samples, still, region, 1, 0, 16 * ms)).toEqual({ index: 2, changed: 2, lowerMs: 20, upperMs: 68 });
  expect(response(samples, still, region, 2, 0, 16 * ms)).toBeUndefined();
});

test("[spec docs/online-plan.md] the harness's flags name the window kind and both regions, or return the usage line", () => {
  const args = ["--window", "native", "--display", ":3", "--wayland-runtime", "/run/x", "--key", "j", "--region", "1,2,3,4", "--control", "5,6,7,8", "--out", "/tmp/o"];
  expect(pressLatencyArguments(args, {})).toMatchObject({ window: "native", region: { x: 1, y: 2, width: 3, height: 4 }, control: { x: 5, y: 6, width: 7, height: 8 }, trials: 30, grim: "grim" });
  expect(pressLatencyArguments(args.map((arg) => (arg === "native" ? "electron" : arg)), {})).toContain("--window chrome|warcraft|native");
  expect(pressLatencyArguments(args.map((arg) => (arg === "5,6,7,8" ? "5,6" : arg)), {})).toContain("--control");
});
