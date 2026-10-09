



import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Console, Effect, Schema } from "effect";
import { type Repro, type ReproInspector, type ReproInspection, type ReproReplay, type ReproResult, parseRepro } from "../../../src/runtime/repro";
import { preloadRecord } from "../boundary";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { type HeadlessMap, installHeadless } from "../headless";
import { step } from "../timings";
import { diffReproStates } from "../reproInspection";
import { replaySoakRepro } from "../reproSoak";
import { emitJson } from "../jsonResults";
import { createReproViewer, serveReproViewer, type ReproViewerSources } from "../reproViewer";
import { waitForProcessStop } from "./hot";
import { importNativeReplay, compareReplayHost, type NativeReplay } from "../replayImport";
import { writtenPreloadFile } from "../headlessInput";
import { reproLines } from "../../../src/runtime/repro";


export interface ReproProject {
  readonly viewerSources?: ReproViewerSources;

  readonly viewerScanDivergence?: boolean;
  readonly map: HeadlessMap;





  readonly replay: string;

  readonly tests: string;

  readonly importReplay?: (replay: NativeReplay) => { readonly repro: Repro; readonly simulatedActionOffsets: readonly number[] };

  readonly soak?: { readonly project: string; readonly tests: string };
}

export class ReproFailure extends Schema.TaggedError<ReproFailure>()("ReproFailure", {
  file: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.file}: ${this.problem}`;
  }
}


const CLIENTS = [0, 1];

const ReproFile = preloadRecord({ rest: "lines" }, Schema.Struct({ lines: Schema.Array(Schema.String) }));


export const readRepro = (file: string) => Effect.gen(function*() {
  const text = yield* Effect.try({ try: () => readFileSync(file, "utf8"), catch: (cause) => new ReproFailure({ file, problem: describeCause(cause) }) });
  const { lines } = yield* ReproFile.decode(file, text).pipe(Effect.mapError((error) => new ReproFailure({ file, problem: error.message })));
  const repro = parseRepro(lines);
  return typeof repro === "string" ? yield* new ReproFailure({ file, problem: repro }) : { repro, lines };
});


export async function loadReplay(path: string): Promise<ReproReplay> {
  const module: unknown = await import(path);
  if (typeof module !== "object" || module === null || !("replayRepro" in module) || typeof module.replayRepro !== "function") throw new Error(`${path} exports no replayRepro()`);
  const { replayRepro } = module;
  return (repro) => replayRepro(repro);
}


export async function loadInspector(path: string): Promise<ReproInspector> {
  const module: unknown = await import(path);
  if (typeof module !== "object" || module === null || !("inspectRepro" in module) || typeof module.inspectRepro !== "function") throw new Error(`${path} exports no inspectRepro()`);
  const { inspectRepro } = module;
  return (repro, frame) => inspectRepro(repro, frame);
}


export function replayInClients(map: HeadlessMap, replay: ReproReplay, repro: Repro): ReproResult[] {
  return inClients(map, () => replay(repro));
}

export function inspectInClients(map: HeadlessMap, inspect: ReproInspector, repro: Repro, frame: number): ReproInspection {
  const results = inspectClientStates(map, inspect, repro, frame);
  const first = results[0];
  if (first === undefined) throw new Error("no inspection result");
  if (typeof first === "string") throw new Error(first);
  if (first.frame !== frame) throw new Error(`requested frame ${frame}, the inspector returned frame ${first.frame}`);
  for (const result of results) {
    if (typeof result === "string") throw new Error(result);
    if (JSON.stringify(result) !== JSON.stringify(first)) throw new Error(`clients disagree on the state of frame ${frame}`);
  }
  return first;
}

export function inspectClientStates(map: HeadlessMap, inspect: ReproInspector, repro: Repro, frame: number): ReproInspection[] {
  return inClients(map, () => inspect(repro, frame)).map(result => {
    if (typeof result === "string") throw new Error(result);
    if (result.frame !== frame) throw new Error(`requested frame ${frame}, the inspector returned frame ${result.frame}`);
    return result;
  });
}

function inClients<Result>(map: HeadlessMap, run: () => Result): Result[] {
  const runtime = installHeadless(map);
  try {

    const clients = runtime.clients({ start: () => undefined, install: () => undefined }, CLIENTS);
    return clients.clients.map((client) => {
      let result: Result | undefined;
      client.run(() => {
        result = run();
      });
      if (result === undefined) throw new Error(`p${client.slot} replayed nothing`);
      return result;
    });
  } finally {
    runtime.restore();
  }
}


export function reproReport(file: string, repro: Repro, results: readonly ReproResult[]): { readonly lines: string[]; readonly landed: boolean } {
  const lines = [`${basename(file)}: build ${repro.build}, frame ${repro.frame}, checksum ${repro.checksum}`];
  let landed = true;
  results.forEach((result, slot) => {
    lines.push(`p${slot}: ran ${result.frames} frames to checksum ${result.checksum}`);
    for (const problem of result.problems) lines.push(`p${slot}: ${problem}`);
    if (result.checksum !== repro.checksum || result.problems.length > 0) landed = false;
  });
  lines.push(landed
    ? `every client lands on the recorded checksum ${repro.checksum} at frame ${repro.frame}`
    : `the replay doesn't land on the recorded checksum ${repro.checksum} at frame ${repro.frame}`);
  return { lines, landed };
}


