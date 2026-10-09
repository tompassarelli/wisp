import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Fiber, Option, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { type Command, UsageFailure, flagValues } from "../command";
import { collect } from "../hostProcess";
import { type NetGame, type NetPeerOptions, type NetReport, NetFailure, runNetPeer } from "../net/peer";
import { runProxy } from "../net/proxy";

const VALUE_FLAGS = ["port", "listen", "to", "frames", "rtt", "loss", "seed", "delay", "freeze-at", "quit-at", "game"];
const JOINER_ONLY = ["--freeze-at", "--quit-at"];
const PROXY_ONLY = ["--rtt", "--loss", "--seed"];

const Report = Schema.Struct({
  slot: Schema.Finite, delay: Schema.Finite, rttMs: Schema.Finite, frames: Schema.Finite,
  checksumsCompared: Schema.Finite, mismatches: Schema.Finite, deliveries: Schema.Finite,
  deliveryMs: Schema.Struct({ p50: Schema.Finite, p95: Schema.Finite, p99: Schema.Finite, max: Schema.Finite }),
  stepMs: Schema.Struct({ p50: Schema.Finite, p95: Schema.Finite, max: Schema.Finite }),
  slips: Schema.Finite, lateFrames: Schema.Finite, waitMs: Schema.Finite, packetsSent: Schema.Finite,
  packetsReceived: Schema.Finite, wallMs: Schema.Finite,
});
const Outcome = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ report: Report }),
  Schema.Struct({ failure: Schema.Struct({ tag: Schema.String, message: Schema.String, endedMs: Schema.Finite }) }),
]));
type Outcome = typeof Outcome.Type;

function count(args: readonly string[], name: string, fallback: number): number | UsageFailure {
  const [text] = flagValues(args, name);
  if (text === undefined) return fallback;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : new UsageFailure({ problem: `--${name} needs a number, not ${text}` });
}

function counts<const Names extends string>(args: readonly string[], defaults: Record<Names, number>): Record<Names, number> | UsageFailure {
  const values = { ...defaults };
  for (const name of Object.keys(values) as Names[]) {
    const value = count(args, name, values[name]);
    if (value instanceof UsageFailure) return value;
    values[name] = value;
  }
  return values;
}

function address(text: string | undefined, what: string): { readonly address: string; readonly port: number } | UsageFailure {
  const match = /^(.+):(\d+)$/.exec(text ?? "");
  return match === null ? new UsageFailure({ problem: `${what} needs ADDRESS:PORT` }) : { address: match[1] ?? "", port: Number(match[2]) };
}

function peerOptions(verb: "host" | "join", rest: readonly string[], game: string): NetPeerOptions | UsageFailure {
  const values = counts(rest, { port: 0, frames: 0, delay: 0, "freeze-at": 0, "quit-at": 0 });
  if (values instanceof UsageFailure) return values;
  if (values.frames < 1) return new UsageFailure({ problem: "--frames needs a positive frame count" });
  const host = verb === "join" ? address(rest[0], "join") : undefined;
  if (host instanceof UsageFailure) return host;
  return {
    role: host === undefined ? { host: { port: values.port } } : { join: host }, game, frames: values.frames,
    ...(values.delay > 0 ? { delay: values.delay } : {}),
    ...(values["freeze-at"] > 0 ? { freezeAt: values["freeze-at"] } : {}),
    ...(values["quit-at"] > 0 ? { quitAt: values["quit-at"] } : {}),
  };
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
    + `step p50/p95/max ${report.stepMs.p50}/${report.stepMs.p95}/${report.stepMs.max} ms, ${report.slips} slips, ${report.lateFrames} late frames, ${report.packetsSent} packets sent`;
}

/** The arguments of `rest` that are (or are not) one of `flags` with its value. */
function only(rest: readonly string[], flags: readonly string[], keep: boolean): string[] {
  return rest.filter((arg, index) => (flags.includes(arg) || flags.includes(rest[index - 1] ?? "")) === keep);
}

/**
 * `net host|join|proxy|pair`: one slot of a two-player match per process over Wisp's UDP lockstep (wisp:docs/network-model.md).
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
    if (verb !== "host" && verb !== "join") return yield* new UsageFailure({ problem: "net takes host, join, proxy or pair" });
    const options = peerOptions(verb, rest, flagValues(rest, "game")[0] ?? gameName);
    if (options instanceof UsageFailure) return yield* options;
    const game = yield* Effect.tryPromise({ try: () => load(rest), catch: (cause) => new NetFailure({ problem: `loading the game: ${String(cause)}` }) });
    const began = performance.now();
    const report: NetReport = yield* runNetPeer(game, options).pipe(Effect.tapError((error) => Effect.sync(() => {
      console.log(JSON.stringify({ failure: { tag: error._tag, message: error.message, endedMs: Math.round(performance.now() - began) } }));
    })));
    console.log(JSON.stringify({ report }));
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer));
}
