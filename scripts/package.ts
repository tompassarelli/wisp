// Produces the installed library: TypeScript source for host tools and the
// matching Lua modules required by TypeScriptToLua's package resolver.
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { transpileProject } from "typescript-to-lua";
import { report } from "./compiler";

const root = resolve(import.meta.dir, "..");
const packagePaths = ["scripts", "plugins", "src", "native", "docs", "README.md", "AGENTS.md", "typescript-toolchain.lock", "tsconfig.library.json"];

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

/** Writes a standard package tarball to the caller's exact output path. */
export async function producePackage(output: string): Promise<void> {
  const target = resolve(output);
  await mkdir(join(root, "build"), { recursive: true });
  const staging = await mkdtemp(join(root, "build/package-"));
  try {
    const { diagnostics } = transpileProject(join(root, "tsconfig.library.json"), { outDir: staging });
    if (diagnostics.length > 0) throw new Error(report(diagnostics));
    for (const path of packagePaths) {
      const source = join(root, path);
      const destination = join(staging, path);
      if (["scripts", "plugins", "src", "native", "docs"].includes(path)) await copyTree(source, destination);
      else await copyFile(source, destination);
    }
    // Dependency versions are unchanged; installation must not run this
    // repository's developer checker patch against the consuming project.
    const manifest: Record<string, unknown> = await Bun.file(join(root, "package.json")).json();
    delete manifest.scripts;
    delete manifest.devDependencies;
    manifest.exports = {
      // TSTL's resolver appends .lua to its selected export path.
      "./src/*": { types: "./src/*.d.ts", tstl: "./src/*", default: "./src/*.ts" },
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
