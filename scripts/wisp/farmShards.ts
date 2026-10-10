











import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Effect, Schema } from "effect";
import { describeCause } from "./command";

export class FarmShardFailure extends Schema.TaggedError<FarmShardFailure>()("FarmShardFailure", { problem: Schema.String }) {
  override get message(): string {
    return this.problem;
  }
}

const Suite = Schema.Literals(["bun", "lua"]);
export type Suite = typeof Suite.Type;
const Seconds = Schema.Record(Schema.String, Schema.Finite);


export const Timings = Schema.Struct({ bun: Seconds, lua: Seconds });
export type Timings = typeof Timings.Type;


export const Plan = Schema.Struct({ bun: Schema.Array(Schema.Array(Schema.String)), lua: Schema.Finite, luaTests: Schema.Record(Schema.String, Schema.Finite) });
export type Plan = typeof Plan.Type;

export const TestResult = Schema.Struct({ name: Schema.String, unit: Schema.String, seconds: Schema.Finite, status: Schema.Literals(["pass", "fail", "skip"]) });
export type TestResult = typeof TestResult.Type;
export const ShardResult = Schema.Struct({ suite: Suite, shard: Schema.Finite, exitCode: Schema.Finite, tests: Schema.Array(TestResult) });
export type ShardResult = typeof ShardResult.Type;

const Count = Schema.Struct({ passed: Schema.Finite, failed: Schema.Finite, skipped: Schema.Finite, shards: Schema.Finite, slowestShardSeconds: Schema.Finite });

export const Summary = Schema.Struct({ bun: Count, lua: Count, failures: Schema.Array(Schema.String), problems: Schema.Array(Schema.String) });
export type Summary = typeof Summary.Type;


const FILE_OVERHEAD_SECONDS = 0.3;





export function splitByTime<U>(units: readonly U[], seconds: (unit: U) => number | undefined, shards: number): U[][] {
  const known = units.map(seconds).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
  const guess = known.length === 0 ? 1 : known[Math.floor(known.length / 2)] ?? 1;
  const timed = units.map((unit) => ({ unit, time: seconds(unit) ?? guess })).sort((a, b) => b.time - a.time);
  const bins = Array.from({ length: Math.max(1, shards) }, () => ({ units: [] as U[], time: 0 }));
  for (const { unit, time } of timed) {
    const bin = bins.reduce((least, next) => next.time < least.time ? next : least);
    bin.units.push(unit);
    bin.time += time;
  }
  return bins.map((bin) => bin.units).filter((group) => group.length > 0);
}

// bunfig.toml's pathIgnorePatterns: vendored repositories' tests never run, so they get no shard.
const ignored = (file: string) => file.startsWith("repos/");

export function plan(units: readonly string[], timings: Timings, bunShards: number, luaShards: number): Plan {
  const suite = units.filter((unit) => !unit.split(",").every(ignored));
  const unitSeconds = (unit: string) => {
    const files = unit.split(",");
    return files.every((file) => timings.bun[file] === undefined) ? undefined : files.reduce((sum, file) => sum + (timings.bun[file] ?? 0), 0);
  };
  const bun = splitByTime(suite, unitSeconds, bunShards).map((group) => group.flatMap((unit) => unit.split(",").filter((file) => !ignored(file))));
  const names = Object.keys(timings.lua);
  const luaTests: Record<string, number> = {};
  splitByTime(names, (name) => timings.lua[name], luaShards).forEach((group, shard) => {
    for (const name of group) luaTests[name] = shard;
  });
  return { bun, lua: luaShards, luaTests };
}

const unescapeXml = (text: string) => text.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (_, entity: string) => {
  const named: Record<string, string> = { lt: "<", gt: ">", quot: "\"", apos: "'", amp: "&" };
  if (entity in named) return named[entity] ?? "";
  return String.fromCodePoint(entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
});


export function parseJunit(xml: string, root: string): TestResult[] {
  const tests: TestResult[] = [];
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attributes = new Map([...(match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key = "", value = ""]) => [key, unescapeXml(value)]));
    const file = attributes.get("file") ?? "";
    const unit = file.startsWith("/") ? relative(root, file) : file;
    const body = match[3] ?? "";
    const classname = attributes.get("classname") ?? "";
    tests.push({
      name: [unit, classname, attributes.get("name") ?? ""].filter((part) => part !== "").join(" > "),
      unit,
      seconds: Number(attributes.get("time") ?? 0) || 0,
      status: /<failure\b|<error\b/.test(body) ? "fail" : /<skipped\b/.test(body) ? "skip" : "pass",
    });
  }
  return tests;
}


export function parseLuaLines(text: string): TestResult[] {
  return text.split("\n").flatMap((line) => {
    const [status, seconds, ...name] = line.split("\t");
    if ((status !== "pass" && status !== "fail") || name.length === 0) return [];
    return [{ name: name.join("\t"), unit: name.join("\t"), seconds: Number(seconds) || 0, status }];
  });
}

