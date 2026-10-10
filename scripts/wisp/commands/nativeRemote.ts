import * as BunServices from "@effect/platform-bun/BunServices";
import { homedir } from "node:os";
import { basename, posix, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { Console, Effect, FileSystem, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { type Command, UsageFailure, describeCause } from "../command";

export class NativeRemoteFailure extends Schema.TaggedError<NativeRemoteFailure>()("NativeRemoteFailure", {
  problem: Schema.String,
}) {
  override get message(): string { return this.problem; }
}

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const shell = (args: readonly string[]): string => args.map(quote).join(" ");
type Invocation = readonly [string, ...string[]];

export const nativeRemote: Command = (args) => Effect.gen(function*() {
  const separator = args.indexOf("--");
  if (args[0] !== "remote" || separator < 0 || separator === args.length - 1) {
    return yield* new UsageFailure({ problem: "native remote takes options followed by -- WISP_ARGS" });
  }
  const { values } = yield* Effect.try({
    try: () => parseArgs({ args: args.slice(1, separator), options: {
      host: { type: "string" }, project: { type: "string" }, map: { type: "string" },
      pads: { type: "string" }, "clients-file": { type: "string" }, run: { type: "string" },
      "dry-run": { type: "boolean" },
    } }),
    catch: (cause) => new UsageFailure({ problem: describeCause(cause) }),
  });
  const { host, project, map, pads, run } = values;
  const clients = values["clients-file"];
  if (host === undefined || project === undefined || map === undefined || pads === undefined || clients === undefined || run === undefined) {
    return yield* new UsageFailure({ problem: "remote needs --host, --project, --map, --pads, --clients-file and --run" });
  }
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(host) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(run) || !posix.isAbsolute(project)) {
    return yield* new UsageFailure({ problem: "--host needs an SSH alias or user@host, --run a single folder name, --project an absolute VM path" });
  }
  const remoteParent = posix.join(project, ".wisp/native");
  const remoteRun = posix.join(remoteParent, run);
  const remoteMap = posix.join(remoteRun, "inputs", basename(map));
  const remotePads = posix.join(remoteRun, "inputs/pads");
  const remoteClients = posix.join(remoteRun, "inputs/clients.json");
  const remoteOut = posix.join(remoteRun, "out");
  const localOut = resolve(homedir(), ".local/state/smashcraft", run);
  const inputs = [{ path: resolve(map), type: "File" }, { path: resolve(pads), type: "Directory" }, { path: resolve(clients), type: "File" }] as const;
  const rewrite = (arg: string): string => {
    const tokens: Readonly<Record<string, string>> = { "{map}": remoteMap, "{pads}": remotePads, "{clients}": remoteClients, "{out}": remoteOut };
    for (const [token, path] of Object.entries(tokens)) {
      if (arg === token || arg.startsWith(`${token}/`)) return path + arg.slice(token.length);
    }
    if (resolve(arg) === resolve(map)) return remoteMap;
    if (resolve(arg) === resolve(clients)) return remoteClients;
    const padPath = relative(resolve(pads), resolve(arg));
    return padPath === "" || (!padPath.startsWith(`..${sep}`) && padPath !== ".." && !posix.isAbsolute(padPath))
      ? posix.join(remotePads, ...padPath.split(sep)) : arg;
  };
  const forwarded: string[] = [];
  const destinations: Readonly<Record<string, string>> = { "--map": remoteMap, "--clients-file": remoteClients, "--out": remoteOut };
  const commandArgs = args.slice(separator + 1);
  for (let index = 0; index < commandArgs.length; index++) {
    const arg = commandArgs[index] ?? "";
    const [flag] = arg.split("=", 1);
    const destination = destinations[flag ?? ""];
    if (destination === undefined) forwarded.push(rewrite(arg));
    else if (arg.includes("=")) forwarded.push(`${flag}=${destination}`);
    else {
      const value = commandArgs[++index];
      if (value === undefined || value.startsWith("--")) return yield* new UsageFailure({ problem: `${flag} needs a value in WISP_ARGS` });
      forwarded.push(arg, destination);
    }
  }
  const ssh = ["ssh", "-o", "BatchMode=yes", "--", host] as const;
  const prepare: Invocation = [...ssh, `${shell(["mkdir", "-p", "--", remoteParent])} && ${shell(["mkdir", "--", remoteRun])} && ${shell(["mkdir", "-p", "--", remotePads, remoteOut])}`];
  const sync = (source: string, destination: string): Invocation => ["rsync", "-a", "--protect-args", "-e", "ssh -o BatchMode=yes", "--", source, `${host}:${destination}`];
  const uploads = [sync(resolve(map), remoteMap), sync(`${resolve(pads)}/`, `${remotePads}/`), sync(resolve(clients), remoteClients)];
  const execute: Invocation = [...ssh, `cd ${quote(project)} && ${shell(["bun", "wisp", ...forwarded])} > ${quote(posix.join(remoteOut, "stdout.log"))} 2> ${quote(posix.join(remoteOut, "stderr.log"))}; status=$?; cat ${quote(posix.join(remoteOut, "stdout.log"))}; cat ${quote(posix.join(remoteOut, "stderr.log"))} >&2; exit "$status"`];
  const download: Invocation = ["rsync", "-a", "--protect-args", "-e", "ssh -o BatchMode=yes", "--", `${host}:${remoteOut}/`, `${localOut}/`];
  const plan = [prepare, ...uploads, execute, download];
  if (values["dry-run"] === true) {
    for (const invocation of plan) yield* Console.log(shell(invocation));
    return;
  }
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(localOut)) return yield* new NativeRemoteFailure({ problem: `run already exists: ${localOut}; choose a new --run` });
  for (const input of inputs) {
    const info = yield* fs.stat(input.path);
    if (info.type !== input.type) return yield* new UsageFailure({ problem: `${input.path} must be a ${input.type.toLowerCase()}` });
  }
  const launch = ([program, ...argv]: Invocation) => Effect.scoped(Effect.gen(function*() {
    const child = yield* ChildProcess.make(program, argv, { stdin: "ignore", stdout: "inherit", stderr: "inherit", forceKillAfter: "5 seconds" });
    return yield* child.exitCode;
  }));
  const requireSuccess = (invocation: Invocation) => launch(invocation).pipe(Effect.flatMap((code) => code === 0 ? Effect.void : Effect.fail(new NativeRemoteFailure({ problem: `${invocation[0]} exited ${code}` }))));
  yield* requireSuccess(prepare);
  for (const upload of uploads) yield* requireSuccess(upload);
  const outcome = yield* Effect.exit(launch(execute));
  yield* fs.makeDirectory(localOut, { recursive: true, mode: 0o700 });
  yield* requireSuccess(download);
  yield* Console.log(`native remote results: ${localOut}`);
  const code = yield* outcome;
  if (code !== 0) return yield* new NativeRemoteFailure({ problem: `remote wisp exited ${code}; results: ${localOut}` });
}).pipe(
  Effect.mapError((cause) => cause instanceof UsageFailure || cause instanceof NativeRemoteFailure ? cause : new NativeRemoteFailure({ problem: describeCause(cause) })),
  Effect.scoped,
  Effect.provide(BunServices.layer),
);
