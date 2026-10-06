// What `doctor` does inside clients on private desktops (the clients file's
// run folders): leaving a lobby or score screen through the menus' socket, or
// their Back button without a menu page. Doctor launches Warcraft III itself,
// through the launcher's own --exec (wisp:scripts/wisp/doctor.ts).
import { Effect, Layer } from "effect";
import * as desktop from "../warcraft/desktop";
import { DoctorHands, type DoctorTarget } from "./doctor";
import { BACK } from "./lobby";
import { leaveLobby, reportedMenus } from "./menus";
import { PlayProblem } from "./play";

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

  /** Through the menus' socket when the client's page reports, else their Back button (a lobby and the score screen share it). */
  const leave = (target: DoctorTarget, socket: "lobby" | "score") => Effect.scoped(Effect.gen(function*() {
    // Without a menu page that answers, the Back button leaves both.
    const menus = yield* reportedMenus(target.client.menuReportPort).pipe(Effect.catchTag("MenuFailure", () => Effect.void));
    if (menus !== undefined) {
      if (socket === "lobby") return yield* leaveLobby(menus);
      return yield* menus.send("ScoreScreenClose");
    }
    const game = yield* windowOf(target, "Warcraft III");
    yield* desktop.click(game, BACK.x, BACK.y);
  })).pipe(Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : problem(cause))));

  return DoctorHands.of({
    launches: true,
    leaveLobby: (target) => leave(target, "lobby"),
    closeScore: (target) => leave(target, "score"),
  });
}));
