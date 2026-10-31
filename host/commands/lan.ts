import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Console, Effect, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { Namespaces } from "../contract/services";
import { LEASE_USAGE, lease } from "./lanQueue";
import { type Command, UsageFailure, flagValues, wholeFlag } from "../cli/command";
import { LanFailure } from "../lan/join";
import { HOLDS_USAGE, holds } from "./lanHolds";
import { ensurePackager } from "../compile/mapBuild";
import { PAIR_SIDES, clientName, lanPlayRefusal, mapPackager, pairDirectory, poolOwners, readPool, reportPort, wrongUser } from "../lan/pool";
import { DEFAULT_BUILD, profileFor } from "../os/warcraft/builds";
import { setupClient } from "../lan/setup";
import { AgentProcess, agent, number, readJson } from "./lanAgent";
import { check, pool, status, stop } from "./lanPool";
import { netem } from "./lanNetem";

/** The process that drives the pair: this command's caller, past the package-script wrappers (`bun run wisp`, `bun wisp`, `bun GAME`) that exit with it. */
const driverPid = Effect.try(() => {
  let pid = process.ppid;
  for (let depth = 0; depth < 8; depth++) {
    const [, ...words] = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    const verb = words.find((word) => !word.startsWith("-"));
    if (readFileSync(`/proc/${pid}/comm`, "utf8").trim() !== "bun" || verb === undefined || /[./]/.test(verb)) return pid;
    pid = Number(readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ")[1]);
  }
  return pid;
}).pipe(Effect.orElseSucceed(() => process.ppid));

const setup: Command = (args) => Effect.gen(function*() {
  const [from] = flagValues(args, "from");
  if (from === undefined) return yield* new UsageFailure({ problem: "--from names an existing Warcraft III install folder (the one holding _retail_)" });
  const pairs = yield* number(args, "pairs", 1);
  const [build = DEFAULT_BUILD] = flagValues(args, "build");
  if (profileFor(build) === undefined) return yield* new UsageFailure({ problem: `--build ${build} has no build profile in builds/` });

  const chosen = flagValues(args, "pair").map((value) => wholeFlag(["--pair", value], "pair"));
  if (!chosen.every((pair) => typeof pair === "number")) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  for (const pair of chosen.length > 0 ? chosen : Array.from({ length: pairs }, (_, index) => index)) {
    for (const side of PAIR_SIDES) yield* setupClient(clientName(pair, side), from, build, reportPort(pair, side), (line) => console.log(line));
  }
});

const fresh: Command = (args) => Effect.gen(function*() {
  const [map] = [...flagValues(args, "map"), ...args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"))];
  if (map === undefined || !existsSync(map)) return yield* new UsageFailure({ problem: "fresh takes a built map file (MAP.w3x or --map MAP.w3x)" });
  const pair = yield* number(args, "pair", 0);
  const [turnText] = flagValues(args, "turn-ms");
  const turnSteps = turnText?.split(",").map(Number);
  if (turnSteps?.some((step) => !Number.isInteger(step) || step < 1)) return yield* new UsageFailure({ problem: "--turn-ms takes whole milliseconds: one period (25) or a repeating cycle (17,17,16)" });
  const computers = yield* number(args, "computers", 0);
  const started = Date.now();
  const result = yield* agent(pair, "/fresh", { map, computers, driver: yield* driverPid, ...(turnSteps === undefined ? {} : { turnSteps }) });
  yield* Console.log(`pair ${pair}: playing ${map} after ${((Date.now() - started) / 1000).toFixed(1)} s; action log ${String(result["log"])}`);
});

const relayed: Command = (args) => Effect.gen(function*() {
  const [map] = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
  if (map === undefined || !existsSync(map)) return yield* new UsageFailure({ problem: "relayed takes a built map file (MAP.w3x)" });
  const pair = yield* number(args, "pair", 0);
  const turnMs = yield* number(args, "turn-ms", 8);
  const [bin] = flagValues(args, "relay-bin");
  if (bin === undefined) return yield* new UsageFailure({ problem: "relayed takes --relay-bin DIR, the folder holding the relay and relay-agent binaries" });
  const raiseHeadroomMs = wholeFlag(args, "raise-headroom-ms");
  if (raiseHeadroomMs instanceof UsageFailure) return yield* raiseHeadroomMs;
  const started = Date.now();
  const result = yield* agent(pair, "/relayed", { map: resolve(map), relay: resolve(bin, "relay"), agent: resolve(bin, "relay-agent"), turnMs, driver: yield* driverPid, ...(raiseHeadroomMs === undefined ? {} : { raiseHeadroomMs }) });
  yield* Console.log(`pair ${pair}: playing ${map} through a relay after ${((Date.now() - started) / 1000).toFixed(1)} s; logs ${String(result["folder"])}`);
});

const SoloResult = Schema.Struct({ clients: Schema.Array(Schema.Struct({ client: Schema.String, seconds: Schema.Finite })) });

const solo: Command = (args) => Effect.gen(function*() {
  const [map] = args.filter((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
  if (map === undefined || !existsSync(map)) return yield* new UsageFailure({ problem: "solo takes a built map file (MAP.w3x)" });
  const chosen = flagValues(args, "pair").map((value) => wholeFlag(["--pair", value], "pair"));
  if (!chosen.every((pair) => typeof pair === "number")) return yield* new UsageFailure({ problem: "--pair takes a pair number" });
  const pairs = chosen.length > 0 ? chosen : ((yield* readPool)?.pairs ?? []).filter(({ agentSocket: socket }) => existsSync(socket)).map(({ id }) => id);
  if (pairs.length === 0) return yield* new LanFailure({ problem: "no pool pair is running; start one with wisp lan pool" });
  const driver = yield* driverPid;
  yield* Effect.forEach(pairs, (pair) => agent(pair, "/solo", { map: resolve(map), driver }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(SoloResult)),
    Effect.mapError((failure) => (failure instanceof LanFailure ? failure : new LanFailure({ problem: `pair ${pair}: ${failure.message}` }))),
    Effect.flatMap(({ clients }) => Effect.forEach(clients, ({ client, seconds }) => Console.log(`${client}: playing ${map} alone after ${seconds.toFixed(1)} s`), { discard: true })),
  ), { concurrency: "unbounded", discard: true });
});

const end: Command = (args) => Effect.gen(function*() {
  const pair = yield* number(args, "pair", undefined);
  yield* agent(pair, "/end", {});
  yield* Console.log(`pair ${pair}: game ended`);
});

const dummy: Command = (args) => Effect.gen(function*() {
  const map = args[0];
  const [program] = flagValues(args, "program");
  const pair = yield* number(args, "pair", 0);
  const count = yield* number(args, "count", 20);
  if (map === undefined || !existsSync(map) || program === undefined || !existsSync(program) || count < 1) return yield* new UsageFailure({ problem: "dummy takes MAP --program W3GSCLIENT [--pair K] [--count N]" });
  const status = yield* agent(pair, "/status");
  const refusal = lanPlayRefusal(pair, status["network"] === true, "dummy");
  if (refusal !== undefined) return yield* new LanFailure({ problem: refusal });
  if (status["game"] !== undefined) return yield* new UsageFailure({ problem: `pair ${pair} has a game; end it with lan end before checking its lobby` });
  const clients = status["clients"] as { name: string; pid?: number }[];
  const native = clients.find(({ name }) => name === clientName(pair, "a"));
  if (native?.pid === undefined) return yield* new UsageFailure({ problem: `pair ${pair}'s first client is not running` });
  yield* ensurePackager(mapPackager());
  const state = yield* readJson(join(pairDirectory(pair), "agent.json"), AgentProcess);
  const [command = "", ...entered] = yield* Namespaces.use((namespaces) => namespaces.enter(state.pid, ["user", "net"], [process.execPath, join(import.meta.dir, "../lan/dummySession.ts"), String(pair), resolve(map), resolve(program), String(count), String(native.pid)]));
  const exit = yield* Effect.scoped(Effect.flatMap(
    ChildProcess.make(command, entered, {
      env: { XDG_RUNTIME_DIR: join(state.runs.a, "runtime") }, extendEnv: true, stdin: "ignore", stdout: "inherit", stderr: "inherit",
    }),
    (child) => child.exitCode,
  )).pipe(Effect.provide(BunServices.layer), Effect.mapError((failure) => new LanFailure({ problem: failure.message })));
  if (exit !== 0) return yield* new LanFailure({ problem: `dummy lobby check exited ${exit}` });
});

const speed: Command = (args) => Effect.gen(function*() {
  const value = Number(args[0]);
  if (!Number.isFinite(value) || value < 1 || value > 16) return yield* new UsageFailure({ problem: "speed takes a multiple between 1 and 16" });
  const pair = yield* number(args, "pair", undefined);
  yield* agent(pair, "/speed", { speed: value });
  yield* Console.log(`pair ${pair}: delivering turns at ${value}x; compare client frame progress to measure game speed`);
});

export const LAN_USAGE = `setup --from INSTALL [--build BUILD] [--pairs N | --pair K...] | pool [--pairs N | --pair K...] [--pool-profile parity|visual|hfr[,...]] [--fps N] [--seconds S] [--network with one --pair K] [--queue] [--owner NAME] [--owner-pid PID] [--release-idle SECONDS] [--idle-poll-ms MS] | fresh MAP [--pair K] [--computers N] [--turn-ms MS[,MS...]] | solo MAP [--pair K...] | relayed MAP --relay-bin DIR [--pair K] [--turn-ms MS] [--raise-headroom-ms MS] | dummy MAP --program W3GSCLIENT [--pair K] [--count N] | speed N --pair K | netem --pair K --rtt MS [--loss PERCENT] [--jitter MS] [--burst] [--udp-port N | --tcp-port N] | netem off --pair K | status [--pair K] | end --pair K | stop --pair K | check --pair K [--pool-profile parity|visual|hfr] [--wait SECONDS] | ${HOLDS_USAGE} | ${LEASE_USAGE}`;

const ownerCheck = poolOwners.pipe(Effect.flatMap((owners) => {
  const refusal = wrongUser(process.getuid?.() ?? 0, owners, ["bun", ...process.argv.slice(1)]);
  return refusal === undefined ? Effect.void : Effect.fail(new LanFailure({ problem: refusal }));
}));

export const lan: Command = (argv) => ownerCheck.pipe(Effect.andThen(Effect.suspend(() => subcommand(argv))));

const subcommands: Readonly<Record<string, Command>> = {
  setup: setup,
  pool: pool,
  fresh: fresh,
  solo: solo,
  relayed: relayed,
  dummy: dummy,
  status: status,
  speed: speed,
  netem: netem,
  end: end,
  stop: stop,
  check: check,
  holds: holds,
  lease: lease,
};

const subcommand: Command = ([sub, ...args]) => {
  const run = sub === undefined ? undefined : Object.hasOwn(subcommands, sub) ? subcommands[sub] : undefined;
  return run === undefined ? Effect.fail(new UsageFailure({ problem: `lan takes ${LAN_USAGE}` })) : run(args);
};
