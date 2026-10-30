import { expect, test } from "bun:test";
import type { Frame } from "../host/contract/services";
import { checkArguments, referenceErrors } from "../host/play/latencyReference";
import { changedPixels, framePeriodMs, pressLatencyArguments, response, type Sample } from "../host/play/pressLatency";
import { displaySocket, fakeKey, keycodeOf, keysymOf, queryExtension } from "../host/play/xtest";

const frame = (width: number, height: number, lit: readonly (readonly [number, number])[] = []): Frame => {
  const rgb = new Uint8Array(width * height * 3);
  for (const [x, y] of lit) rgb.fill(255, (y * width + x) * 3, (y * width + x) * 3 + 3);
  return { width, height, rgb };
};

const ms = 1_000_000;
const still = frame(4, 4);
const moved = frame(4, 4, [[1, 1], [2, 1], [3, 3]]);
const region = { x: 0, y: 0, width: 3, height: 3 };
const samples = (...changedAt: readonly boolean[]): Sample[] => changedAt.map((changed, index) => ({ frame: changed ? moved : still, beforeNs: (index * 16 + 1) * ms, afterNs: (index + 1) * 16 * ms }));

test("[spec docs/online-plan.md] a press's response is the first grab drawn after it past the threshold, bracketed by the grab before it", () => {
  expect(changedPixels(still, moved, region)).toBe(2);
  const grabs = samples(false, false, false, true, true);
  expect(response(grabs, region, 1, 40 * ms)).toEqual({ reference: 1, index: 3, changed: 2, lowerMs: 8, upperMs: 24, bracketMs: 16 });
  expect(response(grabs, region, 2, 40 * ms)).toBeUndefined();
  expect(framePeriodMs(grabs)).toBe(16);
});

test("[spec docs/online-plan.md] a press during a grab's frame is answered by the next grab: the grab already ending was drawn before it", () => {
  const grabs = samples(false, false, true);
  expect(response(grabs, region, 1, 31 * ms)).toMatchObject({ reference: 0, index: 2, lowerMs: 1, upperMs: 17, bracketMs: 16 });
  expect(response(grabs, region, 1, 5 * ms)).toBeUndefined();
});

test("[spec docs/online-plan.md] a grab the harness missed widens the bracket to the frames between the two stamps", () => {
  const grabs = samples(false, false, true).map((sample, index) => (index === 2 ? { ...sample, afterNs: sample.afterNs + 16 * ms } : sample));
  expect(response(grabs, region, 1, 33 * ms)?.bracketMs).toBe(32);
});

test("[spec docs/online-plan.md] the method's error is the delayed median's gap from the undelayed one, less the frames the reference page added", () => {
  const delays = [
    { frames: 0, periodMs: 16.4, upperP50Ms: 40, responded: 30 },
    { frames: 4, periodMs: 16.4, upperP50Ms: 106, responded: 30 },
    { frames: 8, periodMs: 16.6, upperP50Ms: 169, responded: 30 },
  ];
  const [four, eight] = referenceErrors(delays);
  expect(four).toMatchObject({ frames: 4, knownMs: 65.6, measuredMs: 66 });
  expect(four!.errorMs).toBeCloseTo(0.4);
  expect(eight!.errorMs).toBeCloseTo(129 - 8 * 16.5);
  expect(referenceErrors(delays.slice(1))).toEqual([]);
});

test("[spec docs/online-plan.md] the harness's flags name the window kind and both regions, or return the usage line", () => {
  const args = ["--window", "native", "--display", ":3", "--wayland-runtime", "/run/x", "--key", "j", "--region", "1,2,3,4", "--control", "5,6,7,8", "--out", "/tmp/o"];
  expect(pressLatencyArguments(args, {})).toMatchObject({ window: "native", region: { x: 1, y: 2, width: 3, height: 4 }, control: { x: 5, y: 6, width: 7, height: 8 }, trials: 30, grim: "grim" });
  expect(typeof pressLatencyArguments(args.map((arg) => (arg === "native" ? "electron" : arg)), {})).toBe("string");
  expect(typeof pressLatencyArguments(args.map((arg) => (arg === "5,6,7,8" ? "5,6" : arg)), {})).toBe("string");
  expect(checkArguments(["--check", "--display", ":3", "--wayland-runtime", "/run/x", "--out", "/o", "--trials", "12"], { GRIM: "/g" })).toEqual({ display: ":3", waylandRuntime: "/run/x", out: "/o", trials: 12, settleMs: 1500, grim: "/g" });
  expect(typeof checkArguments(["--check", "--display", ":3"], {})).toBe("string");
});

test("[spec docs/online-plan.md] a key press is one XTEST FakeInput request at a known instant, so no process start adds doubt about when it went down", () => {
  expect(displaySocket(":4")).toBe("/tmp/.X11-unix/X4");
  expect(displaySocket(":12.0")).toBe("/tmp/.X11-unix/X12");
  expect(displaySocket("localhost:0")).toBeUndefined();
  expect([keysymOf("j"), keysymOf("space"), keysymOf("0x6a"), keysymOf("nonsense")]).toEqual([0x6a, 0x20, 0x6a, undefined]);
  const press = fakeKey(131, 44, true);
  expect([press.length, press[0], press[1], press[2], press[3], press[4], press[5]]).toEqual([36, 131, 2, 9, 0, 2, 44]);
  expect(fakeKey(131, 44, false)[4]).toBe(3);
  const query = queryExtension("XTEST");
  expect([query.length, query[0], query[2], query[4]]).toEqual([16, 98, 4, 5]);
  expect(keycodeOf(0x6a, 8, 2, Uint32Array.of(0, 0, 0x61, 0x41, 0x6a, 0x4a))).toBe(10);
  expect(keycodeOf(0x7a, 8, 2, Uint32Array.of(0, 0, 0x61, 0x41))).toBeUndefined();
});
