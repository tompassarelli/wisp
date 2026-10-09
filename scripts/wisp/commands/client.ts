













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
