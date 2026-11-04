import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Deferred, Effect, Fiber, Option, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { type Command, UsageFailure, flagValues, wholeFlag } from "../cli/command";
import { collect } from "../process/hostProcess";
import { NetFailure } from "../net/failure";
import type { Endpoint } from "../net/link";
import { startLocalRelay } from "../net/localRelay";
import { type RelayChoice, joinTarget, relayCode, relayRegions } from "../net/joinCode";
import { type NetGame, type NetPeerOptions, type NetReport, type NetRole, runNetPeer } from "../net/peer";
import { runProxy } from "../net/proxy";
import { chooseHostRelay, showJoinPing } from "../net/regionChoice";
import { describeRegions, pingRegions } from "../net/regionPing";

const VALUE_FLAGS = ["port", "listen", "to", "frames", "rtt", "loss", "seed", "delay", "freeze-at", "quit-at", "game", "relay", "humans", "jitter", "window", "out"];
const JOINER_ONLY = ["--freeze-at", "--quit-at"];
const PROXY_ONLY = ["--rtt", "--loss", "--seed", "--jitter"];
const ROOM_ONLY = ["--relay", "--humans"];
const NATIVE_ONLY = ["--window", "--out"];
const MAX_HUMANS = 4;

const Report = Schema.Struct({
  slot: Schema.Finite, humans: Schema.Finite, delay: Schema.Finite, rttMs: Schema.Finite, frames: Schema.Finite,
  checksumsCompared: Schema.Finite, mismatches: Schema.Finite, deliveries: Schema.Finite,
  deliveryMs: Schema.Struct({ p50: Schema.Finite, p95: Schema.Finite, p99: Schema.Finite, max: Schema.Finite }),
  stepMs: Schema.Struct({ p50: Schema.Finite, p95: Schema.Finite, max: Schema.Finite }),
  slips: Schema.Finite, lateFrames: Schema.Finite, waitMs: Schema.Finite, packetsSent: Schema.Finite,
  packetsReceived: Schema.Finite, bytesSent: Schema.Finite, bytesReceived: Schema.Finite, largestSent: Schema.Finite, largestReceived: Schema.Finite,
  wallMs: Schema.Finite,
});
/** The fields `pair --window native` reads off a native window's summary line: the peer's report, or why the match ended without one. */
const NativeSummary = Schema.fromJsonString(Schema.Struct({ net: Schema.optional(Report), netEnded: Schema.optional(Schema.String), error: Schema.optional(Schema.String) }));
const Outcome = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ report: Report }),
  Schema.Struct({ failure: Schema.Struct({ tag: Schema.String, message: Schema.String, endedMs: Schema.Finite }) }),
]));
type Outcome = typeof Outcome.Type;

// --rtt, --loss and --jitter take fractions; every other count is a whole number.
const FRACTIONAL = ["rtt", "loss", "jitter"];

function count(args: readonly string[], name: string, fallback: number): number | UsageFailure {
  const [text] = flagValues(args, name);
  if (text === undefined) return fallback;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : new UsageFailure({ problem: `--${name} needs a number, not ${text}` });
}

function counts<const Names extends string>(args: readonly string[], defaults: Record<Names, number>): Record<Names, number> | UsageFailure {
  const values = { ...defaults };
  for (const name of Object.keys(values) as Names[]) {
    const value = FRACTIONAL.includes(name) ? count(args, name, values[name]) : wholeFlag(args, name, { fallback: values[name] });
    if (value instanceof UsageFailure) return value;
    values[name] = value;
  }
  return values;
}

function address(text: string | undefined, what: string): { readonly address: string; readonly port: number } | UsageFailure {
  const match = /^(.+):(\d+)$/.exec(text ?? "");
  return match === null ? new UsageFailure({ problem: `${what} needs ADDRESS:PORT` }) : { address: match[1] ?? "", port: Number(match[2]) };
}

/** A role as the command line gives it: a host's `--relay` is still the text it names until the regions are pinged. */
type RoleRequest = Exclude<NetRole, { readonly kind: "relayHost" }> | { readonly kind: "hostThrough"; readonly relay: string };

