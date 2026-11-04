import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber } from "effect";
import type { Frame } from "../host/contract/services";
import { checkArguments, referenceErrors } from "../host/play/latencyReference";
import { decodePressRun, latencyReport } from "../host/play/latencyComparison";
import { changeWatch, changedPixels, displayFrameMs, followRow, framePeriodMs, response, shown, type Sample } from "../host/play/grabBrackets";
import { pressLatencyArguments, pressResult, pressToSample, windowShare } from "../host/play/pressLatency";
import { openSampleLog, parseSampleLog } from "../host/window/sampleLog";
import { monotonicNs } from "../host/os/platform/linux/monotonic";
import { Reader, displaySocket, fakeKey, keycodeOf, keysymOf, queryExtension } from "../host/play/xtest";

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

test("[spec docs/native-window-plan.md] the window's share runs from the logged sample that carried the press to the middle of the bracket the change appeared in", () => {
  const edges = parseSampleLog('{"sampleNs":40000000,"mask":1,"pressed":true}\n{"sampleNs":90000000,"mask":0,"pressed":false}\n');
  expect(windowShare(edges, 36 * ms, { lowerMs: 8, upperMs: 24 })).toBe(12);
  expect(windowShare(edges, 41 * ms, { lowerMs: 8, upperMs: 24 })).toBeUndefined();
  expect(windowShare([], 36 * ms, { lowerMs: 8, upperMs: 24 })).toBeUndefined();
});

test("[spec docs/native-window-plan.md] latency.json carries the Warcraft run only when one was given", () => {
  const run = { window: "native", trials: 100, responded: 97, pressMs: { p50: 30, p95: 41 } };
  const warcraft = { window: "warcraft", trials: 100, responded: 90, pressMs: { p50: 97, p95: 120 } };
  expect(latencyReport(run, undefined)).toEqual(run);
  expect(latencyReport(run, warcraft)).toEqual({ ...run, warcraft });
  expect(decodePressRun({ ...warcraft, rows: [] })).toEqual(warcraft);
  expect(() => decodePressRun({ window: "warcraft" })).toThrow();
});

test("the X reader hands consecutive reads consecutive bytes when one chunk answers both", async () => {
  const reader = new Reader();
  const reads = Effect.runFork(Effect.gen(function*() {
    const head = yield* reader.take(2);
    const rest = yield* reader.take(2);
    return [...head, ...rest];
  }));
  reader.push(Uint8Array.of(1, 2, 3, 4));
  expect(await Effect.runPromise(Fiber.join(reads))).toEqual([1, 2, 3, 4]);
});

test("the sample log records a keyboard press, which leaves the pad mask unchanged, as a press", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sample-log-")), "samples.jsonl");
  const record = openSampleLog(path, { nowNs: () => 0 });
  const key = (down: boolean) => ({ key: 74, meta: 0, down });
  record({ sampleNs: 10, mask: 0, keys: [] });
  record({ sampleNs: 20, mask: 0, keys: [key(true)] });
  record({ sampleNs: 30, mask: 0, keys: [key(false)] });
  record({ sampleNs: 40, mask: 2, keys: [] });
  record({ sampleNs: 50, mask: 0, keys: [] });
  expect(parseSampleLog(readFileSync(path, "utf8")).map(({ mask, pressed }) => ({ mask, pressed }))).toEqual([
    { mask: 0, pressed: true }, { mask: 0, pressed: false }, { mask: 2, pressed: true }, { mask: 0, pressed: false },
  ]);
});

test("[boundary] a worker reads the same monotonic clock as the process that started it, so the window's stamps compare with the harness's", async () => {
  const before = monotonicNs();
  const worker = new Worker(URL.createObjectURL(new Blob([`import { monotonicNs } from ${JSON.stringify(join(import.meta.dir, "../host/os/platform/linux/monotonic.ts"))}; postMessage(monotonicNs());`], { type: "text/javascript" })));
  const inWorker = await new Promise<number>((resolve) => { worker.onmessage = (event) => resolve(event.data as number); });
  worker.terminate();
  expect(inWorker).toBeGreaterThanOrEqual(before);
  expect(inWorker).toBeLessThanOrEqual(monotonicNs());
});

test("[spec docs/online-plan.md] flash mode needs no control region, and the press-to-sample wait is the first logged press at or after the press", () => {
  const args = ["--window", "native", "--display", ":3", "--wayland-runtime", "/run/x", "--key", "j", "--region", "1,2,30,30", "--flash", "--out", "/tmp/o", "--input-delay-frames", "1"];
  expect(pressLatencyArguments(args, {})).toMatchObject({ flash: true, control: undefined, inputDelayFrames: 1, trials: 30 });
  expect(typeof pressLatencyArguments(args.filter((arg) => arg !== "--flash"), {})).toBe("string");
  expect(typeof pressLatencyArguments([...args, "--input-delay-frames", "x"], {})).toBe("string");
  const edges = parseSampleLog('{"sampleNs":40000000,"mask":1,"pressed":true}\n');
  expect(pressToSample(edges, 36 * ms)).toBe(4);
  expect(pressToSample(edges, 41 * ms)).toBeUndefined();
});

