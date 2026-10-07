// `wisp engine ...`: a read-only debugger into Warcraft III's engine for
// network desyncs (wisp:docs/engine.md).
//   desync A B [--turn N]        compare two clients' Desync.log dumps: first differing turn and section, decoded ipse
//   poll --client a,b            log every agent born and freed in each client's presence table, with its class
//   diff A.log B.log             align two poll logs by birth number
//   watch --client a             hardware breakpoint on the birth counter; each birth's game stack, frames named
//   locate --client a            find the presence table in a running client of any build; check or derive offsets.json's entry
// For debugging your own map on your own development clients, never for
// cheating or touching other players' games. Live commands attach only to
// clients in the clients file, through wisp:scripts/wisp/engine/attach.ts:
// reads on any dev client, breakpoints only on an offline one. Nothing writes
// to a game process, stops it or injects code.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Console, Effect, Schema } from "effect";
import type { Client } from "../clients";
import { type Command, UsageFailure, describeCause, flagValues } from "../command";
import { compareDesyncLogs, findDesyncLog } from "../engine/desyncLog";
import { type AttachedClient, type EngineAccess, type EngineClient, attachClient } from "../engine/attach";
import { type GameExecutable, prefixOfDocuments } from "../engine/memory";
import { type EngineOffsets, OFFSETS_FILE, offsetsEntry, offsetsFor, parseOffsets } from "../engine/offsets";
import { pollPresence } from "../engine/poll";
import { diffPresenceLogs, parsePresenceLog } from "../engine/presenceLog";
import { alignBirths, headerStart, isActionLog, parseActionLog } from "../engine/actionLog";
import { actions } from "../lan/actionsCommand";
import { type LuaFrame, findLuaStates, findLuaThreads, frameText, globalFunctionNames, luaStack, mainLuaState } from "../engine/lua";
import { PresenceTracker, presenceTable, readHeader, scanForPresenceTable } from "../engine/presence";
import { stopWatch } from "../engine/stopWatch";
import { type Frame, parsePerfData, sampleFrames } from "../engine/perfData";
import { toTypeScript } from "../../sourceMaps";
import { watchedClients } from "../clientWatchCommand";

export class EngineFailure extends Schema.TaggedError<EngineFailure>()("EngineFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

const attempt = <A>(what: string, run: () => A) => Effect.try({ try: run, catch: (cause) => new EngineFailure({ problem: `${what}: ${describeCause(cause)}` }) });

/** The clients `--client a,b` names, as name and Wine prefix. */
const namedClients = (clientsFile: string, args: readonly string[]) => Effect.gen(function*() {
  const names = flagValues(args, "client").flatMap((value) => value.split(",")).filter((name) => name !== "");
  if (names.length === 0) return yield* new UsageFailure({ problem: "name the clients with --client a,b" });
  const all: readonly Client[] = yield* watchedClients(clientsFile).pipe(Effect.mapError((failure) => new EngineFailure({ problem: failure.message })));
  const unknown = names.filter((name) => !all.some((client) => client.name === name));
  if (unknown.length > 0) return yield* new UsageFailure({ problem: `unknown client ${unknown.join(", ")}; known: ${all.map(({ name }) => name).join(", ")}` });
  return names.map((name) => ({ name, prefix: prefixOfDocuments(all.find((client) => client.name === name)?.documents ?? "") }));
});

const attachAll = (clients: readonly EngineClient[], access: EngineAccess) => Effect.forEach(clients, (client) =>
  attempt(`attach ${client.name}`, () => attachClient(client, access)).pipe(Effect.flatMap((result) => typeof result === "string" ? Effect.fail(new EngineFailure({ problem: result })) : Effect.succeed(result))));

const offsetsOf = (client: AttachedClient) => {
  const offsets = offsetsFor(client.exe.version);
  return typeof offsets === "string" ? Effect.fail(new EngineFailure({ problem: offsets })) : Effect.succeed(offsets);
};

const stateDirectory = () => join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "wisp/engine", new Date().toISOString().replace(/[:.]/g, "-"));

const number = (args: readonly string[], name: string, fallback: number) => Effect.gen(function*() {
  const [text] = flagValues(args, name);
  if (text === undefined) return fallback;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : yield* new UsageFailure({ problem: `--${name} takes a positive number` });
});

