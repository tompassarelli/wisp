import { expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import type { WindowEvent } from "../host/window/binding";
import { type ModelLibrary, endedBeforeStart, preloadAll } from "../host/window/drawScene";

const SURFACE_ERROR = "surface error: 9 tries in a row failed, the last at configure: forced surface failure (WISP_WINDOW_FORCE_SURFACE_FAILURE)";

const windowThat = (events: readonly WindowEvent["kind"][], error?: string) => {
  let polled = 0;
  return { nextEvent: (): WindowEvent => ({ kind: events[Math.min(polled++, events.length - 1)] as "timeout" }), error: () => error };
};

const neverLoads = { loading: () => 1, sequences: () => undefined, show: () => {} } as unknown as ModelLibrary;

test("[spec docs/native-window-plan.md] a preload stops with the window's surface error once the window fails, instead of waiting out its 120 s", async () => {
  const began = performance.now();
  const exit = await Effect.runPromiseExit(preloadAll({ preloadModels: ["a.mdx"] }, neverLoads, endedBeforeStart(windowThat(["timeout", "timeout", "failed"], SURFACE_ERROR))));
  expect(performance.now() - began).toBeLessThan(1000);
  expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain(SURFACE_ERROR);
});

test("[spec docs/native-window-plan.md] a window read before start is open while it times out, and names why it ended once it fails or closes", () => {
  expect(endedBeforeStart(windowThat(["timeout"]))()).toBeUndefined();
  expect(endedBeforeStart(windowThat(["failed"], SURFACE_ERROR))()).toBe(SURFACE_ERROR);
  expect(endedBeforeStart(windowThat(["failed"]))()).toBe("the window failed");
  expect(endedBeforeStart(windowThat(["closed"]))()).toBe("the window closed while the game loaded");
  expect(endedBeforeStart(windowThat(["stopped"]))()).toBe("the window closed while the game loaded");
});
