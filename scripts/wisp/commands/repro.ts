import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Console, Effect } from "effect";
import { type Repro } from "../../../src/runtime/repro";
import { PageOpener } from "../../platform/services";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { type HeadlessMap } from "../headless";
import { step } from "../timings";
import { diffReproStates } from "../reproInspection";
import { replaySoakRepro } from "../reproSoak";
import { emitJson } from "../jsonResults";
import { createReproViewer, serveReproViewer, type ReproViewerSources } from "../reproViewer";
import { waitForProcessStop } from "./hot";
import { importNativeReplay, compareReplayHost, type NativeReplay } from "../replayImport";
import { writtenPreloadFile } from "../headlessInput";
import { reproLines } from "../../../src/runtime/repro";
import { CLIENTS, ReproFailure, inspectInClients, isTestName, loadInspector, loadReplay, readRepro, replayInClients, reproReport, reproTestSource } from "../repro/replay";

export { ReproFailure, inspectClientStates, inspectInClients, loadInspector, loadReplay, readRepro, replayInClients, reproReport, reproTestSource } from "../repro/replay";

export interface ReproProject {
  readonly viewerSources?: ReproViewerSources;

  readonly viewerScanDivergence?: boolean;
  readonly map: HeadlessMap;

  readonly replay: string;

  readonly tests: string;

  readonly importReplay?: (replay: NativeReplay) => { readonly repro: Repro; readonly simulatedActionOffsets: readonly number[] };

  readonly soak?: { readonly project: string; readonly tests: string };
}

