import { expect, test } from "bun:test";
import type { InputSample, WindowView } from "../host/window/binding";
import { Effect } from "effect";
import { type FrameLoop, YIELD_EVERY_FRAMES, serveFrames } from "../host/window/frameLoop";

const fakeWindow = (metrics: Readonly<Record<string, readonly number[]>>, gpuTimingUnavailable?: string): WindowView => ({
  handle: 0, start: () => {}, startBaseline: () => {}, status: () => {}, selectPad: () => {}, nextEvent: () => ({ kind: "timeout" }),
  asset: () => {}, assetsPending: () => 0, setPresent: () => {}, setFullscreen: () => {}, submit: () => {},
  metric: (name) => Float64Array.from(metrics[name] ?? []),
  info: () => ({ adapter: "fake", backend: "Vulkan", presentMode: "Fifo", desiredMaximumFrameLatency: 1, imageCount: 3, ...(gpuTimingUnavailable === undefined ? {} : { gpuTimingUnavailable }) }),
  error: () => undefined, buttons: () => [], nowNs: () => 0,
});

const sample = (frame: number, width = 1280, height = 720) => ({ frame, sampleNs: 0, mask: 0, keys: [], axisX: 0, axisY: 0, pointer: { x: 0, y: 0, width, height, inside: false, held: 0, pressed: 0, released: 0 } }) as unknown as InputSample;

test("[spec docs/native-window-plan.md] a networked window's loop takes a turn every frame and collects after every YIELD_EVERY_FRAMES-th, between frames, as a local one does", async () => {
  const collectionsSeen = async (frames: number, networked: boolean) => {
    let stepped = 0, collections = 0, inStep = false;
    const between: boolean[] = [];
    const view = { ...fakeWindow({}), nextEvent: () => (stepped < frames ? { kind: "frame" as const, sample: sample(stepped) } : { kind: "stopped" as const }) };
    const loop: FrameLoop = { series: { wakes: [], steps: [], encodes: [], frames: [], intervals: [], stages: {} }, complete: () => {}, dispose: () => {}, step: () => { inStep = true; stepped++; inStep = false; } };
    expect(await Effect.runPromise(serveFrames(view, loop, Promise.resolve(), networked, () => false, () => { collections++; between.push(!inStep); }))).toBe("ended");
    return { collections, between: between.every(Boolean) };
  };
  expect(await collectionsSeen(YIELD_EVERY_FRAMES * 3, true)).toEqual({ collections: 3, between: true });
  expect(await collectionsSeen(YIELD_EVERY_FRAMES * 3, false)).toEqual({ collections: 3, between: true });
  expect(await collectionsSeen(YIELD_EVERY_FRAMES - 1, true)).toEqual({ collections: 0, between: true });
});
