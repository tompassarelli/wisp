import * as BunServices from "@effect/platform-bun/BunServices";
import { Deferred, Effect, Fiber, Option, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import { type Command, UsageFailure, flagValues, wholeFlag } from "../cli/command";
import { collect } from "../cli/hostProcess";
import { NetFailure } from "../net/failure";
import type { Endpoint } from "../net/link";
import { startLocalRelay } from "../net/localRelay";
import { type RelayChoice, joinTarget, relayCode, relayRegions } from "../net/joinCode";
import { type NetGame, type NetPeerOptions, type NetReport, type NetRole, runNetPeer } from "../net/peer";
import { runProxy } from "../net/proxy";
import { chooseHostRelay, showJoinPing } from "../net/regionChoice";
import { describeRegions, pingRegions } from "../net/regionPing";

const VALUE_FLAGS = ["port", "listen", "to", "frames", "rtt", "loss", "seed", "delay", "freeze-at", "quit-at", "game", "relay", "humans"];
const JOINER_ONLY = ["--freeze-at", "--quit-at"];
const PROXY_ONLY = ["--rtt", "--loss", "--seed"];
const ROOM_ONLY = ["--relay", "--humans"];
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
const Outcome = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ report: Report }),
  Schema.Struct({ failure: Schema.Struct({ tag: Schema.String, message: Schema.String, endedMs: Schema.Finite }) }),
]));
type Outcome = typeof Outcome.Type;

// --rtt and --loss take fractions; every other count is a whole number.
const FRACTIONAL = ["rtt", "loss"];

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
const behindProxy = (relay: Endpoint, code: string, path: { readonly rtt: number; readonly loss: number; readonly seed: number }) => Effect.gen(function*() {
  const listen = yield* freePort;
  yield* Effect.forkScoped(runProxy({ listen, to: relay, oneWayMs: path.rtt / 2, loss: path.loss, seed: path.seed }, () => undefined));
  return code.replace(`:${relay.port}/`, `:${listen}/`);
});

/**
 * `pair --relay local --humans N`: a relay on this machine and N players, the first hosting the room and the rest joining by its
 * code, each joiner behind its own `net proxy` to the relay when `--rtt`, `--loss` or `--seed` is given. Each player's report is printed; the pair passes when every player finished with equal checksums.
 */
const relayPair = (prefix: readonly string[], rest: readonly string[]) => Effect.gen(function*() {
  const [relayName] = flagValues(rest, "relay");
  if (relayName !== "local") return yield* new UsageFailure({ problem: "pair --relay takes local, a relay on this machine" });
  const refused = JOINER_ONLY.find((flag) => rest.includes(flag));
  if (refused !== undefined) return yield* new UsageFailure({ problem: `pair --relay does not take ${refused}` });
  const path = counts(rest, { rtt: 0, loss: 0, seed: 1 });
  if (path instanceof UsageFailure) return yield* path;
  const humans = wholeFlag(rest, "humans", { fallback: 2 });
  if (humans instanceof UsageFailure) return yield* humans;
  if (humans < 2 || humans > MAX_HUMANS) return yield* new UsageFailure({ problem: `--humans takes 2 to ${MAX_HUMANS}` });
  const relay = yield* startLocalRelay;
  const shared = only(only(rest, ROOM_ONLY, false), PROXY_ONLY, false);
  const proxied = PROXY_ONLY.some((flag) => rest.includes(flag));
  const code = yield* Deferred.make<string>();
  const player = (label: string, argv: readonly string[]) => Effect.gen(function*() {
    const handle = yield* ChildProcess.make(prefix[0] ?? "bun", [...prefix.slice(1), ...argv], { stdin: "ignore" });
    yield* Effect.forkScoped(handle.stderr.pipe(Stream.decodeText(), Stream.splitLines, Stream.runForEach((line) => Effect.gen(function*() {
      if (!line.startsWith("net:")) return;
      process.stderr.write(`${label} ${line}\n`);
      const found = /^net: join code (\S+)/.exec(line);
      if (found !== null) yield* Deferred.succeed(code, found[1] ?? "");
    }))));
    const stdout = yield* Effect.forkScoped(handle.stdout.pipe(Stream.decodeText(), Stream.mkString));
    return { outcome: Fiber.join(stdout).pipe(Effect.map(decodeOutcome), Effect.mapError((cause) => new NetFailure({ problem: `${label}: ${String(cause)}` }))) };
  });
  const host = yield* player("host", ["host", "--relay", `${relay.address}:${relay.port}`, "--humans", String(humans), ...shared]);
  const room = yield* Deferred.await(code).pipe(Effect.timeoutOption("30 seconds"));
  if (Option.isNone(room)) return yield* new NetFailure({ problem: "the host printed no join code within 30 s" });
  const joiners = yield* Effect.forEach(Array.from({ length: humans - 1 }, (_, index) => index + 1), (index) => Effect.gen(function*() {
    const target = proxied ? yield* behindProxy(relay, room.value, { ...path, seed: path.seed + index }) : room.value;
    return yield* player(joinLabel(humans, index), ["join", target, ...shared]);
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
 * when `--rtt` or `--loss` is given; `--freeze-at` and `--quit-at` apply to the joiner.
 */
export function makeNet(load: (args: readonly string[]) => Promise<NetGame>, gameName: string, gameFlags: readonly string[] = []): Command {
  return (args) => Effect.gen(function*() {
    const [verb, ...rest] = args;
    const unknown = rest.filter((arg, index) => arg.startsWith("--") && !VALUE_FLAGS.includes(arg.slice(2)) && !gameFlags.includes(arg.slice(2)) && !(index === 0 && verb === "join"));
    if (unknown.length > 0) return yield* new UsageFailure({ problem: `unknown option ${unknown[0]}` });
    if (verb === "proxy") {
      const values = counts(rest, { listen: 0, rtt: 0, loss: 0, seed: 1 });
      if (values instanceof UsageFailure) return yield* values;
      const to = address(flagValues(rest, "to")[0], "--to");
      if (to instanceof UsageFailure) return yield* to;
      return yield* runProxy({ listen: values.listen, to, oneWayMs: values.rtt / 2, loss: values.loss, seed: values.seed });
    }
    if (verb === "pair") {
      const prefix = process.argv.slice(0, process.argv.length - args.length);
      if (rest.includes("--relay") || rest.includes("--humans")) return yield* relayPair(prefix, rest);
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
