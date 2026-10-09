




import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import type { ProcessInfo } from "../warcraft/battleNet";
import { listProcesses } from "../warcraft/processes";

export class ServiceProblem extends Schema.TaggedError<ServiceProblem>()("ServiceProblem", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}


export const desktopUnit = (name: string) => `wisp-desktop-${name}.service`;

export const clientUnit = (name: string) => `wisp-client-${name}.service`;


export const desktopLog = (name: string) => join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local/state"), "wisp/desktops", `${name}.log`);


export const DESKTOP_RESOLUTION = "1920x1080";

const run = (command: readonly string[]) => Effect.try({
  try: () => {
    const done = Bun.spawnSync([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    return { code: done.exitCode, out: done.stdout.toString().trim(), err: done.stderr.toString().trim() };
  },
  catch: (cause) => new ServiceProblem({ problem: `${command.slice(0, 2).join(" ")}: ${String(cause)}` }),
});






export const startService = (unit: string, command: readonly string[], log?: string) => Effect.gen(function*() {
  yield* run(["systemctl", "--user", "stop", unit]);
  if (log !== undefined) yield* Effect.try({ try: () => mkdirSync(dirname(log), { recursive: true }), catch: (cause) => new ServiceProblem({ problem: `create ${dirname(log)}: ${String(cause)}` }) });
  const started = yield* run([
    "systemd-run", "--user", "--quiet", "--collect", `--unit=${unit}`, "--setenv=PATH",
    ...(log === undefined ? [] : [`--property=StandardOutput=append:${log}`, `--property=StandardError=append:${log}`]),
    "--", ...command,
  ]);
  if (started.code !== 0) return yield* new ServiceProblem({ problem: `systemd-run ${unit}: ${started.err || `exit ${started.code}`}` });
});


export const serviceState = (unit: string) => run(["systemctl", "--user", "show", unit, "--property=ActiveState", "--property=ActiveEnterTimestamp", "--property=MainPID"]).pipe(
  Effect.map(({ out }) => {
    const field = (key: string) => new RegExp(`^${key}=(.*)$`, "m").exec(out)?.[1] ?? "";
    return { active: field("ActiveState") || "inactive", since: field("ActiveEnterTimestamp"), pid: Number(field("MainPID")) };
  }),
);

export const stopService = (unit: string) => run(["systemctl", "--user", "stop", unit]).pipe(
  Effect.flatMap((done) => (done.code === 0 ? Effect.void : Effect.fail(new ServiceProblem({ problem: `systemctl --user stop ${unit}: ${done.err || `exit ${done.code}`}` })))),
);

const readText = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};


const cgroupOf = (pid: number) => /^0::(.*)$/m.exec(readText(`/proc/${pid}/cgroup`) ?? "")?.[1];
const parentOf = (pid: number) => {
  const stat = readText(`/proc/${pid}/stat`);
  return stat === undefined ? undefined : Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
};
const commandOf = (pid: number) => (readText(`/proc/${pid}/cmdline`) ?? "").split("\0").filter((arg) => arg !== "").join(" ");


export type Owner = { readonly unit: string } | { readonly pid: number; readonly command: string };









export const ownerOf = (pid: number): Owner | undefined => {
  const home = `/user@${process.getuid?.() ?? 0}.service/`;
  const leafOf = (cgroup: string) => cgroup.slice(cgroup.lastIndexOf("/") + 1);
  const cgroup = cgroupOf(pid);
  if (cgroup === undefined) return undefined;
  if (cgroup.includes(home) && leafOf(cgroup).endsWith(".service")) return { unit: leafOf(cgroup) };
  if (leafOf(cgroup).startsWith("agent-capacity-")) {
    const members = (readText(`/sys/fs/cgroup${cgroup}/cgroup.procs`) ?? "").split("\n").filter((line) => line !== "").map(Number);
    for (const member of members) {
      const parent = parentOf(member);
      const parentCgroup = parent === undefined ? undefined : cgroupOf(parent);
      if (parent === undefined || parentCgroup === undefined || parentCgroup === cgroup || leafOf(parentCgroup) === "init.scope") continue;
      if (parentCgroup.includes(home) && leafOf(parentCgroup).endsWith(".service")) return { unit: leafOf(parentCgroup) };
      return { pid: parent, command: commandOf(parent) };
    }
  }
  return { pid, command: commandOf(pid) };
};

export const describeOwner = (owner: Owner | undefined) =>
  owner === undefined ? "gone" : "unit" in owner ? `service ${owner.unit}` : `not a service: started by pid ${owner.pid} (${owner.command.slice(0, 80)}), so it ends with that process`;


export const liveDesktop = (run: string) => existsSync(join(run, "runtime/wayland-0")) && existsSync(join(run, "display"));


export const desktopPid = (run: string) => {
  const pid = Number(readText(join(run, "launcher-pid"))?.trim());
  return Number.isInteger(pid) && pid > 0 && existsSync(`/proc/${pid}`) ? pid : undefined;
};


export const prefixProcesses = (prefix: string): readonly ProcessInfo[] =>
  listProcesses().filter((process) => process.prefix === prefix).sort((a, b) => Number(/battle\.net/i.test(b.args.join(" "))) - Number(/battle\.net/i.test(a.args.join(" "))));






export const desktopCommand = (capacity: string, desktop: string, name: string) => [
  process.execPath, capacity, "session", "--class", "native", "--memory-gib", "1.5", "--owner", `wisp-desktop-${name}`, "--",
  "bash", desktop, "start", "--resolution", DESKTOP_RESOLUTION,
];


export const startDesktop = (name: string, command: readonly string[], seconds = 60) => Effect.gen(function*() {
  const log = desktopLog(name);
  const offset = readText(log)?.length ?? 0;
  yield* startService(desktopUnit(name), command, log);
  for (let waited = 0; waited < seconds * 4; waited++) {
    const written = (readText(log) ?? "").slice(offset);
    const runDir = /^Run: (\S+)$/m.exec(written)?.[1];
    if (runDir !== undefined && liveDesktop(runDir)) return runDir;
    const state = yield* serviceState(desktopUnit(name));
    if (state.active !== "active" && state.active !== "activating") {
      return yield* new ServiceProblem({ problem: `${name}: its desktop service ended before the desktop was up: ${written.trim().split("\n").slice(-3).join(" | ") || state.active} (${log})` });
    }
    yield* Effect.sleep("250 millis");
  }
  return yield* new ServiceProblem({ problem: `${name}: no live desktop within ${seconds} s (${log})` });
});


export const writeRun = (clientsFile: string, name: string, runDir: string) => Effect.try({
  try: () => {
    const file = JSON.parse(readFileSync(clientsFile, "utf8")) as { clients: { name: string; run: string }[] };
    const entry = file.clients.find((client) => client.name === name);
    if (entry === undefined) throw new Error(`no client ${name}`);
    entry.run = runDir;
    writeFileSync(clientsFile, `${JSON.stringify(file, null, 2)}\n`);
  },
  catch: (cause) => new ServiceProblem({ problem: `update ${clientsFile}: ${String(cause)}` }),
});


export const skillScript = (skill: string, script: string) => run(["agents", "path", skill]).pipe(
  Effect.flatMap((done) => (done.code === 0 && done.out !== "" ? Effect.succeed(join(dirname(done.out), script)) : Effect.fail(new ServiceProblem({ problem: `agents path ${skill}: ${done.err || `exit ${done.code}`}` })))),
);
