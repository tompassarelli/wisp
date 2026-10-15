import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readTextOrUndefined } from "./files";
import { ServiceProblem, pollFor } from "./hostProcess";
import { stateHome } from "./xdg";
import { dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import { BackgroundServices, CapacityAdmission, type PlatformError, ProcessTable, type ServiceOwner } from "../platform/services";
import type { ProcessInfo } from "../warcraft/battleNet";

export const desktopUnit = (name: string) => `wisp-desktop-${name}.service`;

export const clientUnit = (name: string) => `wisp-client-${name}.service`;

const desktopLog = (name: string) => join(stateHome(), "wisp/desktops", `${name}.log`);

const DESKTOP_RESOLUTION = "1920x1080";

const problem = (failure: PlatformError) => new ServiceProblem({ problem: failure._tag === "PlatformFailure" ? failure.problem : failure.message });

const startService = (unit: string, command: readonly string[], log?: string) =>
  BackgroundServices.use((services) => services.start(unit, command, log)).pipe(Effect.mapError(problem));

export const serviceState = (unit: string) => BackgroundServices.use((services) => services.state(unit)).pipe(Effect.mapError(problem));

export const stopService = (unit: string) => BackgroundServices.use((services) => services.stop(unit)).pipe(Effect.mapError(problem));

export type Owner = ServiceOwner;

export const ownerOf = (pid: number) => BackgroundServices.use((services) => services.owner(pid)).pipe(Effect.mapError(problem));

export const describeOwner = (owner: Owner | undefined) =>
  owner === undefined ? "gone" : "unit" in owner ? `service ${owner.unit}` : `not a service: started by pid ${owner.pid} (${owner.command.slice(0, 80)}), so it ends with that process`;

export const liveDesktop = (run: string) => existsSync(join(run, "runtime/wayland-0")) && existsSync(join(run, "display"));

export const desktopPid = (run: string) => Effect.gen(function*() {
  const pid = Number(readTextOrUndefined(join(run, "launcher-pid"))?.trim());
  return Number.isInteger(pid) && pid > 0 && (yield* ProcessTable.use((table) => table.alive(pid)).pipe(Effect.mapError(problem))) ? pid : undefined;
});

export const prefixProcesses = (prefix: string) => ProcessTable.use((table) => table.list).pipe(
  Effect.mapError(problem),
  Effect.map((processes): readonly ProcessInfo[] => processes.filter((process) => process.prefix === prefix).sort((a, b) => Number(/battle\.net/i.test(b.args.join(" "))) - Number(/battle\.net/i.test(a.args.join(" "))))),
);

export const desktopCommand = (capacity: string, desktop: string, name: string) =>
  CapacityAdmission.use((admission) => admission.session(capacity, `wisp-desktop-${name}`, 1.5)).pipe(
    Effect.mapError(problem),
    Effect.map((session) => [...session, "bash", desktop, "start", "--resolution", DESKTOP_RESOLUTION]),
  );

export const startDesktop = (name: string, command: readonly string[], seconds = 60) => Effect.gen(function*() {
  const log = desktopLog(name);
  const offset = readTextOrUndefined(log)?.length ?? 0;
  yield* startService(desktopUnit(name), command, log);
  const desktopUp = Effect.gen(function*() {
    const written = (readTextOrUndefined(log) ?? "").slice(offset);
    const runDir = /^Run: (\S+)$/m.exec(written)?.[1];
    if (runDir !== undefined && liveDesktop(runDir)) return runDir;
    const state = yield* serviceState(desktopUnit(name));
    if (state.active !== "active" && state.active !== "activating") {
      return yield* new ServiceProblem({ problem: `${name}: its desktop service ended before the desktop was up: ${written.trim().split("\n").slice(-3).join(" | ") || state.active} (${log})` });
    }
    return undefined;
  });
  const runDir = yield* pollFor(seconds, "250 millis", desktopUp);
  return runDir ?? (yield* new ServiceProblem({ problem: `${name}: no live desktop within ${seconds} s (${log})` }));
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

