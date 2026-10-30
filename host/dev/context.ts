import { availableParallelism } from "node:os";
import { join, relative, resolve } from "node:path";
import { Effect, Schema, Semaphore } from "effect";
import { ResourceAccounting } from "../contract/services";
import { describeCause } from "../cli/command";
import { Standby, runProcess } from "./devProcesses";
import { WARM_ENV } from "./devResult";
import { TestPlan, type TestUnit } from "./testSelection";
import { TypeChecker } from "./typeCheck";
import type { DevProject } from "./project";
import { SavedDurations } from "./savedDurations";
import { SavedFiles } from "./savedFiles";
import { elapsedLabel } from "./summary";

const REGISTRY_RUN = join(import.meta.dir, "../testing/registryRun.ts");
const JOURNEY_RUN = join(import.meta.dir, "../testing/journeyRun.ts");
const TEST_WAIT = join(import.meta.dir, "../testing/testWait.ts");

const REGISTRY_STANDBY = 6;

const CONCURRENT_CPUS = 12;

export const UNKNOWN_MS = { file: 300, registry: 40 };

export type Clock = () => number;

export interface HotSide {

  readonly request: (savedAt: number) => Effect.Effect<void>;

  readonly poll: Effect.Effect<void>;
  readonly sourceDirectory: string;
}

class TypeCheckFailure extends Schema.TaggedError<TypeCheckFailure, { readonly brand: unique symbol }>()("TypeCheckFailure", {
  operation: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `type checker: ${this.operation}: ${this.problem}`;
  }
}

export const typeChecking = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new TypeCheckFailure({ operation, problem: describeCause(cause) }) });

export const timeoutArguments = (tests: DevProject["tests"]) => (tests.timeoutMs === undefined ? [] : ["--timeout", String(tests.timeoutMs)]);

const cpuBudget = (limit: number | undefined) => Math.max(1, Math.floor(Math.min(availableParallelism(), limit ?? Infinity)));

export const open = (project: DevProject, now: Clock, hot: HotSide | undefined) => Effect.gen(function*() {
  const opened = now();
  const root = resolve(project.root);
  const problems = { count: 0 };
  const durations = new Map<string, number>();
  const located = yield* runProcess(["git", "rev-parse", "--path-format=absolute", "--git-common-dir", "--show-toplevel"], root).pipe(
    Effect.map(({ exitCode, output }) => (exitCode === 0 ? output.trim().split("\n") : [])),
    Effect.orElseSucceed((): string[] => []),
  );
  const savedDurations = new SavedDurations(located[0], located[1]);
  savedDurations.load(durations);
  const cpus = cpuBudget((yield* ResourceAccounting).cpuLimit());
  const behind = Bun.which("nice") === null ? [] : ["nice", "-n", "10"];
  const unitProcesses = cpus < CONCURRENT_CPUS ? Math.max(1, cpus - 2) : Math.floor(cpus / 2) - 1;
  const checker = yield* Effect.acquireRelease(
    typeChecking(`open ${project.typeCheck.projects.join(", ")}`, () => TypeChecker.open(root, project.typeCheck.projects)),
    (opened) => Effect.promise(() => opened.close()),
  );
  const registry = yield* Standby.make([...behind, process.execPath, REGISTRY_RUN], root, Math.min(REGISTRY_STANDBY, unitProcesses), project.tests.env);
  const waiting = new Map<string, Standby>();
  for (const [file, modules] of Object.entries(project.tests.warm ?? {})) {
    waiting.set(resolve(root, file), yield* Standby.make([...behind, process.execPath, "test", ...timeoutArguments(project.tests), TEST_WAIT], root, 1, { ...(project.tests.envForFiles?.([resolve(root, file)]) ?? project.tests.env), [WARM_ENV]: JSON.stringify(modules) }));
  }
  const journeys = project.journey === undefined ? undefined : yield* Standby.make([process.execPath, JOURNEY_RUN], root, 1);
  return {
    project,
    opened,
    hot,
    now,
    root,
    behind,
    unitProcesses,
    checker,
    registry,
    waiting,
    journeys,
    turns: cpus < CONCURRENT_CPUS ? Semaphore.makeUnsafe(Math.max(1, cpus - 1)) : undefined,
    files: new SavedFiles(root, project.sources),
    plan: new TestPlan(root, project.tests),
    preload: (project.tests.preload ?? []).map((path) => resolve(root, path)),
    durations,
    savedDurations,
    problems,
    problem: Effect.sync(() => {
      problems.count += 1;
    }),
    local: (path: string) => relative(root, path),
    seconds: (since: number) => elapsedLabel(now() - since),
  };
});

export type Context = Effect.Success<ReturnType<typeof open>>;

export const expected = (ctx: Context, unit: TestUnit) => ctx.durations.get(unit.path) ?? UNKNOWN_MS[unit.kind];
