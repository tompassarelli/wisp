// The accept driver for the signed-in clients: input and frames through
// Clients' private desktops, receipts and War3Log from each client's
// Documents folder, and each client's state from ClientWatch, when provided,
// which decides when a session is ready and what a failed one looked like.
// Without ClientWatch the game's `start` alone decides that the match runs.
import { join } from "node:path";
import { Effect, Layer, Option } from "effect";
import { war3LogPath } from "../warcraft/war3Log";
import { AcceptDriver, AcceptFailure, type ReceiptFile } from "./accept";
import { type Client, Clients } from "./clients";
import type { CommandFailure } from "./command";
import { GameFiles, dataDirectory } from "./gameFiles";
import { ClientWatch, type ClientView, inState, waitFor } from "./watch";

export interface LiveAcceptOptions<R> {
  /** A fresh match of the map profile in every client, ready for checks (the game's own fresh-match command). */
  readonly start: (map: string, session: string) => Effect.Effect<void, CommandFailure, R>;
  /** Which files of a client's CustomMapData are the map's receipts. */
  readonly receipt: (name: string) => boolean;
  /**
   * Makes every client usable before a session, such as `wisp client doctor`.
   * Without it a session starts only when no client is crashed or disconnected.
   */
  readonly prepare?: Effect.Effect<void, CommandFailure, R>;
  /** How long every client may take to report its match once `start` returns (default 60 s). */
  readonly matchSeconds?: number;
}

const failure = (operation: string) => (cause: { readonly message: string }) => new AcceptFailure({ operation, problem: cause.message });

const describeView = (view: ClientView) => `${view.state.kind}${"reason" in view.state ? `: ${view.state.reason}` : "screen" in view.state ? ` (${view.state.screen})` : ""}, by ${view.source}: ${view.evidence}`;

export const liveAcceptDriver = <R>({ start, receipt, prepare, matchSeconds = 60 }: LiveAcceptOptions<R>) =>
  Layer.effect(AcceptDriver, Effect.gen(function*() {
    const clients = yield* Clients;
    const files = yield* GameFiles;
    const watch = yield* Effect.serviceOption(ClientWatch);
    const context = yield* Effect.context<R>();
    const byName = new Map(clients.all.map((client) => [client.name, client]));
    const find = (name: string) => {
      const client = byName.get(name);
      return client === undefined ? Effect.fail(new AcceptFailure({ operation: "find client", problem: `${name} is not in the clients file` })) : Effect.succeed(client);
    };
    const on = <A, E extends { readonly message: string }>(name: string, operation: string, run: (client: Client) => Effect.Effect<A, E>) =>
      Effect.flatMap(find(name), (client) => run(client).pipe(Effect.mapError(failure(`${operation} ${name}`))));

    const healthy = Option.isNone(watch) ? Effect.void : Effect.forEach(clients.all, (client) => Effect.gen(function*() {
      const view = yield* watch.value.view(client).pipe(Effect.mapError(failure(`watch ${client.name}`)));
      if (view.state.kind === "crashed" || view.state.kind === "disconnected") {
        return yield* new AcceptFailure({ operation: `client ${client.name}`, problem: describeView(view) });
      }
    }), { discard: true });

    return AcceptDriver.of({
      clients: [clients.all[0].name, ...clients.all.slice(1).map(({ name }) => name)],
      prepare: (prepare === undefined ? healthy : prepare.pipe(Effect.mapError(failure("prepare clients")))).pipe(Effect.provide(context)),
      start: (map, session) => Effect.gen(function*() {
        yield* start(map, session).pipe(Effect.mapError(failure(`start ${map} (${session})`)));
        if (Option.isNone(watch)) return;
        const watched = Layer.succeed(ClientWatch, watch.value);
        yield* Effect.forEach(clients.all, (client) => waitFor(client, inState("in match"), { what: "the match", seconds: matchSeconds }).pipe(Effect.mapError(failure(`${client.name} in match`)), Effect.provide(watched)), { concurrency: "unbounded", discard: true });
      }).pipe(Effect.provide(context)),
      chat: (name, text) => on(name, "chat", (client) => clients.batch(client, [{ kind: "keys", keys: ["Return"] }, { kind: "text", text }, { kind: "keys", keys: ["Return"] }])),
      keys: (name, keys) => on(name, "keys", (client) => clients.keys(client, ...keys)),
      capture: (name) => on(name, "capture", (client) => clients.capture(client)),
      read: (name, region, ink) => on(name, "read", (client) => clients.read(client, region, ink)),
      receipts: (name) => on(name, "receipts", (client) => Effect.gen(function*() {
        const directory = dataDirectory(client.documents);
        const names = (yield* files.list(directory)).filter(receipt);
        const found: ReceiptFile[] = [];
        for (const file of names) {
          const stored = yield* files.read(join(directory, file));
          if (stored !== undefined) found.push({ name: file, ...stored });
        }
        return found;
      })),
      log: (name) => on(name, "War3Log", (client) => Effect.map(files.read(war3LogPath(client.documents)), (stored) => stored?.text ?? "")),
      state: (name) => Option.isNone(watch) ? Effect.succeed("not watched") : on(name, "watch", (client) => Effect.map(watch.value.view(client), describeView)),
    });
  }));