const positionals = (args: readonly string[], flagsWithValues: readonly string[]) =>
  args.filter((arg, index) => !arg.startsWith("--") && !flagsWithValues.some((flag) => args[index - 1] === `--${flag}`));

const desync: Command = (args) => Effect.gen(function*() {
  const paths = positionals(args, ["turn"]);
  if (paths.length !== 2) return yield* new UsageFailure({ problem: "desync takes two clients' Desync.log files, report folders or Documents/Warcraft III folders" });
  const [turnText] = flagValues(args, "turn");
  const logs = yield* Effect.forEach(paths, (path) => {
    const log = findDesyncLog(path);
    return log === undefined ? Effect.fail(new EngineFailure({ problem: `no *_Desync.log at ${path}` })) : Effect.succeed(log);
  });
  const report = yield* attempt("compare Desync.logs", () => compareDesyncLogs(logs[0] ?? "", logs[1] ?? "", turnText === undefined ? undefined : Number(turnText)));
  yield* Console.log(report);
});

const diff: Command = (args) => Effect.gen(function*() {
  const paths = positionals(args, ["skew", "limit", "source-maps", "turn-ms", "class"]);
  if (paths.length !== 2) return yield* new UsageFailure({ problem: "diff takes two poll logs, or a LAN action log and a poll log" });
  const skew = yield* number(args, "skew", 0.1);
  const limit = yield* number(args, "limit", 12);
  const [sourceMaps] = flagValues(args, "source-maps");
  const texts = yield* Effect.forEach(paths, (path) => attempt(`read ${path}`, () => readFileSync(path, "utf8")));
  const actionIndex = texts.findIndex(isActionLog);
  if (actionIndex >= 0) {
    // One LAN host action log and one poll log: each birth placed in the turn the network had just delivered.
    const poll = texts[1 - actionIndex] ?? "";
    const pollStart = headerStart(poll);
    if (pollStart === undefined) return yield* new EngineFailure({ problem: `${paths[1 - actionIndex]} names no start time; is it a wisp engine poll log?` });
    const [turnText] = flagValues(args, "turn-ms");
    const [classes] = flagValues(args, "class");
    const lines = yield* attempt("align births with turns", () => alignBirths(parseActionLog(texts[actionIndex] ?? ""), parsePresenceLog(poll), pollStart, { turnMs: turnText === undefined ? 30 : Number(turnText), limit: limit * 50, ...(classes === undefined ? {} : { classes: new RegExp(classes) }) }));
    yield* Console.log(lines.length === 0 ? "no births in the action log's time" : lines.join("\n"));
    return;
  }
  const logs = texts.map(parsePresenceLog);
  const report = diffPresenceLogs([paths[0] ?? "", paths[1] ?? ""], logs[0] ?? [], logs[1] ?? [], { skew, limit });
  // Code callbacks carry the chunk and line their Lua function was defined at; the map's source maps turn them into TypeScript lines.
  yield* Console.log(sourceMaps === undefined ? report : yield* Effect.promise(() => toTypeScript(report, sourceMaps)));
});

const poll = (clientsFile: string): Command => (args) => Effect.gen(function*() {
  const clients = yield* namedClients(clientsFile, args);
  const seconds = yield* number(args, "seconds", Number.POSITIVE_INFINITY);
  const interval = yield* number(args, "interval", 2);
  const [out = stateDirectory()] = flagValues(args, "out");
  yield* Console.log(`polling ${clients.map(({ name }) => name).join(", ")} every ${interval} ms into ${out}${Number.isFinite(seconds) ? ` for ${seconds} s` : " until interrupted"}`);
  const summaries = yield* pollPresence(clients, { out, interval, onNote: (client, text) => console.error(`${client}: ${text}`), ...(Number.isFinite(seconds) ? { seconds } : {}) }).pipe(
    Effect.mapError((cause) => new EngineFailure({ problem: describeCause(cause) })),
  );
  for (const { client, births, frees, log } of summaries) yield* Console.log(`${client}: ${births} births, ${frees} frees -> ${log}`);
  if (summaries.length === 2) yield* Console.log(`compare: wisp engine diff ${summaries.map(({ log }) => log).join(" ")}`);
});