function importFrom(directory: string, module: string): string {
  const path = relative(directory, module).replace(/\.ts$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}

export type ReproRequest =
  | { readonly mode: "import"; readonly file: string; readonly host?: string; readonly out: string }
  | {
    readonly mode: "replay";
    readonly file: string;
    readonly json: boolean;
    readonly shrink: boolean;
    readonly view: boolean;
    readonly name?: string;
    readonly frame?: number;
    readonly diffFrame?: number;
    readonly out?: string;
  };

type ReplayRequest = Extract<ReproRequest, { mode: "replay" }>;

const REPLAY_FLAGS = ["--test", "--frame", "--diff-frame", "--out"];

export function parseReproArgs(args: readonly string[]): ReproRequest | UsageFailure {
  const usage = (problem: string) => new UsageFailure({ problem });
  if (args[0] === "import") {
    const values = flagValues(args, "out");
    const out = values[0];
    const objects = args.slice(1).filter((arg, index) => !arg.startsWith("--") && args[index] !== "--out");
    const [file, host] = objects;
    if (file === undefined || objects.length > 2 || out === undefined || values.length !== 1 || args.some(arg => arg.startsWith("--") && arg !== "--out" && !arg.startsWith("--out="))) return usage("repro import FILE.w3g [HOST.log] --out ACTIONS.json");
    return { mode: "import", file, out, ...(host === undefined ? {} : { host }) };
  }
  const json = args.includes("--json");
  const shrink = args.includes("--shrink");
  const view = args.includes("--view");
  args = args.filter(arg => arg !== "--json" && arg !== "--shrink" && arg !== "--view");
  const [name, ...extra] = flagValues(args, "test");
  const [frameText, ...extraFrames] = flagValues(args, "frame");
  const [diffText, ...extraDiffs] = flagValues(args, "diff-frame");
  const [out, ...extraOut] = flagValues(args, "out");
  const files = args.filter((arg, index) => !arg.startsWith("--") && !REPLAY_FLAGS.includes(args[index - 1] ?? ""));
  const file = files[0];
  if (view && (json || shrink || name !== undefined || frameText !== undefined || out !== undefined || diffText !== undefined)) return usage("--view takes only the saved repro file");
  const missingValue = REPLAY_FLAGS.some(flag => args.includes(flag) && flagValues(args, flag.substring(2)).length === 0);
  const unknownFlag = args.some(arg => arg.startsWith("--") && !REPLAY_FLAGS.some(flag => arg === flag || arg.startsWith(`${flag}=`)));
  if (file === undefined || files.length > 1 || extra.length + extraFrames.length + extraDiffs.length + extraOut.length > 0 || missingValue || unknownFlag) {
    return usage("repro takes one file, --test NAME, --shrink [--out FILE], or --frame N --out FILE [--diff-frame N|previous]");
  }
  if (name !== undefined && !isTestName(name)) return usage(`test names are lowercase letters, digits and hyphens: ${name}`);
  const frame = frameText === undefined ? undefined : Number(frameText);
  const diffFrame = diffText === undefined ? undefined : diffText === "previous" ? (frame ?? 0) - 1 : Number(diffText);
  const badFrame = frame !== undefined && (!/^\d+$/.test(frameText ?? "") || !Number.isSafeInteger(frame));
  const badDiff = diffFrame !== undefined && (diffText !== "previous" && !/^\d+$/.test(diffText ?? "") || !Number.isSafeInteger(diffFrame));
  if (badFrame || badDiff) return usage("inspection frames must be nonnegative whole numbers");
  if ((!shrink && (frame !== undefined) !== (out !== undefined)) || (shrink && frame !== undefined) || (diffFrame !== undefined && frame === undefined)) return usage("use --shrink [--out FILE], or --frame N --out FILE [--diff-frame N|previous]");
  return {
    mode: "replay", file, json, shrink, view,
    ...(name === undefined ? {} : { name }), ...(frame === undefined ? {} : { frame }), ...(diffFrame === undefined ? {} : { diffFrame }), ...(out === undefined ? {} : { out }),
  };
}

const sameFile = (out: string, file: string) => resolve(out) === resolve(file) || existsSync(out) && realpathSync(out) === realpathSync(file);

const importRepro = (load: () => Promise<ReproProject>, { file, host, out }: Extract<ReproRequest, { mode: "import" }>) => Effect.gen(function*() {
  if (sameFile(out, file)) return yield* new UsageFailure({ problem: "the import output must differ from the native replay" });
  const failed = (cause: unknown) => new ReproFailure({ file, problem: describeCause(cause) });
  const imported = yield* Effect.tryPromise({ try: () => importNativeReplay(readFileSync(file)), catch: failed });
  const comparison = host === undefined ? undefined : yield* Effect.try({ try: () => compareReplayHost(imported, readFileSync(host, "utf8")), catch: failed });
  yield* Effect.try({ try: () => { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, `${JSON.stringify({ ...imported, ...(comparison === undefined ? {} : { comparison }) }, null, 2)}\n`); }, catch: failed });
  const actions = imported.commands.flatMap(command => command.actions);
  yield* Console.log(`imported ${imported.turns} turns, ${actions.length} actions (${actions.filter(action => action.kind === "raw").length} unknown); raw bytes and offsets: ${out}`);
  if (comparison !== undefined) {
    yield* Console.log(`host ${comparison.hostActions}, replay ${comparison.replayActions}: ${comparison.differences.length} differences`);
    if (comparison.differences.length > 0) return yield* new ReproFailure({ file, problem: comparison.differences.slice(0, 5).join("\n") });
  }
  const project = yield* Effect.tryPromise({ try: load, catch: failed });
  if (project.importReplay === undefined) return;
  const journey = yield* Effect.try({ try: () => project.importReplay?.(imported), catch: failed });
  if (journey === undefined) return;
  const replay = yield* Effect.tryPromise({ try: () => loadReplay(project.replay), catch: failed });
  const results = yield* Effect.try({ try: () => replayInClients(project.map, replay, journey.repro), catch: failed });
  const report = reproReport(file, journey.repro, results);
  yield* Console.log(report.lines.join("\n"));
  if (!report.landed) return yield* new ReproFailure({ file, problem: "the imported inputs do not reach the recorded checksum" });
  const supported = new Set(journey.simulatedActionOffsets);
  const offsets = imported.commands.flatMap(command => command.actions.map(action => command.offset + action.offset));
  if (supported.size !== journey.simulatedActionOffsets.length || [...supported].some(offset => !offsets.includes(offset))) return yield* new ReproFailure({ file, problem: "the adapter names duplicate or absent action offsets" });
  const saved = `${out}.repro.txt`;
  yield* Effect.try({ try: () => {
    writeFileSync(saved, writtenPreloadFile(reproLines(journey.repro, journey.repro.lines)));
    writeFileSync(out, `${JSON.stringify({ ...imported, ...(comparison === undefined ? {} : { comparison }), simulatedActionOffsets: [...supported], journey: { file: saved, checksum: journey.repro.checksum, frame: journey.repro.frame } }, null, 2)}\n`);
  }, catch: failed });
  yield* Console.log(`simulated ${supported.size} actions; retained ${actions.length - supported.size} other actions. Saved journey: ${saved}; scrub with repro ${saved} --view`);
});

