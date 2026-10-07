import { Console, Effect, Schema } from "effect";
import type { Client } from "../clients";
import { type Command, UsageFailure, flagValues } from "../command";
import { ClientWatch, type ClientView, type WatchOptions, WatchFailure, changes, describeView, eventLine } from "../watch";

const ClientsFile = Schema.Struct({
  clients: Schema.NonEmptyArray(Schema.Struct({ name: Schema.String, documents: Schema.String, menuReportPort: Schema.optionalKey(Schema.Int) })),
});

/** The clients file's clients; watching needs only their folders and report ports, not their desktops. */
export const watchedClients = (path: string) => Effect.tryPromise({
  try: () => Bun.file(path).json(),
  catch: (cause) => new WatchFailure({ client: path, operation: "read the clients file", problem: String(cause) }),
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(ClientsFile)),
  Effect.map(({ clients }): readonly Client[] => clients),
  Effect.mapError((cause) => cause instanceof WatchFailure ? cause : new WatchFailure({ client: path, operation: "decode the clients file", problem: String(cause) })),
);

/** The named clients, or all of them. */
export const selectClients = (all: readonly Client[], names: readonly string[]) => Effect.gen(function*() {
  const unknown = names.filter((name) => !all.some((client) => client.name === name));
  if (unknown.length > 0) return yield* new UsageFailure({ problem: `unknown client ${unknown.join(", ")}; known: ${all.map(({ name }) => name).join(", ")}` });
  return names.length === 0 ? all : all.filter((client) => names.includes(client.name));
});

const FLAGS = new Set(["--once", "--json", "--record"]);
