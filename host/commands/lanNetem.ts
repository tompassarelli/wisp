import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect } from "effect";
import { ChildProcess } from "effect/process";
import { Namespaces } from "../contract/services";
import { collect } from "../process/hostProcess";
import { type Command, UsageFailure, flagValues, portFlag } from "../cli/command";
import { CLEAR, type Impairment, clearedAlready, impairCommands, impairmentSummary } from "../lan/netem";
import { LanFailure } from "../lan/join";
import { lanPlayRefusal, pairDirectory } from "../lan/pool";
import { AgentProcess, number, readJson } from "./lanAgent";

const inPairNetwork = (pair: number, command: readonly string[]) => Effect.gen(function*() {
  const state = yield* readJson(join(pairDirectory(pair), "agent.json"), AgentProcess);
  const refusal = lanPlayRefusal(pair, state.network === true, "netem");
  if (refusal !== undefined) return yield* new LanFailure({ problem: refusal });
  const [program = "", ...rest] = yield* Namespaces.use((namespaces) => namespaces.enter(state.pid, ["user", "net"], command, { keepCapabilities: true }));
  const result = yield* collect(ChildProcess.make(program, rest, { stdin: "ignore" })).pipe(Effect.provide(BunServices.layer), Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
  return { exitCode: Number(result.exitCode), stdout: new TextDecoder().decode(result.stdout).trim(), stderr: result.stderr.trim() };
});

const NETEM_USAGE = "netem takes --pair K --rtt MS [--loss PERCENT] [--jitter MS] [--burst] [--udp-port N | --tcp-port N], or off --pair K";

const netemImpairment = (args: readonly string[]): Impairment | UsageFailure => {
  const [rttText] = flagValues(args, "rtt");
  const [lossText = "0"] = flagValues(args, "loss");
  const [jitterText = "0"] = flagValues(args, "jitter");
  const rtt = Number(rttText);
  const loss = Number(lossText);
  const jitter = Number(jitterText);
  const burst = args.includes("--burst");
  if (rttText === undefined || !Number.isFinite(rtt) || rtt < 0) return new UsageFailure({ problem: NETEM_USAGE });
  if (!Number.isFinite(loss) || loss < 0 || loss > 100 || (burst && loss === 100)) return new UsageFailure({ problem: `--loss takes a round-trip percentage from 0 to 100${burst ? ", below 100 with --burst" : ""}` });
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > rtt) return new UsageFailure({ problem: "--jitter takes milliseconds from 0 to the --rtt" });
  const scoped = (["udp", "tcp"] as const).filter((protocol) => args.includes(`--${protocol}-port`));
  if (scoped.length > 1) return new UsageFailure({ problem: "netem takes --udp-port or --tcp-port, not both" });
  const [protocol] = scoped;
  if (protocol === undefined) return { rtt, loss, jitter, burst };
  const port = portFlag(args, 0, { name: `${protocol}-port` });
  return port instanceof UsageFailure ? port : { rtt, loss, jitter, burst, scope: { protocol, port } };
};

export const netem: Command = (args) => Effect.gen(function*() {
  const pair = yield* number(args, "pair", undefined);
  const impairment = args[0] === "off" ? undefined : netemImpairment(args);
  if (impairment instanceof UsageFailure) return yield* impairment;
  const cleared = yield* inPairNetwork(pair, CLEAR);
  if (cleared.exitCode !== 0 && !clearedAlready(cleared.stderr)) return yield* new LanFailure({ problem: `pair ${pair}: tc qdisc del: ${cleared.stderr}` });
  if (impairment !== undefined) {
    for (const command of impairCommands(impairment)) {
      const set = yield* inPairNetwork(pair, command);
      if (set.exitCode !== 0) {
        yield* inPairNetwork(pair, CLEAR);
        return yield* new LanFailure({ problem: `pair ${pair}: ${command.join(" ")}: ${set.stderr}` });
      }
    }
    yield* Console.log(`pair ${pair}: ${impairmentSummary(impairment)}`);
  }
  const qdiscs = yield* inPairNetwork(pair, ["tc", "qdisc", "show", "dev", "lo"]);
  yield* Console.log(`pair ${pair}: ${qdiscs.stdout}`);
  if (impairment?.scope !== undefined) {
    const filters = yield* inPairNetwork(pair, ["tc", "filter", "show", "dev", "lo"]);
    yield* Console.log(filters.stdout);
  }
});