function role(verb: "host" | "join", rest: readonly string[], port: number): RoleRequest | UsageFailure {
  if (verb === "join") {
    const target = joinTarget(rest[0] ?? "", relayRegions());
    if (typeof target === "string") return new UsageFailure({ problem: target });
    return "relay" in target ? { kind: "relayJoin", relay: target.relay, room: target.room } : { kind: "join", to: { address: target.address, port: target.port } };
  }
  const [named] = flagValues(rest, "relay");
  return named === undefined ? { kind: "host", port } : { kind: "hostThrough", relay: named };
}

function peerOptions(verb: "host" | "join", rest: readonly string[], game: string): { readonly options: Omit<NetPeerOptions, "role">; readonly request: RoleRequest } | UsageFailure {
  const values = counts(rest, { port: 0, frames: 0, delay: 0, humans: 2, "freeze-at": 0, "quit-at": 0 });
  if (values instanceof UsageFailure) return values;
  if (values.frames < 1) return new UsageFailure({ problem: "--frames needs a positive frame count" });
  if (values.humans < 2 || values.humans > MAX_HUMANS) return new UsageFailure({ problem: `--humans takes 2 to ${MAX_HUMANS}` });
  const chosen = role(verb, rest, values.port);
  if (chosen instanceof UsageFailure) return chosen;
  if (values.humans > 2 && (verb === "join" || chosen.kind !== "hostThrough")) return new UsageFailure({ problem: verb === "join" ? "a joiner learns the humans from its room" : "--humans above 2 needs --relay" });
  return { request: chosen, options: {
    game, frames: values.frames, humans: values.humans,
    ...(values.delay > 0 ? { delay: values.delay } : {}),
    ...(values["freeze-at"] > 0 ? { freezeAt: values["freeze-at"] } : {}),
    ...(values["quit-at"] > 0 ? { quitAt: values["quit-at"] } : {}),
  } };
}

const freePort = Effect.tryPromise({
  try: async () => {
    const probe = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
    const port = probe.port;
    probe.close();
    return port;
  },
  catch: (cause) => new NetFailure({ problem: `finding a free UDP port: ${String(cause)}` }),
});

export function describeReport(label: string, outcome: Outcome): string {
  if ("failure" in outcome) return `${label}: ${outcome.failure.tag} after ${(outcome.failure.endedMs / 1000).toFixed(2)} s: ${outcome.failure.message}`;
  const { report } = outcome;
  return `${label}: ${report.frames} frames, delay ${report.delay} (round trip ${report.rttMs} ms), ${report.checksumsCompared} checksums compared, ${report.mismatches} mismatches, `
    + `delivery p50/p95/p99/max ${report.deliveryMs.p50}/${report.deliveryMs.p95}/${report.deliveryMs.p99}/${report.deliveryMs.max} ms over ${report.deliveries} turns, `
    + `step p50/p95/max ${report.stepMs.p50}/${report.stepMs.p95}/${report.stepMs.max} ms, ${report.slips} slips, ${report.lateFrames} late frames, ${report.packetsSent} packets sent, ${report.bytesSent} bytes sent (largest ${report.largestSent}), ${report.bytesReceived} bytes received`;
}

/** `net regions`: each published relay region with its measured round trip, the nearest marked; fails when none answers. */
export const listRegions = Effect.gen(function*() {
  const pings = yield* pingRegions(relayRegions());
  console.log(describeRegions(pings));
  if (pings.length === 0) return yield* new NetFailure({ problem: "no relay region is listed" });
  if (pings.every((ping) => ping.rttMs === undefined)) return yield* new NetFailure({ problem: "no relay region answered" });
});

/** Wisp's own `net`: only `regions`, since a game hosts and joins through its own `makeNet`. */
export const regionsCommand: Command = (args) => args.length === 1 && args[0] === "regions"
  ? listRegions.pipe(Effect.provide(BunServices.layer))
  : Effect.fail(new UsageFailure({ problem: "net takes regions; a game's own net command hosts and joins" }));

