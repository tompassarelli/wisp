import { basename, resolve } from "node:path";
import { Effect, Layer } from "effect";
import { documentsFolder } from "../os/warcraft/battleNet";
import { type Command, type CommandFailure, UsageFailure } from "../cli/command";
import { DoctorHands, type DoctorTarget, doctor, withDoctor } from "../doctor/doctor";
import { type MenuFailure, type MenuSocket, leaveLobby, reportedMenus } from "../play/menus";
import { type PlayDeclaration, PlayProblem, leaveScoreScreen, play } from "../play/play";
import { type PlayTools, playHostLayer, playMachineLayer } from "../os/platform/play";
import type { ClientWatch } from "../dev/watch";

const leaveBy = (port: number | undefined, what: string, leave: (menus: MenuSocket) => Effect.Effect<void, MenuFailure>) =>
  Effect.scoped(Effect.gen(function*() {
    const menus = yield* reportedMenus(port).pipe(Effect.catchTag("MenuFailure", () => Effect.void));
    if (menus === undefined) return yield* new PlayProblem({ problem: `Warcraft III shows ${what} from an earlier run and its menu page doesn't answer; leave it, then run play again` });
    yield* leave(menus).pipe(Effect.mapError((cause) => new PlayProblem({ problem: `couldn't leave ${what}: ${cause.message}` })));
  }));

export const makePlay = <R>(declaration: PlayDeclaration<R>, layer: Layer.Layer<R>, tools: Partial<PlayTools> = {}, watch?: Layer.Layer<ClientWatch, CommandFailure>): Command => (args) => {
  const lobbyOnly = args.includes("--lobby-only");
  const objects = args.filter((arg) => arg !== "--lobby-only");
  const requested = objects[0];
  if (objects.length > 1 || (requested !== undefined && (!lobbyOnly || !/\.w3x$/i.test(requested))) || objects.some((arg) => arg.startsWith("--"))) return Effect.fail(new UsageFailure({ problem: "use play [--lobby-only [MAP.w3x]]" }));
  const selected = requested === undefined ? declaration : { ...declaration, map: { ...declaration.map, file: basename(requested), title: basename(requested, ".w3x"), source: resolve(requested) } };
  const print = (line: string) => console.log(line);
  const hosted = play(selected, print, { lobbyOnly }).pipe(Effect.provide(Layer.merge(playHostLayer(declaration.display, tools), layer)));

  const run = watch === undefined ? hosted : hosted.pipe(Effect.provide(watch));
  if (watch === undefined) return hosted;
  const { prefix, shortcut, menuReportPort } = declaration;
  const target: DoctorTarget = {
    client: { name: "Warcraft III", documents: documentsFolder(prefix), ...(menuReportPort === undefined ? {} : { menuReportPort }) },
    prefix,
    display: declaration.display,
    start: { kind: "steam", appId: shortcut.appId, name: shortcut.name },
  };
  const hands = DoctorHands.of({
    launches: false,
    leaveLobby: () => leaveBy(menuReportPort, "a lobby", leaveLobby),

    closeScore: () => leaveScoreScreen(declaration).pipe(Effect.provide(playHostLayer(declaration.display, tools))),
  });

  const check = doctor([target], print).pipe(Effect.provide(Layer.mergeAll(playMachineLayer(tools), Layer.succeed(DoctorHands, hands), watch)));

  if (lobbyOnly) return run;
  return withDoctor(check, print, run, { attempts: 4 });
};
