// Produces the installed library: TypeScript source for host tools and the
// matching Lua modules required by TypeScriptToLua's package resolver.
import { copyFile, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { report } from "./compiler";

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

/**
 * Moves the generated declarations under `source` to the same paths under
 * `destination`. A declaration's relative import then finds the sibling
 * declaration, not the TypeScript source shipped beside the Lua: a consumer
 * program that held the source would take it for its own and TypeScriptToLua
 * would leave its Lua out of the bundle.
 */
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

/**
 * Writes the editor plugin as CommonJS: tsserver runs in the editor's Node and
 * `require`s a plugin, expecting the module itself to be its factory.
 */
export async function writeEditorPlugin(output: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [join(root, "plugins/number-rules-service.ts")],
    format: "cjs",
    target: "node",
    footer: "module.exports = module.exports.default;",
  });
  const [bundle] = result.outputs;
  if (!result.success || bundle === undefined) throw new Error(`editor plugin build failed: ${result.logs.join("\n")}`);
  await Bun.write(output, bundle);
}

/** Writes a standard package tarball to the caller's exact output path. */
export async function producePackage(output: string): Promise<void> {
  const target = resolve(output);
  await mkdir(join(root, "build"), { recursive: true });
  const staging = await mkdtemp(join(root, "build/package-"));
  try {
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
    // Dependency versions are unchanged; installation must not run this
    // repository's developer checker patch against the consuming project.
    const manifest: Record<string, unknown> = await Bun.file(join(root, "package.json")).json();
    delete manifest.scripts;
    delete manifest.devDependencies;
    manifest.exports = {
      // TSTL's resolver appends .lua to its selected export path.
      "./src/*": { types: "./types/src/*.d.ts", tstl: "./src/*", default: "./src/*.ts" },
      "./scripts/*": "./scripts/*.ts",
      "./plugins/*": "./plugins/*.ts",
      "./*": "./*",
    };
    await Bun.write(join(staging, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await mkdir(dirname(target), { recursive: true });
    const packed = Bun.spawnSync([process.execPath, "pm", "pack", "--ignore-scripts", "--filename", target], { cwd: staging, stdout: "pipe", stderr: "pipe" });
    if (packed.exitCode !== 0) throw new Error(`package failed: ${packed.stderr.toString()}`);
  } finally {
    await rm(staging, { recursive: true });
  }
}

if (import.meta.main) {
  const output = process.argv[2];
  if (output === undefined) throw new Error("usage: bun scripts/package.ts OUTPUT_TGZ");
  await producePackage(output);
  console.log(resolve(output));
}
