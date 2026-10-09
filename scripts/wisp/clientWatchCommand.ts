







import { appendFileSync } from "node:fs";
import { Console, Effect, Schema } from "effect";
import type { Client } from "./clients";
import { type Command, UsageFailure, flagValues } from "./command";
import { ClientWatch, type ClientView, type WatchOptions, WatchFailure, changes, describeView, eventLine } from "./watch";

const ClientsFile = Schema.Struct({
  clients: Schema.NonEmptyArray(Schema.Struct({ name: Schema.String, documents: Schema.String, menuReportPort: Schema.optionalKey(Schema.Int) })),
});


export const watchedClients = (path: string) => Effect.tryPromise({
  try: () => Bun.file(path).json(),
  catch: (cause) => new WatchFailure({ client: path, operation: "read the clients file", problem: String(cause) }),
}).pipe(
  Effect.flatMap(Schema.decodeUnknownEffect(ClientsFile)),
  Effect.map(({ clients }): readonly Client[] => clients),
  Effect.mapError((cause) => cause instanceof WatchFailure ? cause : new WatchFailure({ client: path, operation: "decode the clients file", problem: String(cause) })),
);


export const selectClients = (all: readonly Client[], names: readonly string[]) => Effect.gen(function*() {
  const unknown = names.filter((name) => !all.some((client) => client.name === name));
  if (unknown.length > 0) return yield* new UsageFailure({ problem: `unknown client ${unknown.join(", ")}; known: ${all.map(({ name }) => name).join(", ")}` });
  return names.length === 0 ? all : all.filter((client) => names.includes(client.name));
});

const FLAGS = new Set(["--once", "--json", "--record"]);


export const makeWatch = (clientsFile: string, options: Pick<WatchOptions, "filePrefix"> = {}): Command => (args) => Effect.gen(function*() {
  const [record] = flagValues(args, "record");
  if (args.includes("--record") && record === undefined) return yield* new UsageFailure({ problem: "--record takes a FILE" });
  const names = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--record");
  const unknownFlag = args.find((arg) => arg.startsWith("--") && !FLAGS.has(arg));
  if (unknownFlag !== undefined) return yield* new UsageFailure({ problem: `unknown option ${unknownFlag}` });
  const clients = yield* selectClients(yield* watchedClients(clientsFile), names);
  const json = args.includes("--json");
  const watch = ClientWatch.layer({
    ...options,
    ...(record === undefined ? {} : {
      onMessage: (client, at, event) => appendFileSync(record, `${JSON.stringify({ client, at, messageType: event.messageType, payload: event.payload })}\n`),
    }),
  });
  yield* Effect.gen(function*() {
    const watcher = yield* ClientWatch;
    if (args.includes("--once")) {
      for (const client of clients) {
        const view = yield* watcher.view(client);
        yield* Console.log(json ? JSON.stringify(view) : `${client.name} ${describeView(view)}; ladder scan ${view.scan}; ${view.loadErrors.count} load errors`);
      }
      return;
    }
    const last = new Map<string, ClientView>();
    while (true) {
      for (const client of clients) {
        const view = yield* watcher.view(client);
        for (const event of changes(last.get(client.name), view)) yield* Console.log(json ? JSON.stringify(event) : eventLine(event));
        last.set(client.name, view);
      }
      yield* Effect.sleep("250 millis");
    }
  }).pipe(Effect.provide(watch));
});
