import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { adoptNativeWindow, openNativeWindow, windowLibraryPath } from "../host/window/binding";
import { standaloneWindowArgument } from "../host/play/standalone";

const hasDisplay = (process.env.WAYLAND_DISPLAY ?? process.env.DISPLAY) !== undefined && existsSync(windowLibraryPath());

test("[spec docs/play.md] --window picks chrome or the native window and leaves the other arguments", () => {
  expect(standaloneWindowArgument(["--script", "a.pad", "--window", "native", "--frames", "3"])).toEqual({ window: "native", rest: ["--script", "a.pad", "--frames", "3"] });
  expect(standaloneWindowArgument(["--frames", "3"])).toEqual({ rest: ["--frames", "3"] });
  expect(standaloneWindowArgument(["--window", "gl"])).toBe("--window needs chrome or native");
  expect(standaloneWindowArgument(["--window"])).toBe("--window needs chrome or native");
});

// winit builds one event loop per process, so a process opens one native window.
test.skipIf(!hasDisplay)("[spec docs/native-window-plan.md] a scene Bun never hands back counts as late, and closing the window returns promptly and leaves a lent reference on a stopped host", () => {
  const window = openNativeWindow({ title: "close mid-frame", width: 320, height: 200 });
  const lent = adoptNativeWindow(window.lend());
  window.start();
  let frames = 0;
  for (let waits = 0; frames < 4 && waits < 20; waits++) if (window.nextEvent(500).kind === "frame") frames++;
  expect(frames).toBe(4);
  expect(window.metric("lateScenes").some((late) => late === 1)).toBe(true);
  const began = performance.now();
  window.close();
  expect(performance.now() - began).toBeLessThan(1000);
  expect(lent.nextEvent(0).kind).toBe("stopped");
  lent.submit("{}", 1, 99);
  expect(lent.metric("lateScenes").length).toBeGreaterThan(0);
  lent.release();
});

test.skipIf(!existsSync(windowLibraryPath()))("[spec docs/native-window-plan.md] a window that fails to open reaches the host as an error text", async () => {
  const script = `import { openNativeWindow } from "./host/window/binding";
try { openNativeWindow({ title: "forced failure", width: 320, height: 200 }); } catch (cause) { console.log(String(cause)); }`;
  const run = Bun.spawn([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: { ...process.env, WISP_WINDOW_FORCE_OPEN_FAILURE: "1" }, stdout: "pipe", stderr: "pipe" });
  const [out, status] = await Promise.all([new Response(run.stdout).text(), run.exited]);
  expect(out).toContain("the window didn't open: forced open failure");
  expect(status).toBe(0);
});
