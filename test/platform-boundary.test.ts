import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Effect, Exit } from "effect";
import { platformLayer } from "../scripts/platform/layer";
import { BackgroundServices, GameLauncher, InputInjection, Namespaces, ProcessTable, ResourceAccounting, ScreenCapture } from "../scripts/platform/services";
import { capture } from "../scripts/warcraft/desktop";
import { cliProgram } from "../scripts/wisp/cli";
import { playMachineLayer } from "../scripts/wisp/playHost";
import { PlayMachine } from "../scripts/wisp/play";

const root = join(import.meta.dir, "..");

const LINUX_ONLY: readonly (readonly [string, RegExp])[] = [
  ["/proc", /["'`]\/proc\b/],
  ["cgroup files", /\/sys\/fs\/cgroup/],
  ["a Linux tool", /["'`](nsenter|wine|wine64|grim|xdotool|wlrctl|systemd-run|systemctl|steam-run|pw-cli|pw-dump|niri|dbus-run-session|bwrap)["'`]/],
  ["a configured Linux tool", /\b(?:tools|config\.tools|client\.tools)\.(grim|xdotool|wlrctl|nsenter|niri)\b/],
  ["Wine's binary", /bin\/wine\b/],
  ["Proton", /\/proton\b/],
  ["a user runtime directory", /\/run\/user\//],
  ["a Wayland display", /WAYLAND_DISPLAY/],
  ["libc", /libc\.so/],
  ["a platform branch", /process\.platform/],
];

const ALLOWED = [/^scripts\/platform\/linux\//, /^scripts\/platform\/layer\.ts$/];

const sources = () => [...new Bun.Glob("{scripts,src,examples,plugins}/**/*.ts").scanSync({ cwd: root })]
  .filter((path) => !/\.tests?\.ts$/.test(path) && !ALLOWED.some((allowed) => allowed.test(path)));

export const directUses = (files: readonly string[], read: (path: string) => string = (path) => readFileSync(join(root, path), "utf8")) =>
  files.flatMap((path) => read(path).split("\n").flatMap((line, index) =>
    LINUX_ONLY.filter(([, pattern]) => pattern.test(line)).map(([what]) => `${path}:${index + 1}: ${what} outside a Linux layer`)));

test("[invariant] no Linux-specific call sits outside scripts/platform/linux", () => {
  expect(directUses(sources())).toEqual([]);
});

test("[invariant] the guard catches a new direct use of /proc, xdotool or a platform branch", () => {
  const planted: Record<string, string> = {
    "scripts/wisp/a.ts": "const status = readFileSync(`/proc/${pid}/status`);",
    "scripts/wisp/b.ts": "run([client.tools.xdotool, \"key\", \"Return\"]);",
    "scripts/wisp/c.ts": "if (process.platform === \"win32\") return;",
  };
  expect(directUses(Object.keys(planted), (path) => planted[path] ?? "")).toEqual([
    "scripts/wisp/a.ts:1: /proc outside a Linux layer",
    "scripts/wisp/b.ts:1: a configured Linux tool outside a Linux layer",
    "scripts/wisp/c.ts:1: a platform branch outside a Linux layer",
  ]);
  expect(relative(root, join(root, "scripts/platform/linux/procfs.ts"))).toMatch(ALLOWED[0]!);
});

const windows = platformLayer("win32");

const failure = <A, E>(effect: Effect.Effect<A, E, never>) => {
  const exit = Effect.runSyncExit(effect);
  if (!Exit.isFailure(exit)) throw new Error("expected a failure");
  return String(exit.cause);
};

test("[invariant] each capability without an implementation fails with a named not-supported error on Windows", () => {
  const on = <A, E>(effect: Effect.Effect<A, E, ProcessTable | BackgroundServices | GameLauncher | Namespaces>) => failure(effect.pipe(Effect.provide(windows)));
  expect(on(ProcessTable.use((table) => table.list))).toContain("process discovery is not supported on this platform (win32)");
  expect(on(BackgroundServices.use((services) => services.start("unit", ["true"])))).toContain("background services is not supported on this platform (win32)");
  expect(on(GameLauncher.use((launcher) => launcher.inPrefix({ root: "/r", exe: "C:\\x.exe", args: [], appId: "1" })))).toContain("game launch is not supported on this platform (win32)");
  expect(on(Namespaces.use((namespaces) => namespaces.enter(1, ["net"], ["true"])))).toContain("process namespaces is not supported on this platform (win32)");
  const client = { name: "a", documents: "/d", tools: { grim: "", xdotool: "", wlrctl: "", tesseract: "" }, x11: {}, wayland: {}, window: "1" };
  expect(failure(capture(client).pipe(Effect.provide(windows)))).toContain("screen capture is not supported on this platform (win32)");
  expect(failure(InputInjection.use((input) => input.keys(client, ["a"])).pipe(Effect.provide(windows)))).toContain("input injection is not supported on this platform (win32)");
  expect(failure(ScreenCapture.use((screen) => screen.frame(client)).pipe(Effect.provide(windows)))).toContain("not supported on this platform");
  expect(failure(Effect.scoped(PlayMachine.use((machine) => machine.processes).pipe(Effect.provide(playMachineLayer({}, "win32")))))).toContain("playing on the owner's desktop is not supported on this platform (win32)");
});

test("[invariant] accounting reads without an implementation report nothing instead of failing", () => {
  const accounting = Effect.runSync(ResourceAccounting.use(Effect.succeed).pipe(Effect.provide(windows)));
  expect([accounting.cpuPressure(), accounting.cpuLimit(), accounting.insideCapacityLease(), accounting.childCpuSeconds()]).toEqual([undefined, undefined, false, undefined]);
  expect(accounting.threadCpuMillis()).toBeGreaterThan(0);
});

test("[invariant] a command that needs a missing capability prints its not-supported line and exits 1", async () => {
  const printed: string[] = [];
  const commands = { processes: { usage: "", load: async () => () => ProcessTable.use((table) => table.list).pipe(Effect.asVoid) } };
  expect(await Effect.runPromise(cliProgram("wisp", commands, ["processes"], (line) => printed.push(line), windows))).toBe(1);
  expect(printed.at(-1)).toBe("process discovery is not supported on this platform (win32)");
});
