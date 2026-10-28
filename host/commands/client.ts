import { Console, Effect, Layer } from "effect";
import { Clients, type Ink } from "../client/clients";
import { type Command, UsageFailure, flagValues } from "../cli/command";
import { step } from "../cli/timings";
import { ClientWatch, FAIL_ON, STATE_KINDS, type StateKind, type WatchOptions, describeView, inState, waitFor } from "../dev/watch";
import { makeWatch, selectClients, watchedClients } from "../client/clientWatchCommand";
import { serviceDoctor, serviceStart, serviceStatus, serviceStop } from "../client/clientServicesCommand";
import { shareInstalls } from "../client/clientStorage";

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

const undeclared = (what: string) => Effect.fail(new UsageFailure({ problem: `the game has not declared client ${what}` }));

type ClientsService = Clients["Service"];
type ClientTarget = ClientsService["all"][number];

const readRegion = (clients: ClientsService, target: ClientTarget, ink: Ink, rest: readonly string[]) => Effect.gen(function*() {
  const [x, y, width, height] = numbers(rest, 4) ?? [];
  if (x === undefined || y === undefined || width === undefined || height === undefined) return yield* new UsageFailure({ problem: "read takes X Y W H" });
  yield* Console.log((yield* clients.read(target, { x, y, width, height }, ink)).trim());
});

const clickPoint = (clients: ClientsService, target: ClientTarget, rest: readonly string[]) => Effect.gen(function*() {
  const [x, y] = numbers(rest, 2) ?? [];
  if (x === undefined || y === undefined) return yield* new UsageFailure({ problem: "click takes X Y" });
  yield* clients.click(target, x, y);
});

const inputAction = (stateFilePath: string, watch: WatchOptions, action: string | undefined, name: string | undefined, rest: readonly string[]) => Effect.gen(function*() {
  const clients = yield* Clients;
  const target = clients.all.find((candidate) => candidate.name === name);
  if (target === undefined) return yield* new UsageFailure({ problem: `unknown client ${name}; known: ${clients.all.map((c) => c.name).join(", ")}` });
  const ink: Ink = rest.includes("gold") ? "gold" : "light";
  const run = Effect.gen(function*() {
    switch (action) {
      case "look":
        for (const word of yield* clients.words(target, ink)) yield* Console.log(`${word.x},${word.y} ${word.text}`);
        return;
      case "read":
        return yield* readRegion(clients, target, ink, rest);
      case "click":
        return yield* clickPoint(clients, target, rest);
      case "chat":
        if (rest.length === 0) return yield* new UsageFailure({ problem: "chat takes TEXT" });
        yield* clients.chat(target, rest.join(" "));
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

const clientAction = (stateFilePath: string, watch: WatchOptions, doctor?: Command, signOut?: Command): Command => ([action, name, ...rest]) => {
  const args = [...(name === undefined ? [] : [name]), ...rest];
  switch (action) {
    case "start": return doctor === undefined ? undeclared("recovery") : serviceStart(stateFilePath, args, doctor, watch);
    case "stop": return serviceStop(stateFilePath, args);
    case "status": return serviceStatus(stateFilePath, args, watch);
    case "share": return shareInstalls(args);
    case "sign-out": return signOut === undefined ? undeclared("sign-out") : signOut(args);
    case "watch": return makeWatch(stateFilePath, watch)(args);
    case "doctor": return doctor === undefined ? undeclared("recovery") : serviceDoctor(stateFilePath, args, doctor);
    case "wait": return watchAction(stateFilePath, action, name, rest, watch);
    default: return inputAction(stateFilePath, watch, action, name, rest);
  }
};

const ACTION_FLAGS: Readonly<Record<string, readonly string[]>> = { watch: ["--once", "--json", "--record"], wait: ["--seconds"] };

const withoutClientsFile = (args: readonly string[]) =>
  args.filter((arg, index) => arg !== "--clients-file" && !arg.startsWith("--clients-file=") && args[index - 1] !== "--clients-file");

export const makeClient = (stateFilePath: string, watch: WatchOptions = {}, doctor?: Command, signOut?: Command): Command => (args) => {
  const [clientsFile] = flagValues(args, "clients-file");
  if ((args.includes("--clients-file") && clientsFile === undefined) || clientsFile === "") return Effect.fail(new UsageFailure({ problem: "--clients-file takes a FILE" }));
  const rest = withoutClientsFile(args);
  const [action = ""] = rest;
  const known = ACTION_FLAGS[action] ?? [];
  const unknownFlag = rest.find((arg) => arg.startsWith("--") && !known.includes(arg.split("=")[0]!));
  if (unknownFlag !== undefined) return Effect.fail(new UsageFailure({ problem: `client ${action} has no option ${unknownFlag}` }));
  return clientAction(clientsFile ?? stateFilePath, watch, doctor, signOut)(rest);
};
