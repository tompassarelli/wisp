

import { Context, Effect, Layer } from "effect";
import * as desktop from "../warcraft/desktop";
import type { Frame } from "./frameProbe";
export { DesktopFailure, type Ink, type Region, type Word, type InputAction, waitFor } from "../warcraft/desktop";


export type Client = Pick<desktop.Client, "name" | "documents" | "menuReportPort">;

export class Clients extends Context.Service<Clients, {

  readonly all: readonly [Client, ...Client[]];
  readonly read: (client: Client, region?: desktop.Region, ink?: desktop.Ink) => Effect.Effect<string, desktop.DesktopFailure>;

  readonly capture: (client: Client) => Effect.Effect<Frame, desktop.DesktopFailure>;
  readonly words: (client: Client, ink?: desktop.Ink) => Effect.Effect<readonly desktop.Word[], desktop.DesktopFailure>;
  readonly click: (client: Client, x: number, y: number) => Effect.Effect<void, desktop.DesktopFailure>;
  readonly keys: (client: Client, ...names: string[]) => Effect.Effect<void, desktop.DesktopFailure>;
  readonly typeText: (client: Client, value: string) => Effect.Effect<void, desktop.DesktopFailure>;
  readonly batch: (client: Client, actions: readonly desktop.InputAction[]) => Effect.Effect<void, desktop.DesktopFailure>;
}>()("wisp/Clients") {
  static readonly layer = (path: string) => Layer.effect(Clients, connect(path));
}


export const waitForText = (client: Client, what: string, pattern: RegExp, region?: desktop.Region, ink: desktop.Ink = "light", seconds = 20) =>
  Effect.gen(function*() {
    const clients = yield* Clients;
    return yield* desktop.waitFor(client, what, seconds, clients.read(client, region, ink).pipe(
      Effect.map((seen) => (pattern.test(seen.replace(/\s+/g, " ")) ? seen : undefined)),
    ));
  });

const connect = (path: string) => Effect.gen(function*() {
  const [first, ...others] = yield* desktop.loadClients(path);
  if (first === undefined) return yield* new desktop.DesktopFailure({ operation: "decode clients file", client: path, cause: "no clients" });
  const sessions = new Map([first, ...others].map((session) => [session.name, session]));
  const session = (client: Client) => {
    const found = sessions.get(client.name);
    return found === undefined
      ? Effect.fail(new desktop.DesktopFailure({ operation: "find client", client: client.name, cause: "not in the clients file" }))
      : Effect.succeed(found);
  };
  return Clients.of({
    all: [first, ...others],
    read: (client, region, ink = "light") => Effect.flatMap(session(client), (value) => desktop.read(value, region, ink)),
    capture: (client) => Effect.flatMap(session(client), (value) => desktop.capture(value)),
    words: (client, ink = "light") => Effect.flatMap(session(client), (value) => desktop.words(value, ink)),
    click: (client, x, y) => Effect.flatMap(session(client), (value) => desktop.click(value, x, y)),
    keys: (client, ...names) => Effect.flatMap(session(client), (value) => desktop.keys(value, ...names)),
    typeText: (client, value) => Effect.flatMap(session(client), (target) => desktop.typeText(target, value)),
    batch: (client, actions) => Effect.flatMap(session(client), (target) => desktop.batch(target, actions)),
  });
});
