// What `doctor` does inside clients on private desktops (the clients file's
// run folders): leaving a lobby through the menus' socket, or its Back button
// without a menu page, and the score screen with Escape. Doctor launches Warcraft III itself,
// through the launcher's own --exec (wisp:scripts/wisp/doctor.ts).
import { Effect, Layer } from "effect";
import * as desktop from "../warcraft/desktop";
import { DoctorHands, type DoctorTarget } from "./doctor";
import { leaveLobby, reportedMenus } from "./menus";
import { PlayProblem } from "./play";

/** The Back button of a lobby, on the 2560x1440 client frame. */
const BACK = { x: 155, y: 1389 };

const problem = (cause: { readonly message: string }) => new PlayProblem({ problem: cause.message });

/** DoctorHands for the clients of a clients file, each on its own private desktop. */
export const privateDoctorHands = (clientsFile: string) => Layer.effect(DoctorHands, Effect.gen(function*() {
  const config = yield* desktop.readClientsFile(clientsFile).pipe(Effect.mapError(problem));

  /** The client's desktop, addressed at its window titled `title`. */
  const windowOf = (target: DoctorTarget, title: string) => Effect.gen(function*() {
    const entry = config.clients.find((client) => client.name === target.client.name);
    if (entry === undefined) return yield* new PlayProblem({ problem: `${target.client.name} isn't in ${clientsFile}` });
    const { x11, wayland } = yield* desktop.desktopSession(entry);
    const [window] = yield* desktop.findWindows(config.tools, entry.name, x11, title);
    if (window === undefined) return yield* new PlayProblem({ problem: `no "${title}" window on ${entry.name}'s display ${x11.DISPLAY}` });
    return { name: entry.name, documents: entry.documents, tools: config.tools, x11, wayland, window } satisfies desktop.Client;
  }).pipe(Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : problem(cause))));

  /** A lobby through the menus' socket when the client's page reports, else its Back button. */
  const leaveLobbyOf = (target: DoctorTarget) => Effect.scoped(Effect.gen(function*() {
    const menus = yield* reportedMenus(target.client.menuReportPort).pipe(Effect.catchTag("MenuFailure", () => Effect.void));
    if (menus !== undefined) return yield* leaveLobby(menus);
    const game = yield* windowOf(target, "Warcraft III");
    yield* desktop.click(game, BACK.x, BACK.y);
  })).pipe(Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : problem(cause))));

  // Warcraft III 3.0.0.24268 ignores the menus' ScoreScreenClose and moved the score screen's Back to its top left; Escape leaves it (client B, 7 Oct 2026).
  const closeScoreOf = (target: DoctorTarget) => Effect.gen(function*() {
    const game = yield* windowOf(target, "Warcraft III");
    yield* desktop.keys(game, "Escape");
  }).pipe(Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : problem(cause))));

  return DoctorHands.of({
    launches: true,
    leaveLobby: leaveLobbyOf,
    closeScore: closeScoreOf,
  });
}));
