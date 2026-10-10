import { Console, Effect } from "effect";
import type { Platform } from "../platform/services";
import { prefixFromDocuments } from "../warcraft/battleNet";
import * as desktop from "../warcraft/desktop";
import type { Command } from "./command";
import { UsageFailure } from "./command";
import {
  ServiceProblem, clientUnit, describeOwner, desktopCommand, desktopPid, desktopUnit, liveDesktop, ownerOf, prefixProcesses, serviceState, skillScript, startDesktop, stopService, writeRun,
} from "./clientServices";
import { ClientWatch, type WatchOptions, describeView, inState, waitFor } from "./watch";

const chosenClients = (clientsFile: string, names: readonly string[]) => Effect.gen(function*() {
  if (names.some((name) => name.startsWith("-"))) return yield* new UsageFailure({ problem: "takes client names only" });
  const config = yield* desktop.readClientsFile(clientsFile).pipe(Effect.mapError((cause) => new ServiceProblem({ problem: cause.message })));
  const unknown = names.filter((name) => !config.clients.some((client) => client.name === name));
  if (unknown.length > 0) return yield* new UsageFailure({ problem: `unknown client ${unknown.join(", ")}; known: ${config.clients.map(({ name }) => name).join(", ")}` });
  return config.clients.filter((client) => client.offline !== true && (names.length === 0 || names.includes(client.name)));
});

const unitLine = (unit: string) => serviceState(unit).pipe(Effect.map((state) => `${state.active}${state.since === "" ? "" : ` since ${state.since}`}`));

const statusLines = (clientsFile: string, names: readonly string[], watch: WatchOptions) => Effect.gen(function*() {
  const clients = yield* chosenClients(clientsFile, names);
  const watcher = yield* ClientWatch;
  for (const entry of clients) {
    const pid = yield* desktopPid(entry.run);
    const desktopOwner = pid === undefined ? undefined : yield* ownerOf(pid);
    const desktopText = !liveDesktop(entry.run) ? `no live desktop at ${entry.run}` : `${entry.run}, ${describeOwner(desktopOwner)}${desktopOwner !== undefined && "unit" in desktopOwner ? ` (${yield* unitLine(desktopOwner.unit)})` : ""}`;
    yield* Console.log(`${entry.name}: desktop: ${desktopText}`);
    const prefix = prefixFromDocuments(entry.documents);
    const [first] = prefix === undefined ? [] : yield* prefixProcesses(prefix);
    const owner = first === undefined ? undefined : yield* ownerOf(first.pid);
    const battleNet = first === undefined ? "not running" : `${describeOwner(owner)}${owner !== undefined && "unit" in owner ? ` (${yield* unitLine(owner.unit)})` : ""}`;
    const client = { name: entry.name, documents: entry.documents, ...(entry.menuReportPort === undefined ? {} : { menuReportPort: entry.menuReportPort }) };
    const view = yield* watcher.view(client).pipe(Effect.map(describeView), Effect.catch((failure) => Effect.succeed(`unknown: ${failure.message}`)));
    yield* Console.log(`${entry.name}: Battle.net: ${battleNet}; game: ${view}`);
  }
}).pipe(Effect.provide(ClientWatch.layer(watch)));

export const serviceStatus = (clientsFile: string, names: readonly string[], watch: WatchOptions) => statusLines(clientsFile, names, watch);

const desktopService = (name: string) => Effect.gen(function*() {
  const capacity = yield* skillScript("machine-capacity", "scripts/machine-capacity.mjs");
  const launcher = yield* skillScript("private-desktop-development", "scripts/private-desktop.sh");
  return yield* startDesktop(name, yield* desktopCommand(capacity, launcher, name));
});

export const reviveDesktops = <E = never>(clientsFile: string, names: readonly string[], start: (name: string) => Effect.Effect<string, ServiceProblem | E, Platform> = desktopService) => Effect.gen(function*() {
  const missing = (yield* chosenClients(clientsFile, names)).filter((entry) => !liveDesktop(entry.run));
  for (const entry of missing) {
    yield* Console.log(`${entry.name}: no live desktop at ${entry.run}; starting its private desktop as the service ${desktopUnit(entry.name)}`);
    const runDir = yield* start(entry.name);
    yield* writeRun(clientsFile, entry.name, runDir);
    yield* Console.log(`${entry.name}: desktop ${runDir}`);
  }
});

export const serviceDoctor = (clientsFile: string, names: readonly string[], doctor: Command) =>
  reviveDesktops(clientsFile, names).pipe(Effect.andThen(doctor(names)));

export const serviceStart = (clientsFile: string, names: readonly string[], doctor: Command, watch: WatchOptions) => Effect.gen(function*() {
  const clients = yield* chosenClients(clientsFile, names);
  yield* reviveDesktops(clientsFile, names);
  yield* doctor(clients.map(({ name }) => name));

  yield* Effect.forEach(clients, (entry) => {
    const client = { name: entry.name, documents: entry.documents, ...(entry.menuReportPort === undefined ? {} : { menuReportPort: entry.menuReportPort }) };
    return waitFor(client, inState("menus", "lobby", "loading", "in match", "results"), { what: "its menu", seconds: MENU_SECONDS });
  }, { discard: true }).pipe(Effect.provide(ClientWatch.layer(watch)));
  yield* statusLines(clientsFile, clients.map(({ name }) => name), watch);
});

const MENU_SECONDS = 420;

export const serviceStop = (clientsFile: string, names: readonly string[]) => Effect.gen(function*() {
  const clients = yield* chosenClients(clientsFile, names);
  for (const entry of clients) {
    const prefix = prefixFromDocuments(entry.documents);
    const [first] = prefix === undefined ? [] : yield* prefixProcesses(prefix);
    const owner = first === undefined ? undefined : yield* ownerOf(first.pid);
    const pid = yield* desktopPid(entry.run);
    const desktopOwner = pid === undefined ? undefined : yield* ownerOf(pid);
    const units = [...new Set([
      ...(owner !== undefined && "unit" in owner ? [owner.unit] : []), clientUnit(entry.name),
      ...(desktopOwner !== undefined && "unit" in desktopOwner ? [desktopOwner.unit] : []), desktopUnit(entry.name),
    ])];
    for (const unit of units) {
      if (!["active", "activating", "deactivating", "reloading"].includes((yield* serviceState(unit)).active)) continue;
      yield* stopService(unit);
      yield* Console.log(`${entry.name}: stopped ${unit}`);
    }
    for (const [what, left] of [["Battle.net", owner], ["desktop", desktopOwner]] as const) {
      if (left !== undefined && !("unit" in left)) yield* Console.log(`${entry.name}: ${what} left running: ${describeOwner(left)}; stop it there`);
    }
  }
});