/** The arguments of `rest` that are (or are not) one of `flags` with its value. */
function only(rest: readonly string[], flags: readonly string[], keep: boolean): string[] {
  return rest.filter((arg, index) => (flags.includes(arg) || flags.includes(rest[index - 1] ?? "")) === keep);
}

/** The last line of a player's stdout, which is its outcome. */
const decodeOutcome = (stdout: string) => Schema.decodeOption(Outcome)(stdout.trim().split("\n").at(-1) ?? "");

const joinLabel = (humans: number, index: number) => humans === 2 ? "join" : `join${index}`;

/** A relay room's join code rewritten to reach the relay through a new delay and loss proxy that lives as long as the scope. */
const behindProxy = (relay: Endpoint, code: string, path: { readonly rtt: number; readonly loss: number; readonly seed: number; readonly jitter: number }) => Effect.gen(function*() {
  const listen = yield* freePort;
  yield* Effect.forkScoped(runProxy({ listen, to: relay, oneWayMs: path.rtt / 2, loss: path.loss, seed: path.seed, jitterMs: path.jitter }, () => undefined));
  return code.replace(`:${relay.port}/`, `:${listen}/`);
});

/** The last line of a native window player's stdout, its run's figures: the peer's report when the match ran to its end, else what ended it. */
export const decodeNativeOutcome = (stdout: string): Option.Option<Outcome> => {
  const summary = Schema.decodeOption(NativeSummary)(stdout.trim().split("\n").at(-1) ?? "");
  return Option.map(summary, (figures): Outcome => figures.net !== undefined
    ? { report: figures.net }
    : { failure: { tag: "NoReport", message: figures.netEnded ?? figures.error ?? "the window ended without the peer's report", endedMs: 0 } });
};

/** How `pair --relay local` starts each player: a headless `net host` and `net join`, or, with `--window native`, the game's native window player hosting and joining. */
export interface PairPlayers {
  readonly host: (relay: Endpoint, humans: number) => readonly string[];
  readonly join: (code: string, label: string) => readonly string[];
  readonly decode: (stdout: string) => Option.Option<Outcome>;
  /** Where a player's stdout and stderr are kept whole, for figures a game reads off its own log lines. */
  readonly log?: (label: string) => string;
}

export const headlessPlayers = (shared: readonly string[]): PairPlayers => ({
  host: (relay, humans) => ["host", "--relay", `${relay.address}:${relay.port}`, "--humans", String(humans), ...shared],
  join: (code) => ["join", code, ...shared],
  decode: decodeOutcome,
});

/** Each window is the game's `nativePlay` command line with `--out OUT/LABEL`, its whole output kept in OUT/LABEL.log. */
export const nativePlayers = (nativePlay: readonly string[], shared: readonly string[], out: string): PairPlayers => ({
  host: (relay) => [...nativePlay, "--host", "--relay", `${relay.address}:${relay.port}`, ...shared, "--out", join(out, "host")],
  join: (code, label) => [...nativePlay, "--join", code, ...shared, "--out", join(out, label)],
  decode: decodeNativeOutcome,
  log: (label) => join(out, `${label}.log`),
});

const NATIVE_HUMANS = 2;

/** The players `pair --relay local` starts for `rest`: native windows with `--window native --out DIR` when the game has a native player, else headless peers. */
export function pairPlayers(rest: readonly string[], humans: number, nativePlay: readonly string[] | undefined): PairPlayers | UsageFailure {
  const shared = only(only(only(rest, ROOM_ONLY, false), PROXY_ONLY, false), NATIVE_ONLY, false);
  const [window] = flagValues(rest, "window");
  const [out] = flagValues(rest, "out");
  if (window === undefined) return out === undefined ? headlessPlayers(shared) : new UsageFailure({ problem: "pair --out goes with --window native" });
  if (window !== "native") return new UsageFailure({ problem: "pair --window takes native" });
  if (nativePlay === undefined) return new UsageFailure({ problem: "this game has no native window player for pair --window native" });
  if (humans !== NATIVE_HUMANS) return new UsageFailure({ problem: `pair --window native plays ${NATIVE_HUMANS} humans` });
  if (out === undefined) return new UsageFailure({ problem: "pair --window native needs --out DIR for each window's figures and log" });
  return nativePlayers(nativePlay, shared, out);
}

