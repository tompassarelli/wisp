






import { mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Cause, Console, Effect, Exit, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { describeCause } from "./command";

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

export class CiMapBuildFailure extends Schema.TaggedError<CiMapBuildFailure>()("CiMapBuildFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

const attempt = <A>(what: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new CiMapBuildFailure({ problem: `${what}: ${describeCause(cause)}` }) });






export const buildMapIntoStore = (step: MapBuildStep) => Effect.gen(function*() {
  const problem = stepProblem(step);
  if (problem !== undefined) return yield* new CiMapBuildFailure({ problem });
  const store = resolve(step.store);
  const file = `${step.name}-${step.revision}.w3x`;
  const staging = join(store, `.staging-${process.pid}-${Date.now()}`);
  yield* attempt(`create ${staging}`, () => mkdir(staging, { recursive: true }));
  return yield* Effect.gen(function*() {
    const out = join(staging, file);
    const [program = "", ...args] = step.command.map((arg) => arg === "{out}" ? out : arg);
    const code = yield* Effect.scoped(Effect.flatMap(
      ChildProcess.make(program, args, { cwd: step.checkout, env: { ...(step.env ?? process.env), WISP_MAP_OUT: out }, extendEnv: false, stdin: "ignore", stdout: "inherit", stderr: "inherit" }),
      (child) => child.exitCode,
    )).pipe(Effect.mapError((failure) => new CiMapBuildFailure({ problem: `the map build: ${failure.message}` })));
    if (code !== 0) return yield* new CiMapBuildFailure({ problem: `the map build exited ${code}` });
    if (!(yield* Effect.promise(() => stat(out).catch(() => undefined)))?.size) return yield* new CiMapBuildFailure({ problem: `the map build wrote no map to ${out}` });
    const sha256 = new Bun.CryptoHasher("sha256").update(yield* attempt(`read ${out}`, () => Bun.file(out).arrayBuffer())).digest("hex");
    const map = join(store, file);
    const digestFile = `${map}.sha256`;
    yield* attempt(`write ${digestFile}`, async () => {
      await Bun.write(join(staging, `${file}.sha256`), `${sha256}  ${basename(map)}\n`);
      await rename(out, map);
      await rename(join(staging, `${file}.sha256`), digestFile);
    });
    return { map, digestFile, sha256 } satisfies StoredMap;
  }).pipe(Effect.ensuring(Effect.promise(() => rm(staging, { recursive: true, force: true }))));
});


export const buildIntoStore = (step: MapBuildStep): Promise<StoredMap> =>
  Effect.runPromise(buildMapIntoStore(step).pipe(Effect.provide(BunServices.layer)));

const USAGE = "usage: bun ciMapBuild.ts --store DIR --name NAME --revision SHA -- COMMAND [ARG...]";


const main = (args: readonly string[]) => Effect.gen(function*() {
  const split = args.indexOf("--");
  const flags = split < 0 ? args : args.slice(0, split);
  const flag = (name: string) => {
    const index = flags.indexOf(`--${name}`);
    return index < 0 ? undefined : flags[index + 1];
  };
  const [store, name, revision] = [flag("store"), flag("name"), flag("revision")];
  if (store === undefined || name === undefined || revision === undefined || split < 0) {
    yield* Console.error(USAGE);
    return 2;
  }
  return yield* buildMapIntoStore({ store, name, revision, command: args.slice(split + 1), checkout: process.cwd() }).pipe(
    Effect.flatMap((stored) => Console.log(`${stored.map}\n${stored.digestFile}\nsha256 ${stored.sha256}`).pipe(Effect.as(0))),
    Effect.catch((failure) => Console.error(failure.message).pipe(Effect.as(1))),
  );
});

if (import.meta.main) {
  BunRuntime.runMain(main(process.argv.slice(2)).pipe(Effect.provide(BunServices.layer)), {
    disableErrorReporting: true,
    teardown: (exit) => process.exit(Exit.isSuccess(exit) ? Number(exit.value) : Cause.hasInterruptsOnly(exit.cause) ? 130 : 1),
  });
}
