// What `doctor` does inside clients on private desktops (the clients file's
// run folders): leaving a lobby through the menus' socket, or its Back button
// without a menu page, the score screen with Escape, and the launcher's sign-in
// form with the client's account. Doctor launches Warcraft III itself, through
// the launcher's own --exec (wisp:scripts/wisp/doctor.ts).
import { Effect, Layer } from "effect";
import * as desktop from "../warcraft/desktop";
import { DoctorHands, type DoctorTarget } from "./doctor";
import { leaveLobby, reportedMenus } from "./menus";
import { PlayProblem } from "./play";

/** The Back button of a lobby, on the 2560x1440 client frame. */
const BACK = { x: 155, y: 1389 };

/** The empty fields' placeholders on Battle.net's sign-in pages (password page, 7 Oct). */
const PLACEHOLDERS = { username: /^(?:Email|E-mail|Phone)\b/i, password: /^Password$/ } as const;

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

  /**
   * One account field into the launcher's sign-in window: the account's
   * command prints it, its bytes go straight to xdotool's stdin, and a failure
   * names the command's exit, never its output.
   */
  const enterLoginOf = (target: DoctorTarget, field: "username" | "password") => Effect.gen(function*() {
    const command = target.account?.[field];
    if (command === undefined) return yield* new PlayProblem({ problem: "it declares no account to sign in with" });
    const title = (yield* windowsTitled(target, "Battle.net Login")).length > 0 ? "Battle.net Login" : "Battle.net";
    const login = yield* windowOf(target, title);
    const secret = yield* Effect.tryPromise({
      try: async () => {
        const reader = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
        const [bytes, code] = await Promise.all([new Response(reader.stdout).bytes(), reader.exited]);
        if (code !== 0) {
          bytes.fill(0);
          throw new Error(`its ${field} command (${command[0]}) exited ${code}`);
        }
        let end = bytes.length;
        while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end--;
        const value = bytes.slice(0, end);
        bytes.fill(0);
        if (value.length === 0) throw new Error(`its ${field} command printed nothing`);
        return value;
      },
      catch: (cause) => new PlayProblem({ problem: cause instanceof Error ? cause.message : `its ${field} command failed` }),
    });
    yield* desktop.enterLoginField(login, title, PLACEHOLDERS[field], secret).pipe(Effect.mapError(problem));
  });

  const windowsTitled = (target: DoctorTarget, title: string) => Effect.gen(function*() {
    const entry = config.clients.find((client) => client.name === target.client.name);
    if (entry === undefined) return [];
    const { x11 } = yield* desktop.desktopSession(entry).pipe(Effect.mapError(problem));
    return yield* desktop.findWindows(config.tools, entry.name, x11, title);
  });

  return DoctorHands.of({
    launches: true,
    leaveLobby: leaveLobbyOf,
    closeScore: closeScoreOf,
    enterLogin: enterLoginOf,
  });
}));