/** One player of a relay pair: its process, the join code it prints (into `code`), its outcome off its stdout and its last stderr line; a native window's whole output is kept in its log. */
const startPlayer = (launcher: readonly string[], players: PairPlayers, code: Deferred.Deferred<string>, label: string, argv: readonly string[]) => Effect.gen(function*() {
  const handle = yield* ChildProcess.make(launcher[0] ?? "bun", [...launcher.slice(1), ...argv], { stdin: "ignore" });
  const kept: string[] = [];
  const watch = (line: string) => Effect.gen(function*() {
    if (players.log !== undefined) kept.push(line);
    const found = /^(?:net:|[^:]+:) join code (\S+)/.exec(line);
    if (found !== null) yield* Deferred.succeed(code, found[1] ?? "");
  });
  const stderr = yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText(), Stream.splitLines, Stream.runFoldEffect(() => "", (last, line) => Effect.gen(function*() {
    yield* watch(line);
    if (!line.startsWith("net:")) return line.trim() === "" ? last : line;
    process.stderr.write(`${label} ${line}\n`);
    return line;
  }))));
  const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runFoldEffect(() => [] as string[], (lines, line) => watch(line).pipe(Effect.as([...lines.slice(-1), line])))));
  const failed = (cause: unknown) => new NetFailure({ problem: `${label}: ${String(cause)}` });
  const keep = (lines: readonly string[]) => Effect.promise(async () => { if (players.log !== undefined) await Bun.write(players.log(label), kept.join("\n") + "\n"); return lines; });
  return {
    outcome: Fiber.join(stdout).pipe(Effect.mapError(failed), Effect.tap(() => Fiber.join(stderr).pipe(Effect.ignore)), Effect.flatMap(keep), Effect.map((lines) => players.decode(lines.join("\n")))),
    lastWords: Fiber.join(stderr).pipe(Effect.mapError(failed)),
  };
});

/** What `pair --relay local` was asked for: the joiners' path to the relay, the room's humans and how each player starts. */
function relayPairSetup(rest: readonly string[], nativePlay: readonly string[] | undefined) {
  const [relayName] = flagValues(rest, "relay");
  if (relayName !== "local") return new UsageFailure({ problem: "pair --relay takes local, a relay on this machine" });
  const refused = JOINER_ONLY.find((flag) => rest.includes(flag));
  if (refused !== undefined) return new UsageFailure({ problem: `pair --relay does not take ${refused}` });
  const path = counts(rest, { rtt: 0, loss: 0, seed: 1, jitter: 0 });
  if (path instanceof UsageFailure) return path;
  const humans = wholeFlag(rest, "humans", { fallback: 2 });
  if (humans instanceof UsageFailure) return humans;
  if (humans < 2 || humans > MAX_HUMANS) return new UsageFailure({ problem: `--humans takes 2 to ${MAX_HUMANS}` });
  const players = pairPlayers(rest, humans, nativePlay);
  return players instanceof UsageFailure ? players : { path, humans, players };
}

/**
 * `pair --relay local --humans N`: a relay on this machine and N players, the first hosting the room and the rest joining by its
 * code, each joiner behind its own `net proxy` to the relay when `--rtt`, `--loss`, `--jitter` or `--seed` is given. With `--window native`
 * the two players are the game's native windows (`nativePlay`), each writing its figures to `--out`. Each player's report is printed; the pair passes when every player finished with equal checksums.
 */
