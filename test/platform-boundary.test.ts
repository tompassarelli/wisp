import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";

const root = join(import.meta.dir, "..");

const LINUX_ONLY: readonly (readonly [string, RegExp])[] = [
  ["/proc", /["'`]\/proc\b/],
  ["cgroup files", /\/sys\/fs\/cgroup/],
  ["a Linux tool", /["'`](nsenter|wine|wine64|wineserver|grim|xdotool|wlrctl|systemd-run|systemctl|steam-run|pw-cli|pw-dump|niri|dbus-run-session|bwrap)["'`]/],
  ["a configured Linux tool", /\b(?:tools|config\.tools|client\.tools)\.(grim|xdotool|wlrctl|nsenter|niri)\b/],
  ["Wine's binary", /bin\/wine\b/],
  ["Wine's runtime", /\/wineserver\b/],
  ["Proton", /\/proton\b/],
  ["a user runtime directory", /\/run\/user\//],
  ["a Wayland display", /WAYLAND_DISPLAY/],
  ["libc", /libc\.so/],
  ["a platform branch", /process\.platform/],
];

const ALLOWED = [/^scripts\/platform\/linux\//, /^scripts\/platform\/layer\.ts$/];

const sources = () => [...new Bun.Glob("{scripts,src,examples,plugins}/**/*.ts").scanSync({ cwd: root })]
  .map((path) => path.replaceAll("\\", "/"))
  .filter((path) => !/\.tests?\.ts$/.test(path) && !ALLOWED.some((allowed) => allowed.test(path)));

export const directUses = (files: readonly string[], read: (path: string) => string = (path) => readFileSync(join(root, path), "utf8")) =>
  files.flatMap((path) => read(path).split("\n").flatMap((line, index) =>
    LINUX_ONLY.filter(([, pattern]) => pattern.test(line)).map(([what]) => `${path}:${index + 1}: ${what} outside a Linux layer`)));

test("[invariant] no Linux-specific call sits outside scripts/platform/linux", () => {
  expect(directUses(sources())).toEqual([]);
});

const failure = <A, E>(effect: Effect.Effect<A, E, never>) => {
  const exit = Effect.runSyncExit(effect);
  if (!Exit.isFailure(exit)) throw new Error("expected a failure");
  return String(exit.cause);
};
