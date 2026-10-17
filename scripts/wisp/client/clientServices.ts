import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readTextOrUndefined } from "../io/files";
import { ServiceProblem, pollFor } from "../cli/hostProcess";
import { stateHome } from "../io/xdg";
import { dirname, join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { BackgroundServices, CapacityAdmission, type PlatformError, ProcessTable, type ServiceOwner } from "../../platform/services";
import type { ProcessInfo } from "../../warcraft/battleNet";
export { clientUnit } from "./clients";

/** The session that owns a desktop: its clients file, so two lanes' clients named alike get separate units. */
export const desktopOwner = (clientsFile: string) => createHash("sha256").update(resolve(clientsFile)).digest("hex").slice(0, 8);

const desktopStem = (name: string, owner: string) => `wisp-desktop-${name}-${owner}`;

export const desktopUnit = (name: string, owner: string) => `${desktopStem(name, owner)}.service`;

const desktopLog = (name: string, owner: string) => join(stateHome(), "wisp/desktops", `${name}-${owner}.log`);

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

export const prefixProcesses = (prefix: string, ownerUnit?: string) => ProcessTable.use((table) => table.list).pipe(
  Effect.mapError(problem),
  Effect.map((processes): readonly ProcessInfo[] => processes.filter((process) => process.prefix === prefix || (process.prefix === undefined && ownerUnit !== undefined && process.ownerUnit === ownerUnit)).sort((a, b) => Number(/battle\.net/i.test(b.args.join(" "))) - Number(/battle\.net/i.test(a.args.join(" "))))),
);

export const desktopCommand = (capacity: string, desktop: string, name: string, owner: string) =>
  CapacityAdmission.use((admission) => admission.session(capacity, desktopStem(name, owner), 1.5)).pipe(
    Effect.mapError(problem),
    Effect.map((session) => [...session, "bash", desktop, "start", "--resolution", DESKTOP_RESOLUTION]),
  );

export const startDesktop = (name: string, command: readonly string[], owner: string, seconds = 60) => Effect.gen(function*() {
  const unit = desktopUnit(name, owner);
  const log = desktopLog(name, owner);
  const offset = readTextOrUndefined(log)?.length ?? 0;
  yield* startService(unit, command, log);
  const desktopUp = Effect.gen(function*() {
    const written = (readTextOrUndefined(log) ?? "").slice(offset);
    const runDir = /^Run: (\S+)$/m.exec(written)?.[1];
    if (runDir !== undefined && liveDesktop(runDir)) return runDir;
    const state = yield* serviceState(unit);
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