const isTestName = (name: string) => /^[a-z0-9][a-z0-9-]*$/.test(name);


export function reproTestSource(name: string, file: string, repro: Repro, replayImport: string, lines: readonly string[]): string {
  return [
    `// \`wisp repro ${basename(file)} --test ${name}\` wrote this: the moment build`,
    `// ${repro.build} saved, ending on frame ${repro.frame}. Replaying it must reach the checksum the game recorded.`,
    `import { assertReproLands } from "wisp/src/runtime/repro";`,
    `import { test } from "wisp/src/runtime/testing";`,
    `import { replayRepro } from "${replayImport}";`,
    "",
    "const LINES = [",
    ...lines.map((line) => `  ${JSON.stringify(line)},`),
    "];",
    "",
    `test("repro ${name}", () => assertReproLands(LINES, replayRepro));`,
    "",
  ].join("\n");
}


function importFrom(directory: string, module: string): string {
  const path = relative(directory, module).replace(/\.ts$/, "");
  return path.startsWith(".") ? path : `./${path}`;
}


export const makeRepro = (load: () => Promise<ReproProject>): Command => (args) => Effect.gen(function*() {
  if (args[0] === "import") {
    const values = flagValues(args, "out");
    const out = values[0];
    const objects = args.slice(1).filter((arg, index) => !arg.startsWith("--") && args[index] !== "--out");
    const file = objects[0];
    const host = objects[1];
    if (file === undefined || objects.length > 2 || out === undefined || values.length !== 1 || args.some(arg => arg.startsWith("--") && arg !== "--out" && !arg.startsWith("--out="))) return yield* new UsageFailure({ problem: "repro import FILE.w3g [HOST.log] --out ACTIONS.json" });
    if (resolve(file) === resolve(out) || existsSync(out) && realpathSync(out) === realpathSync(file)) return yield* new UsageFailure({ problem: "the import output must differ from the native replay" });
    const imported = yield* Effect.tryPromise({ try: () => importNativeReplay(readFileSync(file)), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
    const comparison = host === undefined ? undefined : yield* Effect.try({ try: () => compareReplayHost(imported, readFileSync(host, "utf8")), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
    yield* Effect.try({ try: () => { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, `${JSON.stringify({ ...imported, ...(comparison === undefined ? {} : { comparison }) }, null, 2)}\n`); }, catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
    const actions = imported.commands.flatMap(command => command.actions);
    yield* Console.log(`imported ${imported.turns} turns, ${actions.length} actions (${actions.filter(action => action.kind === "raw").length} unknown); raw bytes and offsets: ${out}`);
    if (comparison !== undefined) {
      yield* Console.log(`host ${comparison.hostActions}, replay ${comparison.replayActions}: ${comparison.differences.length} differences`);
      if (comparison.differences.length > 0) return yield* new ReproFailure({ file, problem: comparison.differences.slice(0, 5).join("\n") });
    }
    const project = yield* Effect.tryPromise({ try: load, catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
    if (project.importReplay !== undefined) {
      const journey = yield* Effect.try({ try: () => project.importReplay?.(imported), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
      if (journey === undefined) return;
      const replay = yield* Effect.tryPromise({ try: () => loadReplay(project.replay), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
      const results = yield* Effect.try({ try: () => replayInClients(project.map, replay, journey.repro), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
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
      }, catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
      yield* Console.log(`simulated ${supported.size} actions; retained ${actions.length - supported.size} other actions. Saved journey: ${saved}; scrub with repro ${saved} --view`);
    }
    return;
  }
  const json = args.includes("--json");
  const shrink = args.includes("--shrink");
  const view = args.includes("--view");
  const started = performance.now();
  args = args.filter(arg => arg !== "--json" && arg !== "--shrink" && arg !== "--view");
  const [name, ...extra] = flagValues(args, "test");
  const [frameText, ...extraFrames] = flagValues(args, "frame");
  const [diffText, ...extraDiffs] = flagValues(args, "diff-frame");
  const [out, ...extraOut] = flagValues(args, "out");
  const flags = ["--test", "--frame", "--diff-frame", "--out"];
  const files = args.filter((arg, index) => !arg.startsWith("--") && !flags.includes(args[index - 1] ?? ""));
  const file = files[0];
  if (view && (json || shrink || name !== undefined || frameText !== undefined || out !== undefined || diffText !== undefined)) return yield* new UsageFailure({ problem: "--view takes only the saved repro file" });
  if (file === undefined || files.length > 1 || extra.length + extraFrames.length + extraDiffs.length + extraOut.length > 0 || flags.some(flag => args.includes(flag) && flagValues(args, flag.substring(2)).length === 0) || args.some(arg => arg.startsWith("--") && !flags.some(flag => arg === flag || arg.startsWith(`${flag}=`)))) {
    return yield* new UsageFailure({ problem: "repro takes one file, --test NAME, --shrink [--out FILE], or --frame N --out FILE [--diff-frame N|previous]" });
  }
  if (name !== undefined && !isTestName(name)) return yield* new UsageFailure({ problem: `test names are lowercase letters, digits and hyphens: ${name}` });
  const frame = frameText === undefined ? undefined : Number(frameText);
  const diffFrame = diffText === undefined ? undefined : diffText === "previous" ? (frame ?? 0) - 1 : Number(diffText);
  if ((frame !== undefined && (!/^\d+$/.test(frameText ?? "") || !Number.isSafeInteger(frame))) || (diffFrame !== undefined && (diffText !== "previous" && !/^\d+$/.test(diffText ?? "") || !Number.isSafeInteger(diffFrame)))) return yield* new UsageFailure({ problem: "inspection frames must be nonnegative whole numbers" });
  if ((!shrink && (frame !== undefined) !== (out !== undefined)) || (shrink && frame !== undefined) || (diffFrame !== undefined && frame === undefined)) return yield* new UsageFailure({ problem: "use --shrink [--out FILE], or --frame N --out FILE [--diff-frame N|previous]" });
  if (out !== undefined && (resolve(out) === resolve(file) || existsSync(out) && realpathSync(out) === realpathSync(file))) return yield* new UsageFailure({ problem: "the inspection output must be a different file from the saved repro" });
  const project = yield* Effect.tryPromise({ try: load, catch: (cause) => new ReproFailure({ file, problem: `loading the project: ${describeCause(cause)}` }) });
  const soak = yield* Effect.try({ try: () => readFileSync(file, "utf8").trimStart().startsWith("{"), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
  if (soak) {
    if (view) return yield* new UsageFailure({ problem: "--view takes a saved text moment with inspectRepro support" });
    if (project.soak === undefined) return yield* new ReproFailure({ file, problem: "the project needs a soak declaration to replay a soak JSON repro" });
    if (frame !== undefined) return yield* new UsageFailure({ problem: "--frame inspects saved text moments; soak repros support --shrink and --test" });
    const result = yield* replaySoakRepro(file, project.soak, { shrink, ...(out === undefined ? {} : { out }), ...(name === undefined ? {} : { name }) }).pipe(Effect.mapError(error => new ReproFailure({ file, problem: error.problem })));
    if (json) {
      yield* emitJson("repro", { type: "result", ok: true, repro: file, inputs: result.inputs, failureKind: result.failureKind });
      yield* emitJson("repro", { type: "summary", ok: true, counts: { results: 1, failures: 0 }, elapsedMs: performance.now() - started });
    } else yield* Console.log(result.output);
    return;
  }
  if (shrink) return yield* new UsageFailure({ problem: "--shrink takes a soak JSON repro; saved state and text moments are not shrunk" });
  const { repro, lines } = yield* readRepro(file).pipe(step("read repro"));
  if (view) {
    const inspector = yield* Effect.tryPromise({ try: () => loadInspector(project.replay), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) });
    return yield* Effect.scoped(Effect.gen(function*() {
      const server = yield* Effect.try({ try: () => createReproViewer(project.map, inspector, repro, project.viewerSources, project.viewerScanDivergence), catch: cause => new ReproFailure({ file, problem: describeCause(cause) }) }).pipe(
        Effect.flatMap(viewer => serveReproViewer(viewer)),
        Effect.mapError(cause => new ReproFailure({ file, problem: describeCause(cause) })),
      );
      const address = `http://127.0.0.1:${server.port}/`;
      yield* Console.log(`saved match: ${address}`);
      yield* Effect.try({ try: () => { Bun.spawn(["xdg-open", address], { stdout: "ignore", stderr: "ignore" }); }, catch: cause => new ReproFailure({ file, problem: `opening the page: ${describeCause(cause)}` }) });
      yield* waitForProcessStop;
    }));
  }
  const replay = yield* Effect.tryPromise({ try: () => loadReplay(project.replay), catch: (cause) => new ReproFailure({ file, problem: describeCause(cause) }) }).pipe(step("load replay"));
  const results = yield* Effect.try({
    try: () => replayInClients(project.map, replay, repro),
    catch: (cause) => new ReproFailure({ file, problem: `the replay stopped: ${describeCause(cause)}` }),
  }).pipe(step(`replay in ${CLIENTS.length} clients`));
  const report = reproReport(file, repro, results);
  const summary = () => emitJson("repro", { type: "summary", ok: report.landed, counts: { results: results.length, failures: results.filter(result => result.checksum !== repro.checksum || result.problems.length > 0).length }, elapsedMs: performance.now() - started });
  if (json) {
    for (const [client, result] of results.entries()) {
      const ok = result.checksum === repro.checksum && result.problems.length === 0;
      yield* emitJson("repro", { type: "result", ok, frame: repro.frame, client, repro: file, frames: result.frames, checksum: result.checksum, expectedChecksum: repro.checksum, ...(ok ? {} : { kind: result.checksum !== repro.checksum ? "desync" : "error", message: result.problems.join("; ") || "the replay checksum differs from the recorded moment" }) });
    }
  } else yield* Console.log(report.lines.join("\n"));
  if (!report.landed) {
    if (json) yield* summary();
    return yield* new ReproFailure({ file, problem: "the replay doesn't reproduce the moment" });
  }
  if (frame !== undefined && out !== undefined) {
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
  }
  if (name === undefined) {
    if (json) yield* summary();
    return;
  }
  const target = join(project.tests, `${name}.tests.ts`);
  if (existsSync(target)) return yield* new ReproFailure({ file, problem: `${target} already exists` });
  yield* Effect.try({
    try: () => {
      mkdirSync(project.tests, { recursive: true });
      writeFileSync(target, reproTestSource(name, file, repro, importFrom(project.tests, project.replay), lines));
    },
    catch: (cause) => new ReproFailure({ file, problem: `writing ${target}: ${describeCause(cause)}` }),
  });
  if (json) yield* summary();
  else yield* Console.log(`wrote ${target}`);
});
