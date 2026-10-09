

import { copyFile, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { report } from "./compiler";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { collect } from "./wisp/hostProcess";

class PackageFailure extends Schema.TaggedError<PackageFailure>()("PackageFailure", { cause: Schema.Unknown }) {
  override get message() { return String(this.cause); }
}
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: cause => new PackageFailure({ cause }) }).pipe(Effect.uninterruptible);

const root = resolve(import.meta.dir, "..");
const packagePaths = ["scripts", "plugins", "src", "native", "docs", "builds", "vendor", "README.md", "LICENSE", "AGENTS.md", "typescript-toolchain.lock", "tsconfig.library.json"];

async function copyTree(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".tests.ts")) continue;
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await copyFile(from, to);
  }
}

// Declarations must resolve sibling declarations; TSTL omits shipped Lua when it treats the sibling TypeScript source as a consumer file.






async function moveDeclarations(source: string, destination: string): Promise<void> {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await moveDeclarations(from, to);
    else if (entry.name.endsWith(".d.ts")) {
      await mkdir(destination, { recursive: true });
      await rename(from, to);
    }
  }
}

// tsserver requires a CommonJS module whose export is the plugin factory.



const editorPluginProgram = (output: string) => attempt(async () => {
  const result = await Bun.build({
    entrypoints: [join(root, "plugins/number-rules-service.ts")],
    format: "cjs",
    target: "node",
    footer: "module.exports = module.exports.default;",
  });
  const [bundle] = result.outputs;
  if (!result.success || bundle === undefined) throw new Error(`editor plugin build failed: ${result.logs.join("\n")}`);
  await Bun.write(output, bundle);
});

export const writeEditorPlugin = (output: string): Promise<void> => Effect.runPromise(editorPluginProgram(output));


export const packageProgram = (output: string) => Effect.scoped(Effect.gen(function*() {
  const target = resolve(output);
  yield* attempt(() => mkdir(join(root, "build"), { recursive: true }));
  const staging = yield* Effect.acquireRelease(
    attempt(() => mkdtemp(join(root, "build/package-"))),
    directory => Effect.promise(() => rm(directory, { recursive: true })),
  );
  yield* attempt(async () => {
    const { diagnostics } = transpileProject(join(root, "tsconfig.library.json"), { outDir: staging });
    if (diagnostics.length > 0) throw new Error(report(diagnostics));
    await moveDeclarations(join(staging, "src"), join(staging, "types/src"));
    for (const path of packagePaths) {
      const source = join(root, path);
      const destination = join(staging, path);
      if (["scripts", "plugins", "src", "native", "docs", "builds", "vendor"].includes(path)) await copyTree(source, destination);
      else await copyFile(source, destination);
    }
    await writeEditorPlugin(join(staging, "plugins/number-rules-service.cjs"));
  });
  const decoded = yield* attempt(() => Bun.file(join(root, "package.json")).json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown))),
  );
  const manifest = { ...decoded };
  delete manifest.scripts;
  delete manifest.devDependencies;
  manifest.exports = {
    "./src/*": { types: "./types/src/*.d.ts", tstl: "./src/*", default: "./src/*.ts" },
    "./scripts/*": "./scripts/*.ts",
    "./plugins/*": "./plugins/*.ts",
    "./*": "./*",
  };
  yield* attempt(async () => {
    await Bun.write(join(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await mkdir(dirname(target), { recursive: true });
  });
  const packed = yield* collect(ChildProcess.make(process.execPath, ["pm", "pack", "--ignore-scripts", "--filename", target], { cwd: staging }));
  if (packed.exitCode !== 0) return yield* new PackageFailure({ cause: `package failed: ${packed.stderr}` });
}));

export const producePackage = (output: string): Promise<void> => Effect.runPromise(packageProgram(output).pipe(Effect.provide(BunServices.layer)));

if (import.meta.main) {
  BunRuntime.runMain(Effect.gen(function*() {
    const output = yield* Schema.decodeUnknownEffect(Schema.String)(process.argv[2]).pipe(
      Effect.mapError(() => new PackageFailure({ cause: "usage: bun scripts/package.ts OUTPUT_TGZ" })),
    );
    yield* packageProgram(output);
    console.log(resolve(output));
  }).pipe(Effect.provide(BunServices.layer)));
}
