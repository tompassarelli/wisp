import { expect, test } from "bun:test";
import type { InputSample, WindowView } from "../host/window/binding";
import { type NativePlayer, createFrameLoop } from "../host/window/frameLoop";
import type { StandaloneFrame } from "../host/render/standaloneFrames";

const scene = {} as StandaloneFrame["scene"];

const fakeWindow = (metrics: Readonly<Record<string, readonly number[]>>, gpuTimingUnavailable?: string): WindowView => ({
  handle: 0, start: () => {}, startBaseline: () => {}, status: () => {}, selectPad: () => {}, nextEvent: () => ({ kind: "timeout" }),
  asset: () => {}, assetsPending: () => 0, setPresent: () => {}, setFullscreen: () => {}, submit: () => {},
  metric: (name) => Float64Array.from(metrics[name] ?? []),
  info: () => ({ adapter: "fake", backend: "Vulkan", presentMode: "Fifo", desiredMaximumFrameLatency: 1, imageCount: 3, ...(gpuTimingUnavailable === undefined ? {} : { gpuTimingUnavailable }) }),
  error: () => undefined, buttons: () => [], nowNs: () => 0,
});

const playerOf = (steps: readonly (Readonly<Record<string, number>> | undefined)[]): NativePlayer => {
  let step = 0;
  return {
    prepare: () => ({ scene, models: [], step: 0 }),
    advance: () => {
      const stages = steps[step];
      step++;
      return { scene, sounds: [], frame: step, step, capture: false, done: step === steps.length, serverMs: 0, ...(stages === undefined ? {} : { stages }) };
    },
    finish: async (result) => result,
  };
};

const sample = (frame: number) => ({ frame, sampleNs: 0, mask: 0, keys: [], axisX: 0, axisY: 0 }) as unknown as InputSample;

const run = (player: NativePlayer, window: WindowView, frames: number) => new Promise<Readonly<Record<string, unknown>>>((resolve) => {
  const loop = createFrameLoop(player, window, { scripted: true, startupMs: 0 }, resolve);
  for (let frame = 0; frame < frames; frame++) loop.step(sample(frame));
});

test("[spec docs/native-window-plan.md] the frame loop keeps one series per stage name a game returns and gives each a spread", async () => {
  const player = playerOf([{ tick: 1, scene: 4 }, { tick: 2, rollback: 9, scene: 5 }, { tick: 3, scene: 6 }, undefined]);
  const result = await run(player, fakeWindow({}), 4);
  expect(result.stageMs).toEqual({
    tick: { p50: 2, p95: 3, p99: 3, max: 3 },
    scene: { p50: 5, p95: 6, p99: 6, max: 6 },
    rollback: { p50: 9, p95: 9, p99: 9, max: 9 },
  });
});

test("[spec docs/native-window-plan.md] the result gives the GPU's time per pass that ran beside the CPU's encode time, and says why when there is none", async () => {
  const timed = await run(playerOf([undefined]), fakeWindow({ cpuEncodeMs: [0.4], gpuFrameMs: [2], gpuSceneMs: [1.5], gpuPostMs: [0.5] }), 1);
  expect(timed.cpuEncodeMs).toEqual({ p50: 0.4, p95: 0.4, p99: 0.4, max: 0.4 });
  expect(timed.gpuPassMs).toEqual({ frame: { p50: 2, p95: 2, p99: 2, max: 2 }, scene: { p50: 1.5, p95: 1.5, p99: 1.5, max: 1.5 }, post: { p50: 0.5, p95: 0.5, p99: 0.5, max: 0.5 } });
  expect(timed.gpuPassMsAbsent).toBeUndefined();

  const untimed = await run(playerOf([undefined]), fakeWindow({ gpuSceneMs: [1] }, "the adapter does not offer TIMESTAMP_QUERY"), 1);
  expect(untimed.gpuPassMs).toBeUndefined();
  expect(untimed.gpuPassMsAbsent).toBe("the adapter does not offer TIMESTAMP_QUERY");

  const lost = await run(playerOf([undefined]), fakeWindow({}), 1);
  expect(lost.gpuPassMs).toBeUndefined();
  expect(lost.gpuPassMsAbsent).toBe("no frame's timestamps came back from the GPU");
});
