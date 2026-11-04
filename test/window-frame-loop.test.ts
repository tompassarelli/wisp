import { expect, test } from "bun:test";
import type { InputSample, WindowView } from "../host/window/binding";
import { Effect } from "effect";
import { type FrameLoop, type NativePlayer, YIELD_EVERY_FRAMES, createFrameLoop, serveFrames } from "../host/window/frameLoop";
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

const sample = (frame: number, width = 1280, height = 720) => ({ frame, sampleNs: 0, mask: 0, keys: [], axisX: 0, axisY: 0, pointer: { x: 0, y: 0, width, height, inside: false, held: 0, pressed: 0, released: 0 } }) as unknown as InputSample;

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

test("[spec docs/native-window-plan.md] every step hands the game the window's size as its screen, in a scripted run and a played one, and a resize reaches the next step", async () => {
  for (const scripted of [true, false]) {
    const screens: unknown[] = [];
    const player: NativePlayer = { ...playerOf([]), advance: (input) => { screens.push(input.screen); return { scene, sounds: [], frame: screens.length, step: screens.length, capture: false, done: false, serverMs: 0 }; } };
    const loop = createFrameLoop(player, fakeWindow({}), { scripted, startupMs: 0 }, () => {});
    loop.step(sample(0, 1600, 900));
    loop.step(sample(1, 1280, 960));
    expect(screens).toEqual([{ width: 1600, height: 900 }, { width: 1280, height: 960 }]);
  }
});

test("[spec docs/native-window-plan.md] warmup frames are left out of the step, stage and render figures, so loading does not reach a run's spreads", async () => {
  const metrics: Record<string, number[]> = { cpuEncodeMs: [], gpuFrameMs: [] };
  const window = { ...fakeWindow({}), metric: (name: string) => Float64Array.from(metrics[name] ?? []) };
  const player = playerOf([{ sim: 90 }, { sim: 80 }, { sim: 2 }, { sim: 3 }]);
  const result = await new Promise<Readonly<Record<string, unknown>>>((resolve) => {
    const loop = createFrameLoop(player, window, { scripted: true, startupMs: 0, warmupFrames: 2 }, resolve);
    for (let frame = 0; frame < 4; frame++) {
      loop.step(sample(frame));
      metrics.cpuEncodeMs!.push(frame < 2 ? 50 : 1);
      metrics.gpuFrameMs!.push(frame < 2 ? 40 : 2);
    }
  });
  expect(result.warmupFrames).toBe(2);
  expect(result.frames).toBe(4);
  expect(result.stageMs).toEqual({ sim: { p50: 2, p95: 3, p99: 3, max: 3 } });
  expect(result.cpuEncodeMs).toEqual({ p50: 1, p95: 1, p99: 1, max: 1 });
  expect(result.gpuPassMs).toEqual({ frame: { p50: 2, p95: 2, p99: 2, max: 2 } });
});

test("[spec docs/native-window-plan.md] a local window's loop takes an event-loop turn only every YIELD_EVERY_FRAMES frames, and on every frame while a read is in flight", async () => {
  const turnsSeen = async (frames: number, reading: (frame: number) => boolean) => {
    let turns = 0, stepped = 0, live = true;
    const tick = () => { turns++; if (live) setImmediate(tick); };
    setImmediate(tick);
    const seen: number[] = [];
    const view = { ...fakeWindow({}), nextEvent: () => (stepped < frames ? { kind: "frame" as const, sample: sample(stepped) } : { kind: "stopped" as const }) };
    const loop: FrameLoop = { series: { wakes: [], steps: [], encodes: [], frames: [], intervals: [], stages: {} }, complete: () => {}, dispose: () => {}, step: () => { seen.push(turns); stepped++; } };
    expect(await Effect.runPromise(serveFrames(view, loop, Promise.resolve(), false, () => reading(stepped)))).toBe("ended");
    live = false;
    return new Set(seen).size;
  };
  expect(await turnsSeen(YIELD_EVERY_FRAMES * 3, () => false)).toBe(3);
  expect(await turnsSeen(YIELD_EVERY_FRAMES, () => true)).toBe(YIELD_EVERY_FRAMES);
});

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
