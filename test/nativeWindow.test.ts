import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { adoptNativeWindow, openNativeWindow, openWindowLibrary, windowLibraryPath } from "../host/window/binding";
import { standaloneWindowArgument } from "../host/play/standalone";

const hasDisplay = (process.env.WAYLAND_DISPLAY ?? process.env.DISPLAY) !== undefined && existsSync(windowLibraryPath());

test("[spec docs/play.md] --window picks chrome or the native window, native when absent, and leaves the other arguments", () => {
  expect(standaloneWindowArgument(["--script", "a.pad", "--window", "native", "--frames", "3"])).toEqual({ window: "native", rest: ["--script", "a.pad", "--frames", "3"] });
  expect(standaloneWindowArgument(["--frames", "3"])).toEqual({ window: "native", rest: ["--frames", "3"] });
  expect(standaloneWindowArgument(["--window", "chrome", "--frames", "3"])).toEqual({ window: "chrome", rest: ["--frames", "3"] });
  expect(standaloneWindowArgument(["--window", "gl"])).toBe("--window needs chrome or native");
  expect(standaloneWindowArgument(["--window"])).toBe("--window needs chrome or native");
});

// winit builds one event loop per process, so a process opens one native window.
test.skipIf(!hasDisplay)("[spec docs/native-window-plan.md] a scene Bun never hands back counts as late, and closing the window returns promptly and leaves a lent reference on a stopped host", () => {
  const window = openNativeWindow({ title: "close mid-frame", width: 320, height: 200 });
  const lent = adoptNativeWindow(window.lend());
  window.start();
  const anyLate = () => window.metric("lateScenes").some((late) => late === 1);
  let frames = 0;
  const giveUp = performance.now() + 4000;
  while (!anyLate() && performance.now() < giveUp) if (window.nextEvent(100).kind === "frame") frames++;
  expect(frames).toBeGreaterThan(0);
  expect(anyLate()).toBe(true);
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

test.skipIf(!hasDisplay)("[spec docs/native-window-plan.md] a surface that never configures ends the window as failed within seconds, with the surface error by name", async () => {
  const script = `import { openNativeWindow } from "./host/window/binding";
const window = openNativeWindow({ title: "forced surface failure", width: 320, height: 200 });
const began = performance.now();
let kind = "timeout";
while (kind === "timeout" && performance.now() - began < 20000) kind = window.nextEvent(500).kind;
console.log(JSON.stringify({ kind, error: window.error(), ms: Math.round(performance.now() - began) }));
window.close();`;
  const run = Bun.spawn([process.execPath, "-e", script], { cwd: join(import.meta.dir, ".."), env: { ...process.env, WISP_WINDOW_FORCE_SURFACE_FAILURE: "1" }, stdout: "pipe", stderr: "pipe" });
  const [out, status] = await Promise.all([new Response(run.stdout).text(), run.exited]);
  const ended = JSON.parse(out) as { kind: string; error: string; ms: number };
  expect(ended.kind).toBe("failed");
  expect(ended.error).toBe("surface error: 9 tries in a row failed, the last at configure: forced surface failure (WISP_WINDOW_FORCE_SURFACE_FAILURE)");
  expect(ended.ms).toBeLessThan(10000);
  expect(status).toBe(0);
}, 30000);

test.skipIf(!existsSync(windowLibraryPath()))("[spec docs/native-window-plan.md] the window library reports the window source it was built from, and one built from other source is refused before any call", () => {
  openWindowLibrary(windowLibraryPath(), { wisp_window_now_ns: { args: [], returns: "f64" } }).close();
  expect(() => openWindowLibrary(windowLibraryPath(), { wisp_window_now_ns: { args: [], returns: "f64" } }, "0000000000000000"))
    .toThrow(/was built from window source [0-9a-f]{16}, and this wisp's window\/ source is 0000000000000000/);
});