test("[spec docs/online-plan.md] a follow region is timed in the flash's own grabs, so its lag is counted in display frames from the grab the flash appeared in", () => {
  const flashRegion = { x: 0, y: 0, width: 2, height: 2 };
  const follow = { x: 2, y: 2, width: 2, height: 2 };
  const lit = (x: number, y: number) => [[x, y]] as const;
  const frames = [frame(4, 4), frame(4, 4), frame(4, 4, [...lit(1, 1)]), frame(4, 4, [...lit(1, 1)]), frame(4, 4, [...lit(1, 1), ...lit(3, 3)])];
  const grabs: Sample[] = frames.map((f, index) => ({ frame: f, beforeNs: (index * 16 + 1) * ms, afterNs: (index + 1) * 16 * ms }));
  const flash = response(grabs, flashRegion, 0, 20 * ms)!;
  expect(flash).toMatchObject({ reference: 0, index: 2 });
  const lag = (threshold: number) => followRow(grabs, follow, flash, 20 * ms, 16, threshold);
  expect(lag(0)).toEqual({ threshold: 0, flashGrab: 2, pressMs: 52, framesAfterFlash: 2, changedByGrab: [0, 0, 0, 1] });
  expect(lag(1).pressMs).toBeUndefined();
});

test("[spec docs/online-plan.md] a run with more than 2% of its trials uncounted is refused as a censored sample, with no median over the survivors", () => {
  const countedRow = { idleChanged: 0, threshold: 100, changed: 16900, frameMs: 16.7, pressWriteMs: 0.14, pressMs: 34.8, windowShareMs: 24.4, pressToSampleMs: 10.4, baselineMs: 326, quietWaits: 0, watchMs: 192, settledMs: 1000, trialMs: 1521, lowerMs: 16.4, upperMs: 53.1, bracketMs: 36.7, skippedFrames: 0, controlChanged: undefined, follow: undefined };
  const missedRow = { ...countedRow, pressMs: undefined, windowShareMs: undefined, pressToSampleMs: undefined, lowerMs: undefined, upperMs: undefined, bracketMs: 30.8, skippedFrames: 1 };
  const options = pressLatencyArguments(["--window", "native", "--display", ":1", "--wayland-runtime", "/run/x", "--key", "n", "--region", "1,2,30,30", "--flash", "--out", "/tmp/o"], {});
  if (typeof options === "string") throw new Error(options);
  const run = (missed: number) => Effect.runSync(pressResult(options, [...Array(100 - missed).fill(countedRow), ...Array(missed).fill(missedRow)]).pipe(
    Effect.match({ onFailure: (refused) => refused.message, onSuccess: (report) => `p50 ${report.pressMs.p50}` })));
  expect(run(20)).toBe("20 of 100 trials missed: result invalid: censored sample");
  expect(run(2)).toBe("p50 34.8");
  expect(run(3)).toBe("3 of 100 trials missed: result invalid: censored sample");
});

test("[spec docs/online-plan.md] the stop test finds the same grab as the bracket, checking each grab once", () => {
  const grabs = samples(false, false, false, true, true);
  const watch = changeWatch(region, 1);
  expect(watch(grabs.slice(0, 3), 40 * ms)).toBe(false);
  expect(watch(grabs.slice(0, 3), undefined)).toBe(false);
  expect(watch(grabs.slice(0, 4), 40 * ms)).toBe(true);
  expect(changeWatch(region, 2)(grabs, 40 * ms)).toBe(false);
});

test("[spec docs/online-plan.md] a two-vblank bracket the harness waited through is a skipped vblank counted on its answering frame; one it paused across is uncounted", () => {
  const grabs = samples(false, false, true);
  const waited = grabs.map((sample, index) => (index === 2 ? { ...sample, beforeNs: grabs[1]!.afterNs + 0.1 * ms, afterNs: sample.afterNs + 16 * ms } : sample));
  const found = response(waited, region, 1, 33 * ms)!;
  expect(found.bracketMs).toBe(32);
  expect(shown(waited, found, 16)).toEqual({ lowerMs: 15, upperMs: 31, skippedVblanks: 1 });
  const paused = waited.map((sample, index) => (index === 2 ? { ...sample, beforeNs: sample.beforeNs + 10 * ms } : sample));
  expect(shown(paused, response(paused, region, 1, 33 * ms)!, 16)).toBeUndefined();
  expect(shown(grabs, response(grabs, region, 1, 33 * ms)!, 16)).toEqual({ lowerMs: 0, upperMs: 15, skippedVblanks: 0 });
  expect(displayFrameMs(waited)).toBe(16);
});