export function merge(planned: Plan, results: readonly ShardResult[], previous: Timings): { readonly summary: Summary; readonly timings: Timings } {
  const failures: string[] = [];
  const problems: string[] = [];
  const timings = { bun: { ...previous.bun }, lua: { ...previous.lua } };
  const count = (suite: Suite, shards: number) => {
    const mine = results.filter((result) => result.suite === suite);
    const totals = { passed: 0, failed: 0, skipped: 0, shards, slowestShardSeconds: 0 };
    const measured: Record<string, number> = {};
    for (let shard = 0; shard < shards; shard++) if (!mine.some((result) => result.shard === shard)) problems.push(`${suite} shard ${shard} sent no result`);
    for (const result of mine) {
      let shardSeconds = 0;
      const files = new Set<string>();
      for (const test of result.tests) {
        totals[test.status === "pass" ? "passed" : test.status === "fail" ? "failed" : "skipped"]++;
        if (test.status === "fail") failures.push(`${suite}: ${test.name}`);
        measured[test.unit] = (measured[test.unit] ?? 0) + test.seconds;
        shardSeconds += test.seconds;
        files.add(test.unit);
      }
      if (suite === "bun") for (const file of files) measured[file] = (measured[file] ?? 0) + FILE_OVERHEAD_SECONDS;
      totals.slowestShardSeconds = Math.max(totals.slowestShardSeconds, shardSeconds);
      if (result.exitCode !== 0 && !result.tests.some((test) => test.status === "fail")) {
        problems.push(`${suite} shard ${result.shard} exited ${result.exitCode} with no failing test: a file failed to load or the runner crashed (see its log)`);
      }
    }
    Object.assign(timings[suite], measured);
    return totals;
  };
  const bun = count("bun", planned.bun.length);
  const lua = count("lua", planned.lua);
  return { summary: { bun, lua, failures, problems }, timings };
}



const readJson = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, path: string) => Effect.try({
  try: () => readFileSync(path, "utf8"),
  catch: (cause) => new FarmShardFailure({ problem: `couldn't read ${path}: ${describeCause(cause)}` }),
}).pipe(Effect.flatMap((text) => Schema.decodeEffect(Schema.fromJsonString(schema))(text)),
  Effect.mapError((cause) => cause instanceof FarmShardFailure ? cause : new FarmShardFailure({ problem: `${path}: ${describeCause(cause)}` })));

const readText = (path: string) => Effect.try({
  try: () => readFileSync(path, "utf8"),
  catch: (cause) => new FarmShardFailure({ problem: `couldn't read ${path}: ${describeCause(cause)}` }),
});

const writeText = (path: string, text: string) => Effect.try({
  try: () => writeFileSync(path, text),
  catch: (cause) => new FarmShardFailure({ problem: `couldn't write ${path}: ${describeCause(cause)}` }),
});


const readTimings = (path: string) => existsSync(path) ? readJson(Timings, path) : Effect.succeed<Timings>({ bun: {}, lua: {} });

const main = Effect.gen(function*() {
  const { values, positionals } = yield* Effect.try({
    try: () => parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: {
      timings: { type: "string" }, bun: { type: "string" }, lua: { type: "string" }, shard: { type: "string" }, "exit-code": { type: "string" }, plan: { type: "string" }, out: { type: "string" },
    } }),
    catch: (cause) => new FarmShardFailure({ problem: describeCause(cause) }),
  });
  const [step, ...paths] = positionals;
  const shardResult = (suite: Suite, tests: readonly TestResult[]) => JSON.stringify({ suite, shard: Number(values.shard ?? 0), exitCode: Number(values["exit-code"] ?? 0), tests } satisfies ShardResult);
  switch (step) {
    case "plan":
      console.log(JSON.stringify(plan(paths, yield* readTimings(values.timings ?? ""), Number(values.bun ?? 1), Number(values.lua ?? 0))));
      return;
    case "lua-plan": {
      const planned = yield* readJson(Plan, paths[0] ?? "");
      console.log(Object.entries(planned.luaTests).map(([name, shard]) => `${name}\t${shard}`).join("\n"));
      return;
    }
    case "junit": {
      const texts = yield* Effect.forEach(paths.filter((path) => existsSync(path)), readText);
      console.log(shardResult("bun", texts.flatMap((xml) => parseJunit(xml, resolve(".")))));
      return;
    }
    case "lua": {
      const texts = yield* Effect.forEach(paths.filter((path) => existsSync(path)), readText);
      console.log(shardResult("lua", texts.flatMap(parseLuaLines)));
      return;
    }
    case "merge": {
      const timingsPath = values.timings ?? "";
      const results = yield* Effect.forEach(paths, (path) => readJson(ShardResult, path));
      const { summary, timings } = merge(yield* readJson(Plan, values.plan ?? ""), results, yield* readTimings(timingsPath));
      yield* writeText(timingsPath, `${JSON.stringify(timings)}\n`);
      yield* writeText(values.out ?? "summary.json", `${JSON.stringify(summary, null, 2)}\n`);
      return;
    }
    default:
      return yield* new FarmShardFailure({ problem: "farmShards.ts plan | lua-plan | junit | lua | merge" });
  }
});

if (import.meta.main) {
  Effect.runPromise(main).catch((failure: unknown) => {
    console.error(describeCause(failure));
    process.exit(1);
  });
}
