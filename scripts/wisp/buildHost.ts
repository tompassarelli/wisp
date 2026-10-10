import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import { BuildFailure, BUILD_CAPABILITIES, buildProfileLines, privateBuildPath, profileFor } from "./builds";
import { loadLanPlugin } from "./lan/plugin";

export const executableIn = (prefix: string) => join(prefix, "drive_c/Program Files (x86)/Warcraft III/_retail_/x86_64/Warcraft III.exe");
export const detectBuild = (exe: string) => Effect.gen(function*() {
  const plugin = yield* loadLanPlugin;
  return yield* Effect.try({ try: () => plugin.version(exe), catch: (cause) => new BuildFailure({ problem: `couldn't read the game build: ${String(cause)}` }) });
});

export interface BuildDiscoveryTarget {
  readonly id: string;
  readonly prefix: string;
  readonly client: string;
  readonly menuReportPort?: number;
}

export const reportBuild = (target: { readonly prefix: string; readonly client: { readonly name: string; readonly menuReportPort?: number } }, print: (line: string) => void) => Effect.gen(function*() {
  const exe = executableIn(target.prefix);
  if (!existsSync(exe)) return;
  const id = yield* detectBuild(exe);
  for (const line of buildProfileLines(id)) print(`${target.client.name}: ${line}`);
  if (profileFor(id) === undefined) {
    const draft = yield* discoverBuild({ id, prefix: target.prefix, client: target.client.name, ...(target.client.menuReportPort === undefined ? {} : { menuReportPort: target.client.menuReportPort }) });
    print(`${target.client.name}: build discovery draft ${draft}; capabilities still need checking`);
    return yield* new BuildFailure({ problem: `menuDriving missing for ${id}; check the discovery draft before using this client (wisp#100)` });
  }
});
