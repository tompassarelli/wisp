import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import { MapBuildFailure } from "../cli/hostProcess";

const WINDOWS_TOOLS = join(import.meta.dir, "../../native/windows");

const WINDOWS_TOOLS_MANIFEST = join(WINDOWS_TOOLS, "manifest.json");

export const usesWindowsTools = () => process.platform === "win32";

const WindowsTool = Schema.Struct({ sha256: Schema.String, source: Schema.String });

export const WindowsToolsManifest = Schema.Struct({ tools: Schema.Record(Schema.String, WindowsTool) });

export type WindowsToolsManifest = typeof WindowsToolsManifest.Type;

export const fileSha256 = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

const fail = (operation: string, path: string, cause: unknown) => new MapBuildFailure({ operation, path, cause });

const REBUILD = "rebuild them with the Windows workflow's tools job (docs/platforms.md)";

export const windowsTool = (name: string, source: string) => Effect.gen(function*() {
  const manifest = yield* Effect.try({ try: () => JSON.parse(readFileSync(WINDOWS_TOOLS_MANIFEST, "utf8")) as unknown, catch: (cause) => fail("read Windows tools manifest", WINDOWS_TOOLS_MANIFEST, cause) }).pipe(
    Effect.flatMap((json) => Schema.decodeUnknownEffect(WindowsToolsManifest)(json).pipe(Effect.mapError((cause) => fail("decode Windows tools manifest", WINDOWS_TOOLS_MANIFEST, cause)))),
  );
  const tool = manifest.tools[name];
  const path = join(WINDOWS_TOOLS, name);
  if (tool === undefined) return yield* fail("find Windows tool", path, `the manifest lists no ${name}; ${REBUILD}`);
  if (tool.source !== source) return yield* fail("check Windows tool", path, `${name} was built from sources ${tool.source}, not today's ${source}; ${REBUILD}`);
  const digest = yield* Effect.try({ try: () => fileSha256(path), catch: (cause) => fail("hash Windows tool", path, cause) });
  if (digest !== tool.sha256) return yield* fail("check Windows tool", path, `SHA-256 ${digest} is not the manifest's ${tool.sha256}`);
  return path;
});

export const installWindowsTool = (name: string, source: string, target: string) => windowsTool(name, source).pipe(
  Effect.flatMap((path) => Effect.try({
    try: () => {
      if (existsSync(target) && fileSha256(target) === fileSha256(path)) return;
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(path, `${target}.${process.pid}.next`);
      renameSync(`${target}.${process.pid}.next`, target);
    },
    catch: (cause) => fail("install Windows tool", target, cause),
  })),
);
