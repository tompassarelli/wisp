import { Effect, Exit, Layer } from "effect";
import { expect, test } from "bun:test";
import type { Client } from "../scripts/wisp/clients";
import { type ClientState, type ClientView, ClientWatch, inState, waitFor } from "../scripts/wisp/watch";

const client: Client = { name: "a", documents: "/a/Documents/Warcraft III" };
const view = (state: ClientState): ClientView => ({ client: "a", state, source: "socket", evidence: "SetGlueScreen", at: 0, scan: "done", loadErrors: { count: 0 } });

/** A watch that reports each state once, then repeats the last. */
const scripted = (...states: ClientState[]) => {
  let index = 0;
  return Layer.succeed(ClientWatch, ClientWatch.of({ view: () => Effect.sync(() => view(states[Math.min(index++, states.length - 1)]!)) }));
};

test("waitFor returns the first view the predicate accepts", async () => {
  const seen = await Effect.runPromise(waitFor(client, inState("lobby")).pipe(Effect.provide(scripted({ kind: "menus", screen: "CUSTOM_GAMES" }, { kind: "lobby", host: true }))));
  expect(seen.state).toEqual({ kind: "lobby", host: true });
});

test("a crash or a lost Battle.net ends a wait at once, unless the predicate wants it", async () => {
  const crashed = await Effect.runPromiseExit(waitFor(client, inState("in match"), { what: "the match" }).pipe(Effect.provide(scripted({ kind: "loading" }, { kind: "crashed", reason: "Warcraft III exited" }))));
  expect(Exit.isFailure(crashed) && String(crashed.cause)).toContain("crashed: Warcraft III exited");
  const seen = await Effect.runPromise(waitFor(client, inState("disconnected", "signed in"), { failOn: [] }).pipe(Effect.provide(scripted({ kind: "disconnected", reason: "logged out" }))));
  expect(seen.state.kind).toBe("disconnected");
});
