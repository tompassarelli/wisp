// `wisp client look|read|click|keys|chat CLIENT ...`: reads and drives one
// signed-in client on its private desktop.
//   look CLIENT [gold]          words on screen with positions
//   read CLIENT X Y W H [gold]  text in one region
//   click CLIENT X Y
//   keys CLIENT KEY...
//   chat CLIENT TEXT...         Return, the text, Return: a chat message or chat command, only in a match
//   watch CLIENT --once                its state from events (wisp:docs/watch.md), not its screen
//   wait CLIENT STATE... [--seconds N]  until it is in one of these states; a crash or lost Battle.net fails at once
//   doctor [CLIENT...]                 recovers known bad states, signing in with each client's account (wisp:docs/doctor.md)
//   sign-out CLIENT...                 signs clients out of Battle.net; doctor signs them in again
//   start [CLIENT...]                  starts missing desktops as services, then doctor to the menu (wisp:docs/doctor.md, "Clients as services")
//   stop [CLIENT...]                   stops their Battle.net and desktop services
//   status [CLIENT...]                 each client's desktop and Battle.net service, and its state
import { Console, Effect, Layer } from "effect";
import { Clients, type Ink } from "../clients";
import { type Command, UsageFailure, flagValues } from "../command";
import { step } from "../timings";
import { ClientWatch, FAIL_ON, STATE_KINDS, type StateKind, type WatchOptions, describeView, inState, waitFor } from "../watch";
import { makeWatch, selectClients, watchedClients } from "../clientWatchCommand";
import { serviceDoctor, serviceStart, serviceStatus, serviceStop } from "../clientServicesCommand";

const numbers = (values: readonly string[], count: number) => {
  const parsed = values.slice(0, count).map(Number);
  return parsed.length === count && parsed.every(Number.isInteger) ? parsed : undefined;
};

/** `watch CLIENT --once` and `wait CLIENT STATE... [--seconds N]`: the client's state from its events, as `wisp client watch` decides it, without its screen. */
const watchAction = (clientsFile: string, action: "wait", name: string | undefined, rest: readonly string[], watch: WatchOptions) => Effect.gen(function*() {
  const [target] = yield* selectClients(yield* watchedClients(clientsFile), name === undefined ? [] : [name]);
  if (name === undefined || target === undefined) return yield* new UsageFailure({ problem: `${action} takes CLIENT` });
  const [seconds = "60"] = flagValues(rest, "seconds");
  const kinds = rest.filter((arg, index) => !arg.startsWith("--") && rest[index - 1] !== "--seconds");
  const unknown = kinds.filter((kind) => !STATE_KINDS.includes(kind as StateKind));
  if (kinds.length === 0 || unknown.length > 0 || !(Number(seconds) > 0)) {
    return yield* new UsageFailure({ problem: `wait takes CLIENT STATE... [--seconds N]; states: ${STATE_KINDS.map((kind) => (kind.includes(" ") ? `"${kind}"` : kind)).join(", ")}` });
  }
  const view = yield* waitFor(target, inState(...(kinds as StateKind[])), { what: kinds.join(" or "), seconds: Number(seconds), failOn: FAIL_ON.filter((kind) => !kinds.includes(kind)) });
  yield* Console.log(describeView(view));
}).pipe(Effect.provide(ClientWatch.layer(watch)), step(`${action} ${name ?? ""}`));

/**
 * `watch.filePrefix` is the map's runtime file prefix: its match receipts
 * tell a match from a lobby when the menus don't, for `watch`, `wait` and the
 * match check before `chat` and Return (wisp:scripts/warcraft/desktop.ts `requireMatch`).
 */
export const makeClient = (stateFilePath: string, watch: WatchOptions = {}, doctor?: Command, signOut?: Command): Command => ([action, name, ...rest]) => action === "start" ? (doctor === undefined ? Effect.fail(new UsageFailure({ problem: "the game has not declared client recovery" })) : serviceStart(stateFilePath, [...(name === undefined ? [] : [name]), ...rest], doctor, watch)) : action === "stop" ? serviceStop(stateFilePath, [...(name === undefined ? [] : [name]), ...rest]) : action === "status" ? serviceStatus(stateFilePath, [...(name === undefined ? [] : [name]), ...rest], watch) : action === "sign-out" ? (signOut === undefined ? Effect.fail(new UsageFailure({ problem: "the game has not declared client sign-out" })) : signOut([...(name === undefined ? [] : [name]), ...rest])) : action === "watch" ? makeWatch(stateFilePath, watch)([...(name === undefined ? [] : [name]), ...rest]) : action === "doctor" ? (doctor === undefined ? Effect.fail(new UsageFailure({ problem: "the game has not declared client recovery" })) : serviceDoctor(stateFilePath, [...(name === undefined ? [] : [name]), ...rest], doctor)) : action === "wait" ? watchAction(stateFilePath, action, name, rest, watch) : Effect.gen(function*() {
  const clients = yield* Clients;
  const target = clients.all.find((candidate) => candidate.name === name);
  if (target === undefined) return yield* new UsageFailure({ problem: `unknown client ${name}; known: ${clients.all.map((c) => c.name).join(", ")}` });
  const ink: Ink = rest.includes("gold") ? "gold" : "light";
  const run = Effect.gen(function*() {
    switch (action) {
      case "look":
        for (const word of yield* clients.words(target, ink)) yield* Console.log(`${word.x},${word.y} ${word.text}`);
        return;
      case "read": {
        const [x, y, width, height] = numbers(rest, 4) ?? [];
        if (x === undefined || y === undefined || width === undefined || height === undefined) return yield* new UsageFailure({ problem: "read takes X Y W H" });
        yield* Console.log((yield* clients.read(target, { x, y, width, height }, ink)).trim());
        return;
      }
      case "click": {
        const [x, y] = numbers(rest, 2) ?? [];
        if (x === undefined || y === undefined) return yield* new UsageFailure({ problem: "click takes X Y" });
        yield* clients.click(target, x, y);
        return;
      }
      case "chat":
        if (rest.length === 0) return yield* new UsageFailure({ problem: "chat takes TEXT" });
        yield* clients.batch(target, [{ kind: "keys", keys: ["Return"] }, { kind: "text", text: rest.join(" ") }, { kind: "keys", keys: ["Return"] }]);
        return;
      case "keys":
        yield* clients.keys(target, ...rest);
        return;
      default:
        return yield* new UsageFailure({ problem: `unknown client action ${action}` });
    }
  });
  yield* run.pipe(step(`${action} ${name}`));
}).pipe(Effect.provide(Layer.merge(Clients.layer(stateFilePath), ClientWatch.layer(watch))));
