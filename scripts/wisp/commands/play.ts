// `wisp play`: from the owner's desktop to a match of the game's declared
// playtest (wisp:docs/play.md). The game declares its prefix, Steam shortcut,
// map, match setup and helper; `layer` provides what its own steps use.
// Given `wisp watch`'s ClientWatch, play runs `doctor` on its prefix first
// and once after a failure (wisp:docs/doctor.md); play launches the game itself.
import { Effect, Layer } from "effect";
import { documentsFolder } from "../../warcraft/battleNet";
import { type Command, type CommandFailure, UsageFailure } from "../command";
import { DoctorHands, type DoctorTarget, doctor, withDoctor } from "../doctor";
import { type MenuFailure, type MenuSocket, leaveLobby, reportedMenus } from "../menus";
import { type PlayDeclaration, PlayProblem, leaveScoreScreen, play } from "../play";
import { type PlayTools, playHostLayer, playMachineLayer } from "../playHost";
import type { ClientWatch } from "../watch";

/** Leaves through the menus' socket; without a menu page that answers, the owner leaves by hand. */
const leaveBy = (port: number | undefined, what: string, leave: (menus: MenuSocket) => Effect.Effect<void, MenuFailure>) =>
  Effect.scoped(Effect.gen(function*() {
    const menus = yield* reportedMenus(port).pipe(Effect.catchTag("MenuFailure", () => Effect.void));
    if (menus === undefined) return yield* new PlayProblem({ problem: `Warcraft III shows ${what} from an earlier run and its menu page doesn't answer; leave it, then run play again` });
    yield* leave(menus).pipe(Effect.mapError((cause) => new PlayProblem({ problem: `couldn't leave ${what}: ${cause.message}` })));
  }));

export const makePlay = <R>(declaration: PlayDeclaration<R>, layer: Layer.Layer<R>, tools: Partial<PlayTools> = {}, watch?: Layer.Layer<ClientWatch, CommandFailure>): Command => (args) => {
  if (args.length > 0) return Effect.fail(new UsageFailure({ problem: "play takes no arguments" }));
  const print = (line: string) => console.log(line);
  const hosted = play(declaration, print).pipe(Effect.provide(Layer.merge(playHostLayer(declaration.display, tools), layer)));
  // With the watch, a crash or lost Battle.net stops play's map and match steps at once (wisp:docs/watch.md).
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
    // Warcraft III 3.0.0.24268 ignores the menus' ScoreScreenClose; Escape in its window leaves the score screen.
    closeScore: () => leaveScoreScreen(declaration).pipe(Effect.provide(playHostLayer(declaration.display, tools))),
  });
  // A watch beside play's own menu steps shares the report port through its kept address (wisp:docs/watch.md).
  const check = doctor([target], print).pipe(Effect.provide(Layer.mergeAll(playMachineLayer(tools), Layer.succeed(DoctorHands, hands), watch)));
  // Warcraft III 3.0 crashes in about one map start in three on this machine, with Smashcraft maps old and new alike (smashcraft#108), so play tries a few times.
  return withDoctor(check, print, run, { attempts: 4 });
};
