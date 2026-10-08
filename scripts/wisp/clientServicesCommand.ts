// `wisp client start|stop|status [CLIENT...]`: the clients file's signed-in
// clients and their private desktops as user services (wisp:docs/doctor.md,
// "Clients as services").
import { Console, Effect } from "effect";
import * as desktop from "../warcraft/desktop";
import type { Command } from "./command";
import { UsageFailure } from "./command";
import {
  ServiceProblem, clientUnit, describeOwner, desktopCommand, desktopPid, desktopUnit, liveDesktop, ownerOf, prefixProcesses, serviceState, skillScript, startDesktop, stopService, writeRun,
} from "./clientServices";
import { ClientWatch, type WatchOptions, describeView, inState, waitFor } from "./watch";

const DOCUMENTS = "/drive_c/users/steamuser/Documents/Warcraft III";

/** The named clients of the file (all when none), without the offline pool's, which their pool owns. */
const chosenClients = (clientsFile: string, names: readonly string[]) => Effect.gen(function*() {
  if (names.some((name) => name.startsWith("-"))) return yield* new UsageFailure({ problem: "takes client names only" });
  const config = yield* desktop.readClientsFile(clientsFile).pipe(Effect.mapError((cause) => new ServiceProblem({ problem: cause.message })));
  const unknown = names.filter((name) => !config.clients.some((client) => client.name === name));
  if (unknown.length > 0) return yield* new UsageFailure({ problem: `unknown client ${unknown.join(", ")}; known: ${config.clients.map(({ name }) => name).join(", ")}` });
  return config.clients.filter((client) => client.offline !== true && (names.length === 0 || names.includes(client.name)));
});

const unitLine = (unit: string) => serviceState(unit).pipe(Effect.map((state) => `${state.active}${state.since === "" ? "" : ` since ${state.since}`}`));

/** Who runs the client's desktop and Battle.net, and what its game is doing. */
const statusLines = (clientsFile: string, names: readonly string[], watch: WatchOptions) => Effect.gen(function*() {
  const clients = yield* chosenClients(clientsFile, names);
  const watcher = yield* ClientWatch;
  for (const entry of clients) {
    const pid = desktopPid(entry.run);
    const desktopOwner = pid === undefined ? undefined : ownerOf(pid);
    const desktopText = !liveDesktop(entry.run) ? `no live desktop at ${entry.run}` : `${entry.run}, ${describeOwner(desktopOwner)}${desktopOwner !== undefined && "unit" in desktopOwner ? ` (${yield* unitLine(desktopOwner.unit)})` : ""}`;
    yield* Console.log(`${entry.name}: desktop: ${desktopText}`);
    const prefix = entry.documents.endsWith(DOCUMENTS) ? entry.documents.slice(0, -DOCUMENTS.length) : undefined;
    const [first] = prefix === undefined ? [] : prefixProcesses(prefix);
    const owner = first === undefined ? undefined : ownerOf(first.pid);
    const battleNet = first === undefined ? "not running" : `${describeOwner(owner)}${owner !== undefined && "unit" in owner ? ` (${yield* unitLine(owner.unit)})` : ""}`;
    const client = { name: entry.name, documents: entry.documents, ...(entry.menuReportPort === undefined ? {} : { menuReportPort: entry.menuReportPort }) };
    const view = yield* watcher.view(client).pipe(Effect.map(describeView), Effect.catch((failure) => Effect.succeed(`unknown: ${failure.message}`)));
    yield* Console.log(`${entry.name}: Battle.net: ${battleNet}; game: ${view}`);
  }
}).pipe(Effect.provide(ClientWatch.layer(watch)));

export const serviceStatus = (clientsFile: string, names: readonly string[], watch: WatchOptions) => statusLines(clientsFile, names, watch);

/** The private desktop service the launcher starts for `name`; returns its live run folder. */
const desktopService = (name: string) => Effect.gen(function*() {
  const capacity = yield* skillScript("machine-capacity", "scripts/machine-capacity.mjs");
  const launcher = yield* skillScript("private-desktop-development", "scripts/private-desktop.sh");
  return yield* startDesktop(name, desktopCommand(capacity, launcher, name));
});

/**
 * Starts a new private desktop for each named signed-in client whose desktop
 * isn't live (after `client stop`, its run folder is gone) and points the
 * clients file at it, so the game's doctor declaration reads a live display.
 */
export const reviveDesktops = <E = never>(clientsFile: string, names: readonly string[], start: (name: string) => Effect.Effect<string, ServiceProblem | E> = desktopService) => Effect.gen(function*() {
  const missing = (yield* chosenClients(clientsFile, names)).filter((entry) => !liveDesktop(entry.run));
  for (const entry of missing) {
    yield* Console.log(`${entry.name}: no live desktop at ${entry.run}; starting its private desktop as the service ${desktopUnit(entry.name)}`);
    const runDir = yield* start(entry.name);
    yield* writeRun(clientsFile, entry.name, runDir);
    yield* Console.log(`${entry.name}: desktop ${runDir}`);
  }
});

/** `client doctor`: a client stopped with `client stop` gets its desktop back first. */
export const serviceDoctor = (clientsFile: string, names: readonly string[], doctor: Command) =>
  reviveDesktops(clientsFile, names).pipe(Effect.andThen(doctor(names)));

/**
 * Starts a desktop service for each named client whose desktop isn't live
 * and writes its run folder into the clients file; doctor then starts each
 * Battle.net as a service and brings the game to the menu. Clients already
 * running, under any owner, are kept.
 */
export const serviceStart = (clientsFile: string, names: readonly string[], doctor: Command, watch: WatchOptions) => Effect.gen(function*() {
  const clients = yield* chosenClients(clientsFile, names);
  yield* reviveDesktops(clientsFile, names);
  yield* doctor(clients.map(({ name }) => name));
  // Doctor leaves a game still opening the ladder maps ("running"); start returns once each reached its menu or is already further on.
  yield* Effect.forEach(clients, (entry) => {
    const client = { name: entry.name, documents: entry.documents, ...(entry.menuReportPort === undefined ? {} : { menuReportPort: entry.menuReportPort }) };
    return waitFor(client, inState("menus", "lobby", "loading", "in match", "results"), { what: "its menu", seconds: MENU_SECONDS });
  }, { discard: true }).pipe(Effect.provide(ClientWatch.layer(watch)));
  yield* statusLines(clientsFile, clients.map(({ name }) => name), watch);
});

/** Warcraft III opens every ladder map before its menu: 2.5 minutes after it started on clone-d on 8 October 2026. */
const MENU_SECONDS = 420;

/** Stops each named client's Battle.net service, then its desktop service. A client some other process started is left alone and named. */
export const serviceStop = (clientsFile: string, names: readonly string[]) => Effect.gen(function*() {
  const clients = yield* chosenClients(clientsFile, names);
  for (const entry of clients) {
    const prefix = entry.documents.endsWith(DOCUMENTS) ? entry.documents.slice(0, -DOCUMENTS.length) : undefined;
    const [first] = prefix === undefined ? [] : prefixProcesses(prefix);
    const owner = first === undefined ? undefined : ownerOf(first.pid);
    const pid = desktopPid(entry.run);
    const desktopOwner = pid === undefined ? undefined : ownerOf(pid);
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
