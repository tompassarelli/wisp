// `wisp client look|read|click|keys|chat CLIENT ...`: reads and drives one
// signed-in client on its private desktop.
//   look CLIENT [gold]          words on screen with positions
//   read CLIENT X Y W H [gold]  text in one region
//   click CLIENT X Y
//   keys CLIENT KEY...
//   chat CLIENT TEXT...         Return, the text, Return: a chat message or chat command
//   state CLIENT                its state from events (wisp:docs/watch.md), not its screen
//   wait CLIENT STATE... [--seconds N]  until it is in one of these states; a crash or lost Battle.net fails at once
import { Console, Effect } from "effect";
import { Clients, type Ink } from "../clients";
import { type Command, UsageFailure, flagValues } from "../command";
import { step } from "../timings";
import { ClientWatch, FAIL_ON, STATE_KINDS, type StateKind, describeView, inState, waitFor } from "../watch";
import { selectClients, watchedClients } from "./watch";

const numbers = (values: readonly string[], count: number) => {
  const parsed = values.slice(0, count).map(Number);
  return parsed.length === count && parsed.every(Number.isInteger) ? parsed : undefined;
};

/** `state CLIENT` and `wait CLIENT STATE... [--seconds N]`: the client's state from its events, as `wisp watch` decides it, without its screen. */
const watchAction = (clientsFile: string, action: "state" | "wait", name: string | undefined, rest: readonly string[]) => Effect.gen(function*() {
  const [target] = yield* selectClients(yield* watchedClients(clientsFile), name === undefined ? [] : [name]);
  if (name === undefined || target === undefined) return yield* new UsageFailure({ problem: `${action} takes CLIENT` });
  if (action === "state") {
    const view = yield* ClientWatch.use((watch) => watch.view(target));
    yield* Console.log(`${describeView(view)}; ladder scan ${view.scan}; ${view.loadErrors.count} load errors`);
    return;
  }
  const [seconds = "60"] = flagValues(rest, "seconds");
  const kinds = rest.filter((arg, index) => !arg.startsWith("--") && rest[index - 1] !== "--seconds");
  const unknown = kinds.filter((kind) => !STATE_KINDS.includes(kind as StateKind));
  if (kinds.length === 0 || unknown.length > 0 || !(Number(seconds) > 0)) {
    return yield* new UsageFailure({ problem: `wait takes CLIENT STATE... [--seconds N]; states: ${STATE_KINDS.map((kind) => (kind.includes(" ") ? `"${kind}"` : kind)).join(", ")}` });
  }
  const view = yield* waitFor(target, inState(...(kinds as StateKind[])), { what: kinds.join(" or "), seconds: Number(seconds), failOn: FAIL_ON.filter((kind) => !kinds.includes(kind)) });
  yield* Console.log(describeView(view));
}).pipe(Effect.provide(ClientWatch.layer()), step(`${action} ${name ?? ""}`));

export const makeClient = (stateFilePath: string): Command => ([action, name, ...rest]) => action === "state" || action === "wait" ? watchAction(stateFilePath, action, name, rest) : Effect.gen(function*() {
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
}).pipe(Effect.provide(Clients.layer(stateFilePath)));
