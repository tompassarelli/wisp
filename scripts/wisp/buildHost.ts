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


const discoverBuild = (target: BuildDiscoveryTarget) => Effect.gen(function*() {
  const provider = join(process.env["HOME"] ?? "", ".local/share/wisp-private/builds/discover.ts");
  const probe = existsSync(provider) ? yield* Effect.tryPromise({
    try: async () => {
      const module = await import(provider) as { discover: (target: BuildDiscoveryTarget, deps: { Effect: typeof Effect }) => Promise<unknown> };
      return module.discover(target, { Effect });
    },
    catch: (cause) => new BuildFailure({ problem: `build discovery failed: ${String(cause)}` }),
  }).pipe(Effect.catchTag("BuildFailure", (cause) => Effect.succeed({ error: cause.problem })))
    : { pending: ["engine locate: private discovery provider missing", "LAN probe: private discovery provider missing", "menu probe: private discovery provider missing"] };
  const draft = `${privateBuildPath(target.id).slice(0, -5)}.draft.json`;
  yield* Effect.try({
    try: () => {
      mkdirSync(dirname(draft), { recursive: true });
      writeFileSync(draft, `${JSON.stringify({ id: target.id, capabilities: Object.fromEntries(BUILD_CAPABILITIES.map((name) => [name, { status: "unchecked", issue: "wisp#100" }])), probes: probe, pending: BUILD_CAPABILITIES }, null, 2)}\n`);
    },
    catch: (cause) => new BuildFailure({ problem: `couldn't write the build draft: ${String(cause)}` }),
  });
  return draft;
});

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