const soakRepro = (project: ReproProject, { file, json, shrink, view, name, frame, out }: ReplayRequest, started: number) => Effect.gen(function*() {
  if (view) return yield* new UsageFailure({ problem: "--view takes a saved text moment with inspectRepro support" });
  if (project.soak === undefined) return yield* new ReproFailure({ file, problem: "the project needs a soak declaration to replay a soak JSON repro" });
  if (frame !== undefined) return yield* new UsageFailure({ problem: "--frame inspects saved text moments; soak repros support --shrink and --test" });
  const result = yield* replaySoakRepro(file, project.soak, { shrink, ...(out === undefined ? {} : { out }), ...(name === undefined ? {} : { name }) }).pipe(Effect.mapError(error => new ReproFailure({ file, problem: error.problem })));
  if (json) {
    yield* emitJson("repro", { type: "result", ok: true, repro: file, inputs: result.inputs, failureKind: result.failureKind });
    yield* emitJson("repro", { type: "summary", ok: true, counts: { results: 1, failures: 0 }, elapsedMs: performance.now() - started });
  } else yield* Console.log(result.output);
});

const viewRepro = (project: ReproProject, file: string, repro: Repro) => Effect.gen(function*() {
  const inspector = yield* Effect.tryPromise({ try: () => loadInspector(project.replay), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
  return yield* Effect.scoped(Effect.gen(function*() {
    const server = yield* Effect.try({ try: () => createReproViewer(project.map, inspector, repro, project.viewerSources, project.viewerScanDivergence), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) }).pipe(
      Effect.flatMap(viewer => serveReproViewer(viewer)),
      Effect.mapError(cause => new ReproFailure({ file, problem: describeCause(cause) })),
    );
    const address = `http://127.0.0.1:${server.port}/`;
    yield* Console.log(`saved match: ${address}`);
    yield* PageOpener.use((opener) => opener.open(address)).pipe(Effect.mapError(cause => new ReproFailure({ file, problem: `opening the page: ${cause.message}` })));
    yield* waitForProcessStop;
  }));
});

const inspectFrame = (project: ReproProject, file: string, repro: Repro, frame: number, diffFrame: number | undefined, out: string, json: boolean) => Effect.gen(function*() {
  const inspector = yield* Effect.tryPromise({ try: () => loadInspector(project.replay), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
  const inspection = yield* Effect.try({
    try: () => {
      const current = inspectInClients(project.map, inspector, repro, frame);
      const before = diffFrame === undefined ? undefined : inspectInClients(project.map, inspector, repro, diffFrame);
      return { build: repro.build, ...current, ...(before === undefined ? {} : { diff: { from: before.frame, to: current.frame, fields: diffReproStates(before, current) } }) };
    },
    catch: cause => new ReproFailure({ file, problem: describeCause(cause) }),
  });
  const target = resolve(out);
  yield* Effect.try({ try: () => {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(inspection, null, 2)}\n`);
  }, catch: cause => new ReproFailure({ file, problem: `writing ${target}: ${describeCause(cause)}` }) });
  if (!json) yield* Console.log(`wrote frame ${frame}, checksum ${inspection.checksum} to ${target}`);
});

const writeReproTest = (project: ReproProject, file: string, repro: Repro, lines: readonly string[], name: string) => Effect.gen(function*() {
  const target = join(project.tests, `${name}.tests.ts`);
  if (existsSync(target)) return yield* new ReproFailure({ file, problem: `${target} already exists` });
  yield* Effect.try({
    try: () => {
      mkdirSync(project.tests, { recursive: true });
      writeFileSync(target, reproTestSource(name, file, repro, importFrom(project.tests, project.replay), lines));
    },
    catch: (cause) => new ReproFailure({ file, problem: `writing ${target}: ${describeCause(cause)}` }),
  });
  return target;
});

export const makeRepro = (load: () => Promise<ReproProject>): Command => (args) => Effect.gen(function*() {
  const request = parseReproArgs(args);
  if (request instanceof UsageFailure) return yield* request;
  if (request.mode === "import") return yield* importRepro(load, request);
  const { file, json, shrink, view, name, frame, diffFrame, out } = request;
  const started = performance.now();
  if (out !== undefined && sameFile(out, file)) return yield* new UsageFailure({ problem: "the inspection output must be a different file from the saved repro" });
  const project = yield* Effect.tryPromise({ try: load, catch: (cause) => new ReproFailure({ file, problem: `loading the project: ${describeCause(cause)}` }) });
  const soak = yield* Effect.try({ try: () => readFileSync(file, "utf8").trimStart().startsWith("{"), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
  if (soak) return yield* soakRepro(project, request, started);
  if (shrink) return yield* new UsageFailure({ problem: "--shrink takes a soak JSON repro; saved state and text moments are not shrunk" });
  const { repro, lines } = yield* readRepro(file).pipe(step("read repro"));
  if (view) return yield* viewRepro(project, file, repro);
  const replay = yield* Effect.tryPromise({ try: () => loadReplay(project.replay), catch: (cause) => new ReproFailure({ file, problem: describeCause(cause) }) }).pipe(step("load replay"));
  const results = yield* Effect.try({
    try: () => replayInClients(project.map, replay, repro),
    catch: (cause) => new ReproFailure({ file, problem: `the replay stopped: ${describeCause(cause)}` }),
  }).pipe(step(`replay in ${CLIENTS.length} clients`));
  const report = reproReport(file, repro, results);
  const landed = (result: (typeof results)[number]) => result.checksum === repro.checksum && result.problems.length === 0;
  const summary = () => emitJson("repro", { type: "summary", ok: report.landed, counts: { results: results.length, failures: results.filter(result => !landed(result)).length }, elapsedMs: performance.now() - started });
  if (json) {
    for (const [client, result] of results.entries()) {
      const ok = landed(result);
      yield* emitJson("repro", { type: "result", ok, frame: repro.frame, client, repro: file, frames: result.frames, checksum: result.checksum, expectedChecksum: repro.checksum, ...(ok ? {} : { kind: result.checksum !== repro.checksum ? "desync" : "error", message: result.problems.join("; ") || "the replay checksum differs from the recorded moment" }) });
    }
  } else yield* Console.log(report.lines.join("\n"));
  if (!report.landed) {
    if (json) yield* summary();
    return yield* new ReproFailure({ file, problem: "the replay doesn't reproduce the moment" });
  }
  if (frame !== undefined && out !== undefined) yield* inspectFrame(project, file, repro, frame, diffFrame, out, json);
  if (name === undefined) {
    if (json) yield* summary();
    return;
  }
  const target = yield* writeReproTest(project, file, repro, lines, name);
  if (json) yield* summary();
  else yield* Console.log(`wrote ${target}`);
});
