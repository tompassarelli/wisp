// Making pool clients (wisp:docs/lan.md, "Setting up"): for each, a new Wine
// prefix with "Allow Local Files" set and nothing else (no Battle.net, no
// account), a reflinked copy of an existing Warcraft III install (copy on
// write: no space until a file changes), and Wisp's menu page reporting to
// the client's own port. Prefix creation runs in a network namespace with
// only loopback, like everything else a pool client runs.
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { ChildProcess } from "effect/process";
import { collect } from "../hostProcess";
import { installMenuPage } from "../menus";
import { LanFailure } from "./join";
import { clientRoot, installOf, prefixOf, retailOf } from "./pool";

const STEAM = () => join(process.env["HOME"] ?? "", ".local/share/Steam");

/** Runs a step to completion; an interrupt stops its whole process group (Proton, Wine, cp) and waits for it. */
const run = (what: string, command: readonly string[], env: Record<string, string> = {}) =>
  collect(ChildProcess.make(command[0]!, command.slice(1), { env, extendEnv: true, stdin: "ignore" })).pipe(
    Effect.provide(BunServices.layer),
    Effect.mapError((cause) => new LanFailure({ problem: `${what}: ${cause.message}` })),
    Effect.flatMap(({ exitCode, stderr }) => (exitCode === 0 ? Effect.void
      : Effect.fail(new LanFailure({ problem: `${what}: exited with ${exitCode}: ${stderr.trim().split("\n").slice(-3).join(" | ")}` })))),
  );

/** Creates pool client `name` from the Warcraft III install folder `from` (the one holding _retail_). */
export const setupClient = (name: string, from: string, port: number, log: (line: string) => void) => Effect.gen(function*() {
  if (!existsSync(join(from, "_retail_/x86_64/Warcraft III.exe"))) return yield* new LanFailure({ problem: `${from} isn't a Warcraft III install (no _retail_/x86_64/Warcraft III.exe)` });
  const root = clientRoot(name);
  if (!existsSync(join(prefixOf(name), "user.reg"))) {
    mkdirSync(root, { recursive: true });
    const appId = "3516115599";
    yield* run(`create ${name}'s prefix`, [
      "bwrap", "--dev-bind", "/", "/", "--unshare-net", "--die-with-parent", "--",
      "steam-run", "env", join(STEAM(), "steamapps/common/SteamLinuxRuntime_4/_v2-entry-point"), "--verb=waitforexitandrun", "--",
      join(STEAM(), "compatibilitytools.d/GE-Proton11-7-x86_64/proton"), "waitforexitandrun", "C:\\windows\\system32\\reg.exe",
      "add", "HKCU\\Software\\Blizzard Entertainment\\Warcraft III", "/v", "Allow Local Files", "/t", "REG_DWORD", "/d", "1", "/f",
    ], { STEAM_COMPAT_DATA_PATH: root, STEAM_COMPAT_CLIENT_INSTALL_PATH: STEAM(), STEAM_COMPAT_APP_ID: appId, SteamAppId: appId });
    log(`${name}: prefix created with Allow Local Files`);
  }
  if (!existsSync(installOf(name))) {
    yield* run(`copy the install into ${name}`, ["cp", "-a", "--reflink=always", from, installOf(name)]);
    log(`${name}: install reflinked from ${from}`);
  } else {
    // cp -a keeps the executable's size and modification time, so a different one means a different build.
    const stamps = yield* Effect.try({
      try: () => [join(from, "_retail_/x86_64/Warcraft III.exe"), join(retailOf(name), "x86_64/Warcraft III.exe")].map((exe) => {
        const { size, mtimeMs } = statSync(exe);
        return `${size} bytes, modified ${new Date(mtimeMs).toISOString()}`;
      }),
      catch: (cause) => new LanFailure({ problem: `${name}: read the install executables: ${String(cause)}` }),
    });
    if (stamps[0] !== stamps[1]) {
      yield* run(`refresh the install in ${name}`, ["cp", "-a", "--reflink=always", `${from}/.`, installOf(name)]);
      log(`${name}: install refreshed (executable was ${stamps[1]}, now ${stamps[0]})`);
    }
  }
  yield* installMenuPage(retailOf(name), port).pipe(Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
  log(`${name}: menu page reports to 127.0.0.1:${port}`);
});
