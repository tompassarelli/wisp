// The LAN switch (putting an offline client on the LAN provider before it
// joins) reads and patches the running game's memory, so it isn't kept in
// this repository (wisp:docs/clean-room.md). When the owner has it, it lives
// at LAN_PLUGIN; this is the only file that loads it.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schedule } from "effect";
import type { MenuSocket } from "../menus";
import { LanFailure } from "./join";
import { isolatedNetworkProblem } from "./offline";

export const LAN_PLUGIN = join(process.env["HOME"] ?? "", ".local/share/wisp-private/lan/index.ts");

export interface LanPlugin {
  /** The game executable's file version. */
  readonly version: (exePath: string) => string;
  /** Puts client `pid` on the LAN provider until its next provider rebuild. */
  readonly enableLan: (pid: number, exePath: string, menus: MenuSocket, log: (line: string) => void) => Effect.Effect<void, LanFailure>;
}

/** What's missing for joining LAN games, or undefined when the plugin is installed. */
export const lanPluginProblem = (path = LAN_PLUGIN) => (existsSync(path) ? undefined
  : `joining LAN games needs Wisp's private LAN plugin at ${path}, and it isn't installed on this machine`);

let loaded: LanPlugin | undefined;

export const loadLanPlugin: Effect.Effect<LanPlugin, LanFailure> = Effect.suspend(() => {
  if (loaded !== undefined) return Effect.succeed(loaded);
  const problem = lanPluginProblem();
  if (problem !== undefined) return Effect.fail(new LanFailure({ problem }));
  return Effect.tryPromise({
    try: async () => {
      const plugin = (await import(LAN_PLUGIN)) as { make: (deps: unknown) => LanPlugin };
      loaded = plugin.make({ Effect, Schedule, isolatedNetworkProblem, failure: (problem: string) => new LanFailure({ problem }) });
      return loaded;
    },
    catch: (cause) => new LanFailure({ problem: `the LAN plugin at ${LAN_PLUGIN} didn't load: ${cause instanceof Error ? cause.message : String(cause)}` }),
  });
});
