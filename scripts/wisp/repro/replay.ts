import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Effect, Schema } from "effect";
import { type Repro, type ReproInspector, type ReproInspection, type ReproReplay, type ReproResult, parseRepro } from "../../../src/runtime/repro";
import { describeCause } from "../command";
import { type HeadlessMap, installHeadless } from "../headless";
import { preloadRecord } from "../preloadRecord";

export class ReproFailure extends Schema.TaggedError<ReproFailure>()("ReproFailure", {
  file: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.file}: ${this.problem}`;
  }
}

export const CLIENTS = [0, 1];

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

export const isTestName = (name: string) => /^[a-z0-9][a-z0-9-]*$/.test(name);

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
