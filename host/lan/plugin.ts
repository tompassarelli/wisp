import { existsSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { Effect, Schedule } from "effect";
import type { MenuSocket } from "../os/warcraft/menuSocket";
import { LanFailure } from "./join";
import { isolatedNetworkProblem } from "./offline";
import { requireCapability } from "../os/warcraft/builds";
import { describeCause } from "../cli/command";

const LAN_PLUGIN = join(process.env["HOME"] ?? "", ".local/share/wisp-private/lan/index.ts");

export interface LanPlugin {

  readonly version: (exePath: string) => string;
  readonly versionForPort?: (port: number) => string | undefined;

  readonly enableLan: (pid: number, exePath: string, menus: MenuSocket, log: (line: string) => void) => Effect.Effect<void, LanFailure>;
}

export const lanPluginProblem = (path = LAN_PLUGIN) => (existsSync(path) ? undefined
  : `joining LAN games needs Wisp's private LAN plugin at ${path}, and it isn't installed on this machine`);

let loaded: LanPlugin | undefined;

// Bun keeps a module whose evaluation threw as uninitialized, so a retry must first drop the plugin directory's module records.
const forgetPluginModules = () => {
  const directory = `${dirname(LAN_PLUGIN)}${sep}`;
  for (const key of Object.keys(require.cache)) if (key.startsWith(directory)) delete require.cache[key];
};

export const loadLanPlugin: Effect.Effect<LanPlugin, LanFailure> = Effect.suspend(() => {
  if (loaded !== undefined) return Effect.succeed(loaded);
  const problem = lanPluginProblem();
  if (problem !== undefined) return Effect.fail(new LanFailure({ problem }));
  return Effect.tryPromise({
    try: async () => {
      const plugin = (await import(LAN_PLUGIN)) as { make: (deps: unknown) => LanPlugin };
      const implementation = plugin.make({ Effect, Schedule, isolatedNetworkProblem, failure: (problem: string) => new LanFailure({ problem }) });
      loaded = {
        ...implementation,
        enableLan: (pid, exe, menus, log) => Effect.gen(function*() {
          const id = yield* Effect.try({ try: () => implementation.version(exe), catch: (cause) => new LanFailure({ problem: `couldn't read the game build: ${String(cause)}` }) });
          yield* requireCapability(id, "privateLanSwitch").pipe(Effect.mapError((cause) => new LanFailure({ problem: cause.message })));
          yield* implementation.enableLan(pid, exe, menus, log);
        }),
      };
      return loaded;
    },
    catch: (cause) => {
      forgetPluginModules();
      return new LanFailure({ problem: `the LAN plugin at ${LAN_PLUGIN} didn't load: ${describeCause(cause)}` });
    },
  });
});