const relayPair = (prefix: readonly string[], rest: readonly string[], nativePlay: readonly string[] | undefined) => Effect.gen(function*() {
  const setup = relayPairSetup(rest, nativePlay);
  if (setup instanceof UsageFailure) return yield* setup;
  const { path, humans, players } = setup;
  const launcher = players.log === undefined ? prefix : prefix.slice(0, -1);
  const relay = yield* startLocalRelay;
  const proxied = PROXY_ONLY.some((flag) => rest.includes(flag));
  const code = yield* Deferred.make<string>();
  const player = (label: string, argv: readonly string[]) => startPlayer(launcher, players, code, label, argv);
  const host = yield* player("host", players.host(relay, humans));
  const hostEnded = Effect.all([host.outcome, host.lastWords]).pipe(Effect.map(([outcome, lastWords]) => `the host ended before printing a join code: ${Option.match(outcome, {
    onNone: () => lastWords === "" ? "it printed nothing" : lastWords,
    onSome: (ended) => "failure" in ended ? `${ended.failure.tag}: ${ended.failure.message}` : "it reported a finished match",
  })}`));
  const room = yield* Effect.raceFirst(Deferred.await(code), hostEnded.pipe(Effect.flatMap((problem) => new NetFailure({ problem })))).pipe(Effect.timeoutOption(players.log === undefined ? "30 seconds" : "300 seconds"));
  if (Option.isNone(room)) return yield* new NetFailure({ problem: "the host printed no join code in time" });
  const joiners = yield* Effect.forEach(Array.from({ length: humans - 1 }, (_, index) => index + 1), (index) => Effect.gen(function*() {
    const target = proxied ? yield* behindProxy(relay, room.value, { ...path, seed: path.seed + index }) : room.value;
    const label = joinLabel(humans, index);
    return yield* player(label, players.join(target, label));
  }));
  const none = { failure: { tag: "NoReport", message: "printed no outcome", endedMs: 0 } };
  const outcomes = (yield* Effect.forEach([host, ...joiners], ({ outcome }) => outcome, { concurrency: "unbounded" })).map((outcome) => Option.getOrElse(outcome, () => none));
  outcomes.forEach((outcome, index) => console.log(describeReport(index === 0 ? "host" : joinLabel(humans, index), outcome)));
  const reports = outcomes.flatMap((outcome) => "report" in outcome ? [outcome.report] : []);
  if (reports.length < humans || reports.some((report) => report.mismatches > 0)) return yield* new NetFailure({ problem: `${humans - reports.length} of ${humans} players failed, ${reports.filter((report) => report.mismatches > 0).length} reported mismatched checksums` });
  console.log(`pair: ${humans} humans, ${reports[0]?.frames ?? 0} frames, checksums match on all ${humans} (${Math.min(...reports.map((report) => report.checksumsCompared))} or more compared by each)`);
});

/**
 * `net host|join|proxy|pair|regions`: one slot of a two-player match per process over Wisp's UDP lockstep (wisp:docs/network-model.md).
 * Flags in `gameFlags` reach the game's `load`. `pair` runs a host and a joiner on this machine, through a delay and loss proxy
 * when `--rtt` or `--loss` is given; `--freeze-at` and `--quit-at` apply to the joiner. `nativePlay` is the game's command line for one native window
 * player, after the program and script, which `pair --relay local --window native` starts for each side.
 */
