




import { Effect, Layer } from "effect";
import type { Platform } from "../platform/services";
import * as desktop from "../warcraft/desktop";
import { type Command, type CommandFailure, UsageFailure } from "./command";
import { type ClientProfile, clientSettings } from "./lan/pool";
import { DoctorHands, DoctorStop, type DoctorTarget, doctor, signOut } from "./doctor";
import { privateDoctorHands } from "./doctorHost";
import { PlayMachine } from "./play";
import { type PlayTools, playMachineLayer } from "./playHost";
import type { ClientWatch } from "./watch";

export interface DoctorDeclaration {

  readonly clientsFile: string;

  readonly start: Readonly<Record<string, Exclude<DoctorTarget["start"], { readonly kind: "offline-pool" }>>>;

  readonly accounts?: Readonly<Record<string, NonNullable<DoctorTarget["account"]>>>;
}

const DOCUMENTS = "/drive_c/users/steamuser/Documents/Warcraft III";


export const profileSettings = (entry: { readonly profile?: ClientProfile | undefined; readonly displaySettings?: Readonly<Record<string, string>> | undefined }) => {
  const settings = clientSettings(entry.profile ?? "minimal");
  return { ...settings, Video: { ...settings["Video"], ...entry.displaySettings } };
};


export const doctorTargets = (declaration: DoctorDeclaration, names: readonly string[] = []) => Effect.gen(function*() {
  const config = yield* desktop.readClientsFile(declaration.clientsFile).pipe(Effect.mapError((cause) => new DoctorStop({ problem: cause.message })));
  const unknown = names.filter((name) => !config.clients.some((client) => client.name === name));
  if (unknown.length > 0) return yield* new UsageFailure({ problem: `unknown client ${unknown.join(", ")}; known: ${config.clients.map(({ name }) => name).join(", ")}` });
  const chosen = names.length === 0 ? config.clients : config.clients.filter((client) => names.includes(client.name));
  return yield* Effect.forEach(chosen, (entry) => Effect.gen(function*() {
    const start = entry.offline === true ? { kind: "offline-pool" } as const : declaration.start[entry.name];
    if (start === undefined) return yield* new DoctorStop({ problem: `${entry.name}: the game declares no way to start its Battle.net` });
    if (!entry.documents.endsWith(DOCUMENTS)) return yield* new DoctorStop({ problem: `${entry.name}: its documents folder isn't a Wine prefix's ${DOCUMENTS}: ${entry.documents}` });
    const display = yield* desktop.displayOf(entry).pipe(Effect.mapError((cause) => new DoctorStop({ problem: cause.message })));
    return {
      client: { name: entry.name, documents: entry.documents, ...(entry.menuReportPort === undefined ? {} : { menuReportPort: entry.menuReportPort }) },
      prefix: entry.documents.slice(0, -DOCUMENTS.length),
      display,
      start,

      ...(entry.offline === true ? {} : { settings: profileSettings(entry) }),
      ...(declaration.accounts?.[entry.name] === undefined ? {} : { account: declaration.accounts[entry.name] }),
    } satisfies DoctorTarget;
  }));
});


export const doctorLayer = (declaration: DoctorDeclaration, tools: Partial<PlayTools> = {}): Layer.Layer<PlayMachine | DoctorHands, CommandFailure, Platform> =>
  Layer.merge(playMachineLayer(tools), privateDoctorHands(declaration.clientsFile));





export const clientsDoctor = (declaration: DoctorDeclaration, names: readonly string[] = [], print: (line: string) => void = console.log, tools: Partial<PlayTools> = {}) =>
  Effect.gen(function*() {
    return yield* doctor(yield* doctorTargets(declaration, names), print);
  }).pipe(Effect.provide(doctorLayer(declaration, tools)));


export const makeDoctor = (declaration: DoctorDeclaration, watch: Layer.Layer<ClientWatch, CommandFailure, Platform>, tools: Partial<PlayTools> = {}): Command => (names) =>
  names.some((name) => name.startsWith("-"))
    ? Effect.fail(new UsageFailure({ problem: "doctor takes client names only" }))
    : clientsDoctor(declaration, names, (line) => console.log(line), tools).pipe(Effect.provide(watch), Effect.asVoid);


export const makeSignOut = (declaration: DoctorDeclaration, tools: Partial<PlayTools> = {}): Command => (names) =>
  names.length === 0 || names.some((name) => name.startsWith("-"))
    ? Effect.fail(new UsageFailure({ problem: "sign-out takes client names" }))
    : Effect.gen(function*() {
      const targets = yield* doctorTargets(declaration, names);
      yield* Effect.forEach(targets, (target) => signOut(target, (line) => console.log(line)), { discard: true });
    }).pipe(Effect.provide(playMachineLayer(tools)));
