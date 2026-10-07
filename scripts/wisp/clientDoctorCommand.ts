// `wisp client doctor [CLIENT...]`: brings the clients of the clients file (all, or
// those named) to a ready state, recovering each known bad state with its
// documented recovery and printing each step (wisp:docs/doctor.md). It stops
// with one plain line per client that needs a person, such as a sign-in.
import { Effect, Layer } from "effect";
import * as desktop from "../warcraft/desktop";
import { type Command, type CommandFailure, UsageFailure } from "./command";
import { DoctorHands, DoctorStop, type DoctorTarget, doctor } from "./doctor";
import { privateDoctorHands } from "./doctorHost";
import { withAutopsy } from "./engine/autopsy";
import { PlayMachine } from "./play";
import { type PlayTools, playMachineLayer } from "./playHost";
import type { ClientWatch } from "./watch";

export interface DoctorDeclaration {
  /** The clients file (wisp:docs/sample-map.md): each client's desktop run folder, Documents folder, menu port and expected display settings. */
  readonly clientsFile: string;
  /** How each client's Battle.net starts, by client name. */
  readonly start: Readonly<Record<string, DoctorTarget["start"]>>;
}

const DOCUMENTS = "/drive_c/users/steamuser/Documents/Warcraft III";

/** Doctor's targets for the named clients of the clients file, or all of them. */
export const doctorTargets = (declaration: DoctorDeclaration, names: readonly string[] = []) => Effect.gen(function*() {
  const config = yield* desktop.readClientsFile(declaration.clientsFile).pipe(Effect.mapError((cause) => new DoctorStop({ problem: cause.message })));
  const unknown = names.filter((name) => !config.clients.some((client) => client.name === name));
  if (unknown.length > 0) return yield* new UsageFailure({ problem: `unknown client ${unknown.join(", ")}; known: ${config.clients.map(({ name }) => name).join(", ")}` });
  const chosen = names.length === 0 ? config.clients : config.clients.filter((client) => names.includes(client.name));
  return yield* Effect.forEach(chosen, (entry) => Effect.gen(function*() {
    const start = declaration.start[entry.name];
    if (start === undefined) return yield* new DoctorStop({ problem: `${entry.name}: the game declares no way to start its Battle.net` });
    if (!entry.documents.endsWith(DOCUMENTS)) return yield* new DoctorStop({ problem: `${entry.name}: its documents folder isn't a Wine prefix's ${DOCUMENTS}: ${entry.documents}` });
    const { x11 } = yield* desktop.desktopSession(entry).pipe(Effect.mapError((cause) => new DoctorStop({ problem: cause.message })));
    return {
      client: { name: entry.name, documents: entry.documents, ...(entry.menuReportPort === undefined ? {} : { menuReportPort: entry.menuReportPort }) },
      prefix: entry.documents.slice(0, -DOCUMENTS.length),
      display: x11.DISPLAY,
      start,
      ...(entry.displaySettings === undefined ? {} : { displaySettings: entry.displaySettings }),
    } satisfies DoctorTarget;
  }));
});

/** What doctor needs beside a watch for the clients file's clients: the host and their private desktops. */
export const doctorLayer = (declaration: DoctorDeclaration, tools: Partial<PlayTools> = {}): Layer.Layer<PlayMachine | DoctorHands, CommandFailure> =>
  Layer.merge(playMachineLayer(tools), privateDoctorHands(declaration.clientsFile));

/**
 * Doctor for the named clients (all when none), printing each step, with the
 * caller's ClientWatch: for bot sessions and `accept`, which hold one already.
 */
export const clientsDoctor = (declaration: DoctorDeclaration, names: readonly string[] = [], print: (line: string) => void = console.log, tools: Partial<PlayTools> = {}) =>
  Effect.gen(function*() {
    return yield* doctor(yield* doctorTargets(declaration, names), print);
  }).pipe(Effect.provide(doctorLayer(declaration, tools)));

/** `doctor [CLIENT...]`, watching the clients through `watch` (`wisp client watch`'s ClientWatch layer), inside the desync autopsy (wisp:docs/autopsy.md). */
export const makeDoctor = (declaration: DoctorDeclaration, watch: Layer.Layer<ClientWatch, CommandFailure>, tools: Partial<PlayTools> = {}): Command => (names) =>
  names.some((name) => name.startsWith("-"))
    ? Effect.fail(new UsageFailure({ problem: "doctor takes client names only" }))
    : withAutopsy({ clientsFile: declaration.clientsFile, names }, clientsDoctor(declaration, names, (line) => console.log(line), tools)).pipe(Effect.provide(watch), Effect.asVoid);
