// One pool pair's session (wisp:docs/lan.md, "Running a pool"), run by
// `wisp lan pool` inside the pair's machine-capacity session:
//   bun pairSession.ts --pair K --pool-profile P --launcher PRIVATE_DESKTOP_SH
// Each client gets its own private desktop, so every client has one game
// window on its own display, as the signed-in clients A and B do: tools that
// find "the" Warcraft window on a display, and controller helpers that type
// into it, work unchanged, and no window covers another. Desktop b only
// hosts client b's window. Desktop a runs the pair's network namespace (only
// loopback) with the pair agent in it, which starts both games, client b on
// desktop b. Either desktop ending ends the pair.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PROFILES, desktopSize, pairDirectory } from "./pool";

const argument = (name: string) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const pair = Number(argument("pair") ?? "0");
const profileName = argument("pool-profile") ?? "parity";
const launcher = argument("launcher");
const capacity = argument("capacity");
const profile = PROFILES[profileName];
if (profile === undefined || launcher === undefined) throw new Error("pairSession takes --pair K --pool-profile parity|visual --launcher PRIVATE_DESKTOP_SH");
const directory = pairDirectory(pair);
mkdirSync(directory, { recursive: true });
const size = desktopSize(profile);

const desktopB = Bun.spawn([launcher, "start", "--resolution", size], { stdout: "pipe", stderr: Bun.file(join(directory, "desktop-b.err")) });
let runB: string | undefined;
const reader = desktopB.stdout.getReader();
let text = "";
while (runB === undefined) {
  const { value, done } = await reader.read();
  if (done) break;
  text += new TextDecoder().decode(value);
  runB = /^Run: (.+)$/m.exec(text)?.[1]?.trim();
}
if (runB === undefined || !existsSync(join(runB, "active"))) {
  desktopB.kill("SIGTERM");
  console.error(`client b's desktop didn't start: ${text.trim()}`);
  process.exit(1);
}
await Bun.write(join(directory, "desktop-b.run"), runB);
// Keep draining its output so the launcher never blocks on a full pipe.
void (async () => {
  while (!(await reader.read()).done);
})();

const desktopA = Bun.spawn([launcher, "start", "--resolution", size, "--", "bwrap", "--dev-bind", "/", "/", "--unshare-net", "--die-with-parent", "--",
  process.execPath, join(import.meta.dir, "pairAgent.ts"), "--pair", String(pair), "--pool-profile", profileName, "--run-b", runB, "--session-pid", String(process.pid), ...(capacity === undefined ? [] : ["--capacity", capacity])], {
  stdout: Bun.file(join(directory, "desktop-a.out")),
  stderr: Bun.file(join(directory, "desktop-a.err")),
});

const stop = () => {
  desktopA.kill("SIGTERM");
  desktopB.kill("SIGTERM");
};
process.on("SIGTERM", () => {
  stop();
  process.exit(143);
});
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});
await Promise.race([desktopA.exited, desktopB.exited]);
stop();
await Promise.all([desktopA.exited, desktopB.exited]);
process.exit(0);
