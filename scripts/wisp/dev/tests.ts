import { resolve } from "node:path";
import { Console, Effect, Result, Semaphore } from "effect";
import { runProcess } from "../devProcesses";
import { SAVED_FILES_ENV } from "../devResult";
import type { JourneyRequest } from "../journeyRun";
import type { RegistryRequest } from "../registryRun";
import type { WaitingTestRequest } from "../testWait";
import { type Selection, type TestProcess, type TestUnit, packTests } from "../testSelection";
import { type Context, UNKNOWN_MS, expected, timeoutArguments } from "./context";
import { type ProcessResult, counts, fileResult, indent, isRegistryResult, journeySummary, plural, registryResult, scope } from "./summary";

const runRegistry = (ctx: Context, batch: TestProcess) => Effect.gen(function*() {
  const request: RegistryRequest = { preload: ctx.preload, modules: batch.units.map((unit) => unit.path) };
  const output = yield* ctx.registry.run(request);
  for (const result of output.results.filter(isRegistryResult)) ctx.durations.set(result.module, result.milliseconds);
  return registryResult(batch.units, output, ctx.local);
});

const runFiles = (ctx: Context, batch: TestProcess, audits: ReadonlyMap<string, readonly string[]>) => Effect.gen(function*() {
  const { project, root, behind, local } = ctx;
  const started = ctx.now();
  const first = batch.units[0];
  const audited = batch.units.length === 1 ? audits.get(first?.path ?? "") : undefined;
  const savedFiles = audited === undefined ? {} : { [SAVED_FILES_ENV]: JSON.stringify(audited) };
  const standby = batch.units.length === 1 && first !== undefined ? ctx.waiting.get(first.path) : undefined;
  const paths = batch.units.map((unit) => unit.path);
  const output = standby === undefined
    ? yield* runProcess([...behind, process.execPath, "test", ...timeoutArguments(project.tests), ...paths], root, { ...(project.tests.envForFiles?.(paths) ?? project.tests.env), ...savedFiles })
    : yield* standby.run({ file: first?.path ?? "", env: savedFiles } satisfies WaitingTestRequest);
  const elapsed = ctx.now() - started;

  if (audited !== undefined && first !== undefined) ctx.durations.set(`audit ${first.path}`, elapsed);
  else for (const unit of batch.units) ctx.durations.set(unit.path, (elapsed * expected(ctx, unit)) / Math.max(1, batch.work));
  return fileResult(batch.units.map((unit) => local(unit.path)).join(", "), output);
});

const runTests = (ctx: Context, batch: TestProcess, audits: ReadonlyMap<string, readonly string[]>): Effect.Effect<ProcessResult> =>
  (batch.kind === "registry" ? runRegistry(ctx, batch) : runFiles(ctx, batch, audits)).pipe(
    Effect.catch((failure) => Effect.succeed({ passed: 0, failures: [`${batch.units.map((unit) => ctx.local(unit.path)).join(", ")}: ${failure.message}`] })),
  );

const runSide = (ctx: Context, units: readonly TestUnit[], audits: ReadonlyMap<string, readonly string[]>, count: number, savedAt: number) => Effect.gen(function*() {
  const { plan, turns, durations, waiting } = ctx;
  const alone = (path: string) => audits.has(path) || waiting.has(path);
  const expectedHere = (unit: TestUnit) => (audits.has(unit.path) ? durations.get(`audit ${unit.path}`) ?? UNKNOWN_MS.file : expected(ctx, unit));
  const processes = packTests(units, expectedHere, (path) => (alone(path) ? `alone ${path}` : plan.group(path)), count)
    .sort((left, right) => right.work - left.work);
  const turn = (run: Effect.Effect<ProcessResult>) => (turns === undefined ? run : Semaphore.withPermit(turns, run));
  const results = yield* Effect.forEach(processes, (batch) => turn(runTests(ctx, batch, audits)).pipe(Effect.tap(({ failures }) =>
    failures.length === 0 ? Effect.void : Effect.andThen(ctx.problem, Console.log(`${ctx.seconds(savedAt)}FAIL ${failures.join(`\n${" ".repeat(13)}FAIL `)}`)))), { concurrency: "unbounded" });
  return {
    passed: results.reduce((sum, result) => sum + result.passed, 0),
    failed: results.reduce((sum, result) => sum + result.failures.length, 0),
  };
});

export const unitTests = (ctx: Context, selection: Selection, savedAt: number) => Effect.gen(function*() {
  const units = selection.units.filter((unit) => !ctx.plan.isJourney(unit.path));
  if (units.length === 0) return yield* Console.log(`${ctx.seconds(savedAt)}unit tests: none load the saved files`);
  const { passed, failed } = yield* runSide(ctx, units, selection.audits ?? new Map(), ctx.unitProcesses, savedAt);
  const audited = [...selection.audits?.keys() ?? []].map(ctx.local);
  const audits = audited.length === 0 ? "" : `; ${audited.join(", ")} checked only the saved files`;
  yield* Console.log(`${ctx.seconds(savedAt)}unit tests: ${counts(passed, failed)} (${scope(units, selection, ctx.plan.all().length)}${audits})`);
});

const ownJourney = (ctx: Context) => Effect.gen(function*() {
  const { journey } = ctx.project;
  if (journey === undefined || ctx.journeys === undefined) return undefined;
  const { module, name, clients = 2 } = journey;
  const request: JourneyRequest = { module: resolve(ctx.root, module), export: journey.export, journey: name, clients };
  const ran = yield* ctx.journeys.run(request).pipe(Effect.result);
  if (Result.isFailure(ran)) return { summary: `${name} didn't finish`, report: ran.failure.message };
  return journeySummary(name, ran.success);
});

export const allJourneys = (ctx: Context, selection: Selection, savedAt: number, before: Effect.Effect<void>) => Effect.gen(function*() {
  const units = selection.units.filter((unit) => ctx.plan.isJourney(unit.path));
  // @effect-diagnostics-next-line effectSucceedWithVoid:off -- an undefined result, which Effect.void's void type cannot satisfy
  const tests = units.length === 0 ? Effect.succeed(undefined) : runSide(ctx, units, new Map(), units.length, savedAt);
  yield* before;
  const [own, ran] = yield* Effect.all([ownJourney(ctx), tests], { concurrency: "unbounded" });
  if (own === undefined && ran === undefined) return;
  if (own?.report !== undefined) yield* ctx.problem;
  const parts = [
    ...(own === undefined ? [] : [own.summary]),
    ...(ran === undefined ? [] : [`${plural(ran.passed + ran.failed, "journey test")}: ${counts(ran.passed, ran.failed)} (${scope(units, selection, ctx.plan.all().length)})`]),
  ];
  yield* Console.log(`${ctx.seconds(savedAt)}journeys: ${parts.join("; ")}${own?.report === undefined ? "" : `\n${indent(own.report)}`}`);
});