const PERF_PARANOID = "/proc/sys/kernel/perf_event_paranoid";

/** perf from --perf, PATH, or nixpkgs. */
const perfProgram = (args: readonly string[]) => Effect.gen(function*() {
  const [given] = flagValues(args, "perf");
  if (given !== undefined) return given;
  const found = Bun.which("perf");
  if (found !== null) return found;
  const built = Bun.spawnSync(["nix", "build", "--no-link", "--print-out-paths", "nixpkgs#perf"], { stdout: "pipe", stderr: "pipe" });
  if (built.exitCode !== 0) return yield* new EngineFailure({ problem: `no perf on PATH and nix couldn't build nixpkgs#perf: ${built.stderr.toString().trim()}; pass --perf BIN` });
  return join(built.stdout.toString().trim().split("\n")[0] ?? "", "bin/perf");
});

const perfAllowed = Effect.suspend(() => {
  const level = existsSync(PERF_PARANOID) ? Number(readFileSync(PERF_PARANOID, "utf8").trim()) : 2;
  return level <= 2 ? Effect.void : Effect.fail(new EngineFailure({ problem: `perf can't watch another process at kernel.perf_event_paranoid=${level}; with the owner's agreement: sudo sysctl kernel.perf_event_paranoid=2 (restore: sudo sysctl kernel.perf_event_paranoid=${level})` }));
});

