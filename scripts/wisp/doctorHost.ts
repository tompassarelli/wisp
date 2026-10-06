// What `doctor` does inside clients on private desktops (the clients file's
// run folders): Play in the client's Battle.net window, found by the text it
// shows as `play` finds it, and leaving a lobby or score screen through the
// menus' socket, or their Back button without a menu page.
import { Clock, Effect, Layer } from "effect";
import * as desktop from "../warcraft/desktop";
import { DoctorHands, type DoctorTarget } from "./doctor";
import { BACK } from "./lobby";
import { leaveLobby, reportedMenus } from "./menus";
import { PlayProblem, type Screen, findPhrase, gridLabel, tileArt, topmost, warcraftPlay } from "./play";

const problem = (cause: { readonly message: string }) => new PlayProblem({ problem: cause.message });

/** Two reads of one control: within 6 px. */
const samePlace = (a: { readonly x: number; readonly y: number }, b: { readonly x: number; readonly y: number }) => Math.abs(a.x - b.x) <= 6 && Math.abs(a.y - b.y) <= 6;

/** Polls `observe` every 250 ms until it gives a value, or undefined after `seconds`. */
const poll = <A, E>(seconds: number, observe: Effect.Effect<A | undefined, E>) => Effect.gen(function*() {
  const deadline = (yield* Clock.currentTimeMillis) + seconds * 1000;
  while (true) {
    const value = yield* observe;
    if (value !== undefined || (yield* Clock.currentTimeMillis) >= deadline) return value;
    yield* Effect.sleep("250 millis");
  }
});

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

  const pressPlay = (target: DoctorTarget) => Effect.gen(function*() {
    const launcher = yield* windowOf(target, "Battle.net");
    yield* desktop.focusWindow(launcher, "Battle.net");
    // Labels read as light text; Play is white on its blue button. Frame pixels are the X root's on a private desktop.
    const page = Effect.gen(function*() {
      const frame = yield* desktop.capture(launcher);
      const screen = (words: readonly desktop.Word[]): Screen => ({ width: frame.width, height: frame.height, words });
      return { light: screen(yield* desktop.frameWords(launcher, frame, "light")), white: screen(yield* desktop.frameWords(launcher, frame, "white")) };
    });
    const click = (place: { readonly x: number; readonly y: number }) => desktop.focusWindow(launcher, "Battle.net").pipe(Effect.andThen(desktop.pressAt(launcher, place.x, place.y)));
    let seen = yield* page;
    // Battle.net opens on the game it last showed or features; its Games tab lists Warcraft III.
    if (warcraftPlay(seen) === undefined) {
      const games = topmost(findPhrase(seen.light.words, "Games"));
      if (games === undefined) return yield* new PlayProblem({ problem: "Battle.net's window shows neither its Games tab nor Warcraft III's Play button" });
      yield* click(games);
      let last: { readonly x: number; readonly y: number } | undefined;
      const listed = yield* poll(20, page.pipe(Effect.map((now) => {
        const label = gridLabel(now.light.words);
        const previous = last;
        last = label;
        return label !== undefined && previous !== undefined && samePlace(label, previous) ? now : undefined;
      })));
      if (listed === undefined) return yield* new PlayProblem({ problem: "Battle.net's Games tab doesn't list Warcraft III with its install state" });
      const tile = tileArt(listed.light.words, gridLabel(listed.light.words)!);
      const opened = page.pipe(Effect.map((now) => (warcraftPlay(now) !== undefined ? now : undefined)));
      yield* click(tile.first);
      let shown = yield* poll(6, opened);
      if (shown === undefined) {
        yield* click(tile.retry);
        shown = yield* poll(20, opened);
      }
      if (shown === undefined) return yield* new PlayProblem({ problem: "Battle.net didn't show Warcraft III's Play after two clicks on its Games tile; if it is installing or updating, let it finish" });
      seen = shown;
    }
    yield* click(warcraftPlay(seen)!);
  }).pipe(Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : problem(cause))));

  /** Through the menus' socket when the client's page reports, else their Back button (a lobby and the score screen share it). */
  const leave = (target: DoctorTarget, socket: "lobby" | "score") => Effect.scoped(Effect.gen(function*() {
    // A watch in this process may already hold the report port; then Back it is.
    const menus = yield* reportedMenus(target.client.menuReportPort).pipe(Effect.catchTag("MenuFailure", () => Effect.void));
    if (menus !== undefined) {
      if (socket === "lobby") return yield* leaveLobby(menus);
      return yield* menus.send("ScoreScreenClose");
    }
    const game = yield* windowOf(target, "Warcraft III");
    yield* desktop.click(game, BACK.x, BACK.y);
  })).pipe(Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : problem(cause))));

  return DoctorHands.of({
    pressPlay,
    leaveLobby: (target) => leave(target, "lobby"),
    closeScore: (target) => leave(target, "score"),
  });
}));
