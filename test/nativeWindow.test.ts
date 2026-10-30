import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { WAKE_FRAME, openNativeWindow, windowLibraryPath } from "../host/window/binding";
import { standaloneWindowArgument } from "../host/play/standalone";

const hasDisplay = (process.env.WAYLAND_DISPLAY ?? process.env.DISPLAY) !== undefined && existsSync(windowLibraryPath());

test("[spec docs/play.md] --window picks chrome or the native window and leaves the other arguments", () => {
  expect(standaloneWindowArgument(["--script", "a.pad", "--window", "native", "--frames", "3"])).toEqual({ window: "native", rest: ["--script", "a.pad", "--frames", "3"] });
  expect(standaloneWindowArgument(["--frames", "3"])).toEqual({ rest: ["--frames", "3"] });
  expect(standaloneWindowArgument(["--window", "gl"])).toBe("--window needs chrome or native");
  expect(standaloneWindowArgument(["--window"])).toBe("--window needs chrome or native");
});

// winit builds one event loop per process, so a process opens one native window.
test.skipIf(!hasDisplay)("[spec docs/native-window-plan.md] a scene Bun never hands back counts as late, and closing the window mid-frame returns promptly with no wake after", async () => {
  const woken: string[] = [];
  const midFrame = Promise.withResolvers<void>();
  const window = openNativeWindow({
    title: "close mid-frame", width: 320, height: 200,
    onWake: (kind) => {
      woken.push(kind === WAKE_FRAME ? "frame" : "other");
      if (kind === WAKE_FRAME && woken.length === 4) midFrame.resolve();
    },
  });
  window.start();
  await midFrame.promise;
  expect(window.metric("lateScenes").some((late) => late === 1)).toBe(true);
  const began = performance.now();
  window.close();
  expect(performance.now() - began).toBeLessThan(1000);
  const count = woken.length;
  await Bun.sleep(100);
  expect(woken.length).toBe(count);
  expect(woken.every((kind) => kind === "frame")).toBe(true);
});