export function makeNet(load: (args: readonly string[]) => Promise<NetGame>, gameName: string, gameFlags: readonly string[] = [], nativePlay?: readonly string[]): Command {
  return (args) => Effect.gen(function*() {
    const [verb, ...rest] = args;
    const unknown = rest.filter((arg, index) => arg.startsWith("--") && !VALUE_FLAGS.includes(arg.slice(2)) && !gameFlags.includes(arg.slice(2)) && !(index === 0 && verb === "join"));
    if (unknown.length > 0) return yield* new UsageFailure({ problem: `unknown option ${unknown[0]}` });
    if (verb === "proxy") {
      const values = counts(rest, { listen: 0, rtt: 0, loss: 0, seed: 1, jitter: 0 });
      if (values instanceof UsageFailure) return yield* values;
      const to = address(flagValues(rest, "to")[0], "--to");
      if (to instanceof UsageFailure) return yield* to;
      return yield* runProxy({ listen: values.listen, to, oneWayMs: values.rtt / 2, loss: values.loss, seed: values.seed, jitterMs: values.jitter });
    }
    if (verb === "pair") {
      const prefix = process.argv.slice(0, process.argv.length - args.length);
      if (rest.includes("--relay") || rest.includes("--humans")) return yield* relayPair(prefix, rest, nativePlay);
      const nativeOnly = NATIVE_ONLY.find((flag) => rest.includes(flag));
      if (nativeOnly !== undefined) return yield* new UsageFailure({ problem: `pair ${nativeOnly} goes with --relay local` });
      const shared = only(only(only(rest, JOINER_ONLY, false), PROXY_ONLY, false), ["--port"], false);
      const hostPort = yield* freePort;
      const run = (label: string, argv: readonly string[]) => collect(ChildProcess.make(prefix[0] ?? "bun", [...prefix.slice(1), ...argv], { stdin: "ignore" })).pipe(
        Effect.map(({ stdout, stderr }) => {
          process.stderr.write(stderr.split("\n").filter((line) => line.startsWith("net:")).map((line) => `${label} ${line}\n`).join(""));
          const last = new TextDecoder().decode(stdout).trim().split("\n").at(-1) ?? "";
          return Schema.decodeOption(Outcome)(last);
        }),
        Effect.mapError((cause) => new NetFailure({ problem: `${label}: ${String(cause)}` })),
      );
      let joinPort = hostPort;
      if (PROXY_ONLY.some((flag) => rest.includes(flag))) {
        joinPort = yield* freePort;
        yield* Effect.forkScoped(run("proxy", ["proxy", "--listen", String(joinPort), "--to", `127.0.0.1:${hostPort}`, ...only(rest, PROXY_ONLY, true)]));
      }
      const joiner = yield* Effect.forkScoped(run("join", ["join", `127.0.0.1:${joinPort}`, ...shared, ...only(rest, JOINER_ONLY, true)]));
      const host = yield* run("host", ["host", "--port", String(hostPort), ...shared]);
      const frozen = rest.includes("--freeze-at");
      const join = frozen ? Option.none() : yield* Fiber.join(joiner);
      const none = { failure: { tag: "NoReport", message: "printed no outcome", endedMs: 0 } };
      const outcomes = [Option.getOrElse(host, () => none), ...(frozen ? [] : [Option.getOrElse(join, () => none)])];
      console.log(describeReport("host", outcomes[0] ?? none));
      console.log(frozen ? "join: frozen as told, stopped" : describeReport("join", outcomes[1] ?? none));
      const drill = JOINER_ONLY.some((flag) => rest.includes(flag));
      if (!drill && outcomes.some((outcome) => "failure" in outcome)) return yield* new NetFailure({ problem: "a side failed" });
      return;
    }
    if (verb === "regions") return yield* listRegions;
    if (verb !== "host" && verb !== "join") return yield* new UsageFailure({ problem: "net takes host, join, proxy, pair or regions" });
    const chosen = peerOptions(verb, rest, flagValues(rest, "game")[0] ?? gameName);
    if (chosen instanceof UsageFailure) return yield* chosen;
    const regions = relayRegions();
    const { request } = chosen;
    let relay: RelayChoice | undefined;
    let netRole: NetRole;
    if (request.kind === "hostThrough") {
      relay = yield* chooseHostRelay(request.relay, regions, console.error);
      netRole = { kind: "relayHost", relay: relay.relay };
    } else {
      if (request.kind === "relayJoin") yield* showJoinPing(request.relay, regions, console.error);
      netRole = request;
    }
    const options: NetPeerOptions = { ...chosen.options, role: netRole, listening: (listening) => {
      if ("room" in listening && relay !== undefined) console.error(`net: join code ${relayCode(relay, listening.room)}`);
    } };
    const game = yield* Effect.tryPromise({ try: () => load(rest), catch: (cause) => new NetFailure({ problem: `loading the game: ${String(cause)}` }) });
    const began = performance.now();
    const report: NetReport = yield* runNetPeer(game, options).pipe(Effect.tapError((error) => Effect.sync(() => {
      console.log(JSON.stringify({ failure: { tag: error._tag, message: error.message, endedMs: Math.round(performance.now() - began) } }));
    })));
    console.log(JSON.stringify({ report }));
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer));
}