/** Records every write to `address` in `pid` for `seconds` with the user stack, by a hardware breakpoint. */
const recordWrites = (perf: string, pid: number, address: number, seconds: number, file: string) => Effect.tryPromise({
  try: async () => {
    const child = Bun.spawn([perf, "record", "-q", "-e", `mem:0x${address.toString(16)}/4:w`, "-p", String(pid), "--call-graph", "dwarf,4096", "-o", file, "--", "sleep", String(seconds)], { stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    if (code !== 0 || !existsSync(file)) throw new Error(`perf record exited with ${code}: ${stderr.trim()}`);
    return parsePerfData(readFileSync(file));
  },
  catch: (cause) => new EngineFailure({ problem: `watch pid ${pid}: ${describeCause(cause)}` }),
});

const codeEnd = (exe: GameExecutable) => {
  const text = exe.header.sections.find(({ name }) => name === ".text");
  return text === undefined ? exe.header.sizeOfImage : text.rva + text.virtualSize;
};

const symbolizer = (client: AttachedClient, offsets: EngineOffsets) => ({ base: client.base, codeEnd: codeEnd(client.exe), functions: client.exe.functions, offsets, memory: client.memory });

const stackText = (frames: readonly Frame[]) => frames.map(({ label }) => label).join(" < ");

/**
 * `watch --lua`: stops the game's main thread at every birth (ptrace and a
 * debug-register watchpoint) and reads the Lua VM's exact call stack while it
 * is stopped. Offline clients only, like every trap.
 */
const watchLua = (client: AttachedClient, offsets: EngineOffsets, seconds: number, limit: number, out: string, sourceMaps: string | undefined) => Effect.gen(function*() {
  const states = mainLuaState(client.memory, client.base, offsets.lua?.state) ?? findLuaStates(client.memory, client.maps);
  const state = typeof states === "number" ? states : states[0];
  if (state === undefined) return yield* new EngineFailure({ problem: `${client.name}: no Lua VM found (is a map running?)` });
  if (Array.isArray(states) && states.length > 1) return yield* new EngineFailure({ problem: `${client.name}: ${states.length} Lua VMs found; can't tell the map's` });
  const names = yield* attempt("read the Lua globals", () => globalFunctionNames(client.memory, state));
  // Map callbacks run in coroutines of the map's VM, not in its main state.
  let threads = yield* attempt("find the Lua threads", () => findLuaThreads(client.memory, client.maps, state));
  const table = presenceTable(client.memory, client.base, offsets);
  const tracker = new PresenceTracker(client.memory, client.base, offsets);
  tracker.poll();
  const stacks: { birth: number; frames: LuaFrame[] }[] = [];
  yield* Console.log(`${client.name}: stopping pid ${client.pid}'s main thread at each birth for ${seconds} s (at most ${limit})`);
  const hits = yield* attempt("watch births", () => stopWatch({
    tid: client.pid,
    address: table + offsets.table.births,
    seconds,
    limit,
    onHit: () => {
      // The counter was just incremented: the birth being given is one less.
      const birth = readHeader(client.memory, table, offsets).births - 1;
      // The thread making the birth is the one whose innermost frame is a native call.
      const running = (candidates: readonly number[]) => candidates.map((thread) => {
        try {
          return luaStack(client.memory, thread, names);
        } catch {
          return [];
        }
      }).find((frames) => frames[0]?.kind === "c" && frames[0].name !== undefined);
      let frames = running(threads);
      if (frames === undefined) {
        threads = findLuaThreads(client.memory, client.maps, state);
        frames = running(threads);
      }
      stacks.push({ birth, frames: frames ?? [] });
    },
  }));
  const born = new Map(tracker.poll().filter(({ kind }) => kind === "born").map(({ agent }) => [agent.birth, agent]));
  const lines = stacks.map(({ birth, frames }) => {
    const agent = born.get(birth);
    const what = agent === undefined ? "(freed before the next look)" : `${agent.className}${agent.owner === undefined ? "" : ` owner ${agent.owner}`}${agent.defined === undefined ? "" : ` at ${agent.defined}`}`;
    return `birth ${birth} ${what}: ${frames.length === 0 ? "(not from Lua)" : frames.map(frameText).join(" <- ")}`;
  });
  const text = lines.join("\n");
  const mapped = sourceMaps === undefined ? text : yield* Effect.promise(() => toTypeScript(text, sourceMaps));
  const file = join(out, `${client.name}.lua-stacks.txt`);
  yield* attempt(`write ${file}`, () => writeFileSync(file, `# wisp engine trace --lua: client ${client.name} pid ${client.pid} build ${client.exe.version}\n${mapped}\n`));
  yield* Console.log(`${client.name}: ${hits} births stopped -> ${file}`);
  const fromLua = mapped.split("\n").filter((line) => !line.endsWith("(not from Lua)"));
  for (const line of fromLua.slice(0, 20)) yield* Console.log(`  ${line}`);
});

const watch = (clientsFile: string): Command => (args) => Effect.gen(function*() {
  const clients = yield* namedClients(clientsFile, args);
  const seconds = yield* number(args, "seconds", 10);
  if (args.includes("--lua")) {
    const limit = yield* number(args, "limit", 200);
    const [out = stateDirectory()] = flagValues(args, "out");
    const [sourceMaps] = flagValues(args, "source-maps");
    yield* attempt("create the output folder", () => mkdirSync(out, { recursive: true }));
    const attached = yield* attachAll(clients, "trap");
    yield* Effect.forEach(attached, (client) => Effect.gen(function*() {
      const offsets = yield* offsetsOf(client);
      yield* watchLua(client, offsets, seconds, limit, out, sourceMaps);
    }))
      .pipe(Effect.ensuring(Effect.sync(() => { for (const client of attached) client.memory.close(); })));
    return;
  }
  const depth = yield* number(args, "depth", 8);
  const [out = stateDirectory()] = flagValues(args, "out");
  yield* perfAllowed;
  const perf = yield* perfProgram(args);
  yield* attempt("create the output folder", () => mkdirSync(out, { recursive: true }));
  const attached = yield* attachAll(clients, "trap");
  yield* Effect.forEach(attached, (client) => Effect.gen(function*() {
    const offsets = yield* offsetsOf(client);
    const table = presenceTable(client.memory, client.base, offsets);
    const before = readHeader(client.memory, table, offsets).births;
    yield* Console.log(`${client.name}: watching births at 0x${(table + offsets.table.births).toString(16)} (pid ${client.pid}, counter ${before}) for ${seconds} s`);
    const data = yield* recordWrites(perf, client.pid, table + offsets.table.births, seconds, join(out, `${client.name}.perf.data`));
    const symbols = symbolizer(client, offsets);
    const first = data.samples[0]?.time ?? 0n;
    const lines = [`# wisp engine trace: client ${client.name} pid ${client.pid} build ${client.exe.version} base 0x${client.base.toString(16)}; one line per write to the birth counter, from ${before}${data.lost > 0 ? `; ${data.lost} writes lost, so births after a loss are estimates` : ""}`];
    const stacks = new Map<string, { count: number; births: number[] }>();
    for (const [index, sample] of data.samples.entries()) {
      const frames = sampleFrames(sample, symbols);
      const birth = before + index;
      lines.push(`${(Number(sample.time - first) / 1e9).toFixed(4)} tid ${sample.tid} birth ${birth}: ${stackText(frames)}`);
      const key = stackText(frames.slice(0, depth));
      const entry = stacks.get(key) ?? { count: 0, births: [] };
      entry.count++;
      entry.births.push(birth);
      stacks.set(key, entry);
    }
    const file = join(out, `${client.name}.stacks.txt`);
    yield* attempt(`write ${file}`, () => writeFileSync(file, `${lines.join("\n")}\n`));
    yield* Console.log(`${client.name}: ${data.samples.length} births${data.lost > 0 ? ` (${data.lost} lost)` : ""} in ${stacks.size} distinct stacks -> ${file}`);
    for (const [stack, { count, births }] of [...stacks].sort((x, y) => y[1].count - x[1].count).slice(0, 10)) {
      yield* Console.log(`  ${String(count).padStart(5)}x (births ${births.slice(0, 3).join(", ")}${births.length > 3 ? ", ..." : ""}) ${stack}`);
    }
  }), { concurrency: "unbounded" }).pipe(Effect.ensuring(Effect.sync(() => { for (const client of attached) client.memory.close(); })));
});

/** The function most samples were in: the code that writes the watched field. */
function writer(samples: readonly { ip: number }[], client: AttachedClient, exclude: ReadonlySet<number>): number | undefined {
  const counts = new Map<number, number>();
  for (const { ip } of samples) {
    const rva = ip - client.base;
    let start: number | undefined;
    for (let low = 0, high = client.exe.functions.length / 3 - 1; low <= high;) {
      const middle = (low + high) >> 1;
      const begin = client.exe.functions[middle * 3] ?? 0;
      const end = client.exe.functions[middle * 3 + 1] ?? 0;
      if (rva < begin) high = middle - 1;
      else if (rva >= end) low = middle + 1;
      else { start = begin; break; }
    }
    if (start !== undefined && !exclude.has(start)) counts.set(start, (counts.get(start) ?? 0) + 1);
  }
  return [...counts].sort((x, y) => y[1] - x[1])[0]?.[0];
}

const locate = (clientsFile: string): Command => (args) => Effect.gen(function*() {
  const clients = yield* namedClients(clientsFile, args);
  if (clients.length !== 1) return yield* new UsageFailure({ problem: "locate takes one client" });
  const watchSeconds = yield* number(args, "trace", Number.NaN).pipe(Effect.orElseSucceed(() => Number.NaN));
  const [client] = yield* attachAll(clients, Number.isFinite(watchSeconds) ? "trap" : "read");
  if (client === undefined) return;
  yield* Effect.gen(function*() {
    const known = parseOffsets(readFileSync(OFFSETS_FILE, "utf8"));
    const existing = known.get(client.exe.version);
    // The table's own layout is assumed unchanged from the newest known build; the scan fails when it moved.
    const layout = existing ?? [...known.values()].at(-1);
    if (layout === undefined) return yield* new EngineFailure({ problem: `${OFFSETS_FILE} has no entry to take the table layout from` });
    const data = client.exe.header.sections.find(({ name }) => name === ".data");
    if (data === undefined) return yield* new EngineFailure({ problem: `${client.exe.path} has no .data section` });
    const span = Math.min(data.virtualSize, yield* number(args, "span", 0x4000000));
    yield* Console.log(`${client.name}: Warcraft III ${client.exe.version}, pid ${client.pid}, image 0x${client.base.toString(16)}; scanning 0x${span.toString(16)} bytes of .data for the presence table`);
    const candidates = scanForPresenceTable(client.memory, client.maps, client.base, data.rva, span, { ...layout, sizeOfImage: client.exe.header.sizeOfImage });
    if (candidates.length === 0) return yield* new EngineFailure({ problem: "no pointer in .data leads to a presence table in the known layout; the layout moved, so derive it by hand (wisp:docs/engine.md#a-new-warcraft-build)" });
    for (const candidate of candidates) {
      yield* Console.log(`  rva 0x${candidate.rva.toString(16)} -> table 0x${candidate.table.toString(16)}: entries ${candidate.header.count}, free head ${candidate.header.freeHead}, births ${candidate.header.births}; ${candidate.matching}/${candidate.sampled} sampled agents hold their own tag`);
    }
    const tables = new Set(candidates.map(({ table }) => table));
    if (tables.size > 1) return yield* new EngineFailure({ problem: `${tables.size} different tables match; check them by hand` });
    const rva = candidates[0]?.rva ?? 0;
    const roles = new Map(existing?.roles ?? []);
    if (Number.isFinite(watchSeconds)) {
      yield* perfAllowed;
      const perf = yield* perfProgram(args);
      const table = candidates[0]?.table ?? 0;
      const out = stateDirectory();
      yield* attempt("create the output folder", () => mkdirSync(out, { recursive: true }));
      const births = yield* recordWrites(perf, client.pid, table + layout.table.births, watchSeconds, join(out, "births.perf.data"));
      const allocator = writer(births.samples, client, new Set());
      const heads = yield* recordWrites(perf, client.pid, table + layout.table.freeHead, watchSeconds, join(out, "free-head.perf.data"));
      const release = writer(heads.samples, client, new Set(allocator === undefined ? [] : [allocator]));
      yield* Console.log(`  births written by ${allocator === undefined ? "nothing seen" : `fn 0x${allocator.toString(16)}`} (${births.samples.length} writes); free head also by ${release === undefined ? "nothing seen" : `fn 0x${release.toString(16)}`} (${heads.samples.length} writes)`);
      if (existing === undefined) {
        roles.clear();
        if (allocator !== undefined) roles.set(allocator, "tag allocator");
        if (release !== undefined) roles.set(release, "tag release");
      }
    }
    const derived: EngineOffsets = { ...layout, version: client.exe.version, sizeOfImage: client.exe.header.sizeOfImage, presenceTable: rva, roles };
    if (existing !== undefined) {
      const same = existing.presenceTable === rva && existing.sizeOfImage === client.exe.header.sizeOfImage;
      yield* Console.log(same ? `${basename(OFFSETS_FILE)}'s entry for ${client.exe.version} matches this client` : `${basename(OFFSETS_FILE)}'s entry for ${client.exe.version} differs; this client's:`);
      if (same) return;
    } else {
      yield* Console.log(`add this entry to ${OFFSETS_FILE}${Number.isFinite(watchSeconds) ? "" : " (with --trace SECONDS it also names the tag allocator and release from their writes)"}:`);
    }
    yield* Console.log(JSON.stringify(offsetsEntry(derived), null, 2));
  }).pipe(Effect.ensuring(Effect.sync(() => client.memory.close())));
});

const USAGE = "(for debugging your own map on your own development clients; never other players' games) desync A B [--turn N] | poll --client a,b [--seconds N] [--out DIR] | diff A.log B.log [--skew S] [--source-maps DIR] | diff ACTIONS.log POLL.log [--class REGEX] | actions --client a,b [--map MAP] [--follow] | trace --client a [--seconds N] [--out DIR] [--perf BIN] [--lua [--limit N] [--source-maps DIR]] | locate --client a [--trace SECONDS]";

/** `clientsFile` is the clients file `wisp client watch` reads: each client's name and Documents folder, inside its Wine prefix. */
export const makeEngine = (clientsFile: string): Command => ([sub, ...args]) => {
  switch (sub) {
    case "desync": return desync(args);
    case "diff": return diff(args);
    case "actions": return actions(args);
    case "poll": return poll(clientsFile)(args);
    case "trace": return watch(clientsFile)(args);
    case "locate": return locate(clientsFile)(args);
    default: return Effect.fail(new UsageFailure({ problem: `engine takes ${USAGE}` }));
  }
};

export const ENGINE_USAGE = USAGE;
