




import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { Platform } from "../platform/services";
import * as desktop from "../warcraft/desktop";
import { DoctorHands, type DoctorTarget } from "./doctor";
import { collect } from "./hostProcess";
import { leaveLobby, reportedMenus } from "./menus";
import { PlayProblem } from "./play";
import { detectBuild, executableIn } from "./buildHost";
import { requireCapability } from "./builds";








const PLACEHOLDERS = { username: undefined, password: /^Password$/ } as const;

const problem = (cause: { readonly message: string }) => new PlayProblem({ problem: cause.message });


export const privateDoctorHands = (clientsFile: string) => Layer.effect(DoctorHands, Effect.gen(function*() {
  const config = yield* desktop.readClientsFile(clientsFile).pipe(Effect.mapError(problem));
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* Effect.context<Platform>();


  const windowOf = (target: DoctorTarget, title: string) => Effect.gen(function*() {
    const entry = config.clients.find((client) => client.name === target.client.name);
    if (entry === undefined) return yield* new PlayProblem({ problem: `${target.client.name} isn't in ${clientsFile}` });
    const [window] = yield* desktop.windowsOf(config, entry, title);
    if (window === undefined) return yield* new PlayProblem({ problem: `no "${title}" window on ${entry.name}'s display ${yield* desktop.displayOf(entry)}` });
    return window;
  }).pipe(Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : problem(cause))));


  const leaveLobbyOf = (target: DoctorTarget) => Effect.scoped(Effect.gen(function*() {
    const menus = yield* reportedMenus(target.client.menuReportPort).pipe(Effect.catchTag("MenuFailure", () => Effect.void));
    if (menus !== undefined) return yield* leaveLobby(menus);
    const game = yield* windowOf(target, "Warcraft III");
    const profile = yield* requireCapability(yield* detectBuild(executableIn(target.prefix)), "menuDriving");
    yield* desktop.click(game, profile.menus.lobbyBack.x, profile.menus.lobbyBack.y);
  })).pipe(Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : problem(cause))));


  const closeScoreOf = (target: DoctorTarget) => Effect.scoped(Effect.gen(function*() {
    const game = yield* windowOf(target, "Warcraft III");
    const profile = yield* requireCapability(yield* detectBuild(executableIn(target.prefix)), "menuDriving");
    if (profile.menus.scoreClose === "Escape") yield* desktop.keys(game, "Escape");
    else {
      const menus = yield* reportedMenus(target.client.menuReportPort);
      if (menus === undefined) return yield* new PlayProblem({ problem: "the score screen's menu page isn't reporting" });
      yield* menus.send(profile.menus.scoreClose);
    }
  })).pipe(Effect.mapError((cause) => (cause instanceof PlayProblem ? cause : problem(cause))));






  const enterLoginOf = (target: DoctorTarget, field: "username" | "password") => Effect.gen(function*() {
    const command = target.account?.[field];
    if (command === undefined) return yield* new PlayProblem({ problem: "it declares no account to sign in with" });
    const title = (yield* windowsTitled(target, "Battle.net Login")).length > 0 ? "Battle.net Login" : "Battle.net";
    const login = yield* windowOf(target, title);
    const printed = yield* collect(ChildProcess.make(command[0]!, command.slice(1), { stdin: "ignore", stderr: "ignore" })).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.mapError(() => new PlayProblem({ problem: `its ${field} command (${command[0]}) couldn't run` })),
    );
    const bytes = printed.stdout;
    if (printed.exitCode !== 0) {
      bytes.fill(0);
      return yield* new PlayProblem({ problem: `its ${field} command (${command[0]}) exited ${printed.exitCode}` });
    }
    let end = bytes.length;
    while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end--;
    const secret = bytes.slice(0, end);
    bytes.fill(0);
    if (secret.length === 0) return yield* new PlayProblem({ problem: `its ${field} command printed nothing` });
    yield* desktop.enterLoginField(login, title, PLACEHOLDERS[field], secret).pipe(Effect.mapError(problem));
  });

  const windowsTitled = (target: DoctorTarget, title: string) => Effect.gen(function*() {
    const entry = config.clients.find((client) => client.name === target.client.name);
    if (entry === undefined) return [];
    return yield* desktop.windowsOf(config, entry, title).pipe(Effect.mapError(problem));
  });

  return DoctorHands.of({
    launches: true,
    leaveLobby: (target) => leaveLobbyOf(target).pipe(Effect.provideContext(platform)),
    closeScore: (target) => closeScoreOf(target).pipe(Effect.provideContext(platform)),
    enterLogin: (target, field) => enterLoginOf(target, field).pipe(Effect.provideContext(platform)),
  });
})).pipe(Layer.provide(BunServices.layer));
