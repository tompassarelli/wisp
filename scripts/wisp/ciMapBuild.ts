// The private map-build step of the consumer CI template (wisp:docs/ci.md).
// Runs the game's map build into a staging file inside the private store,
// then publishes STORE/NAME-REVISION.w3x and its sha256 digest beside it by
// rename. The store must lie outside the checkout, and the step refuses a
// GitHub-hosted runner, so a proprietary map never reaches public artifacts.
// Usage: bun ciMapBuild.ts --store DIR --name NAME --revision SHA -- COMMAND [ARG...]
// The command writes the map to $WISP_MAP_OUT; an argument `{out}` is replaced by that path.
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export interface MapBuildStep {
  readonly store: string;
  readonly name: string;
  readonly revision: string;
  readonly command: readonly string[];
  readonly checkout: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface StoredMap {
  readonly map: string;
  readonly digestFile: string;
  readonly sha256: string;
}

const inside = (child: string, parent: string) => {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
};

export function stepProblem(step: MapBuildStep): string | undefined {
  const env = step.env ?? process.env;
  if (env["RUNNER_ENVIRONMENT"] === "github-hosted") return "the private map build runs only on a self-hosted runner";
  if (!isAbsolute(step.store)) return `the store ${step.store} must be an absolute path`;
  if (inside(resolve(step.store), resolve(step.checkout))) return `the store ${step.store} is inside the checkout ${step.checkout}`;
  if (!/^[A-Za-z0-9][\w.-]*$/.test(step.name)) return `the map name ${step.name} may hold only letters, digits, '.', '_' and '-'`;
  if (!/^[0-9a-f]{7,40}$/.test(step.revision)) return `the revision ${step.revision} is not a commit hash`;
  if (step.command.length === 0) return "no map-build command";
  return undefined;
}

export async function buildIntoStore(step: MapBuildStep): Promise<StoredMap> {
  const problem = stepProblem(step);
  if (problem !== undefined) throw new Error(problem);
  const store = resolve(step.store);
  const file = `${step.name}-${step.revision}.w3x`;
  const staging = join(store, `.staging-${process.pid}-${Date.now()}`);
  await mkdir(staging, { recursive: true });
  try {
    const out = join(staging, file);
    const command = step.command.map((arg) => arg === "{out}" ? out : arg);
    const child = Bun.spawn([...command], { cwd: step.checkout, env: { ...(step.env ?? process.env), WISP_MAP_OUT: out }, stdout: "inherit", stderr: "inherit" });
    const code = await child.exited;
    if (code !== 0) throw new Error(`the map build exited ${code}`);
    if (!(await stat(out).catch(() => undefined))?.size) throw new Error(`the map build wrote no map to ${out}`);
    const sha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(out).arrayBuffer()).digest("hex");
    const map = join(store, file);
    const digestFile = `${map}.sha256`;
    await Bun.write(join(staging, `${file}.sha256`), `${sha256}  ${basename(map)}\n`);
    await rename(out, map);
    await rename(join(staging, `${file}.sha256`), digestFile);
    return { map, digestFile, sha256 };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const split = args.indexOf("--");
  const flags = split < 0 ? args : args.slice(0, split);
  const flag = (name: string) => {
    const index = flags.indexOf(`--${name}`);
    return index < 0 ? undefined : flags[index + 1];
  };
  const [store, name, revision] = [flag("store"), flag("name"), flag("revision")];
  if (store === undefined || name === undefined || revision === undefined || split < 0) {
    console.error("usage: bun ciMapBuild.ts --store DIR --name NAME --revision SHA -- COMMAND [ARG...]");
    process.exit(2);
  }
  try {
    const stored = await buildIntoStore({ store, name, revision, command: args.slice(split + 1), checkout: process.cwd() });
    console.log(`${stored.map}\n${stored.digestFile}\nsha256 ${stored.sha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
