// `doctor` against a simulated client: its prefix's processes (the shapes of
// clients A and B on 6 Oct), its launcher's log (recorded lines in
// fixtures/doctor), the watch's view and Play in the launcher are fakes. Each
// known bad state is recovered with its documented recovery, or stops with
// one plain line.
//
// fixtures/doctor (recorded, account ids replaced by zeros):
//   launcher-played.log            client A's launcher, 6 Oct: signed in, Play, Warcraft III running
//   launcher-connection-lost.log   client B's launcher, 3 Oct: signed in, then presence updates timing out
//   launcher-reconnected.log       the same launcher once restarted: its cached login, signed in again
//   launcher-login-rejected.log    written from smashcraft:docs/warcraft-authentication.md's record of
//                                  3 Oct (ERROR_TOKEN_NOT_FOUND (49), then LoginCredential); that log rotated
//   war3log-buffered-signed-in.txt client B's War3Log.txt, 6 Oct: written 3 s into a session that signed
//                                  in and played all evening, and nothing since
//   crash-report.txt               client A's Errors/…/Crash.txt of the 6 Oct menus run that crashed loading
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ProcessInfo, isErrorDialog, launcherHealth } from "../scripts/warcraft/battleNet";
import { ladderScan } from "../scripts/warcraft/war3Log";
import { DoctorHands, type DoctorTarget, diagnose, doctor, withDoctor } from "../scripts/wisp/doctor";
import { PlayMachine, PlayProblem } from "../scripts/wisp/play";
import { type ClientState, type ClientView, ClientWatch, type Source } from "../scripts/wisp/watch";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/doctor", name), "utf8");
const PLAYED = fixture("launcher-played.log");
const LOST = fixture("launcher-connection-lost.log");
const RECONNECTED = fixture("launcher-reconnected.log");
const REJECTED = fixture("launcher-login-rejected.log");
const SIGNED_IN = PLAYED.split("\n")[0]! + "\n";
const LAUNCH = PLAYED.split("\n").slice(1, 4).join("\n") + "\n";

const PREFIX = "/home/u/.local/share/wc3-melee/client-b/pfx";
const DOCUMENTS = `${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III`;
const LOGS = `${PREFIX}/drive_c/users/steamuser/AppData/Local/Battle.net/Logs`;
const WAR3LOG = `${DOCUMENTS}/Logs/War3Log.txt`;
const SERVER = "server-24-2e7a1c";
const START = ["env", "-i", "DISPLAY=:2", "steam-run", "proton", "waitforexitandrun", `${PREFIX}/drive_c/Program Files (x86)/Battle.net/Battle.net Launcher.exe`];
const target: DoctorTarget = { client: { name: "b", documents: DOCUMENTS, menuReportPort: 47123 }, prefix: PREFIX, display: ":2", start: { kind: "command", command: START } };

// Client B's processes on 6 Oct.
const env = { prefix: PREFIX, display: ":2" };
const wineserver = (pid: number): ProcessInfo => ({ pid, name: "wineserver", args: ["/steam/GE-Proton11-7-x86_64/files/bin/wineserver"], ...env, cwd: `/tmp/.wine-1000/${SERVER}` });
const launcherProcess = (pid: number): ProcessInfo => ({ pid, name: "CrBrowserMain", args: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.exe", "--from-launcher"], ...env });
const gameProcess = (pid: number): ProcessInfo => ({ pid, name: "Warcraft III.ex", args: ["C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\Warcraft III.exe", "-launch", "-uid", "w3"], ...env });
const errorDialog = (pid: number): ProcessInfo => ({ pid, name: "BlizzardError.e", args: ["C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\BlizzardError.exe"], ...env });

interface Scenario {
  readonly processes: "two runtimes" | "game" | "game and dialog" | "launcher" | "runtime alone";
  readonly launcherLog?: string;
  /** The watch's view while the first game runs. */
  readonly state?: ClientState;
  readonly source?: Source;
  /** What the game Play starts shows. */
  readonly afterPlay?: ClientState;
  /** The launcher log a restarted launcher writes. */
  readonly restartedLog?: string;
  readonly war3Log?: string;
  readonly noPlay?: boolean;
}

function world(scenario: Scenario) {
  const events: string[] = [];
  let processes: ProcessInfo[] = [
    ...(scenario.processes === "two runtimes" ? [wineserver(43614), wineserver(51022)] : [wineserver(43614)]),
    ...(scenario.processes === "runtime alone" ? [] : [launcherProcess(43924)]),
    ...(scenario.processes === "game" || scenario.processes === "game and dialog" ? [gameProcess(52713)] : []),
    ...(scenario.processes === "game and dialog" ? [errorDialog(52990)] : []),
  ];
  const files = new Map<string, string>([[`${LOGS}/battle.net-20261006T085733.941623.log`, scenario.launcherLog ?? SIGNED_IN], [WAR3LOG, scenario.war3Log ?? ""]]);
  let state: ClientState = scenario.state ?? { kind: "menus", screen: "MAIN_MENU" };
  let source: Source = scenario.source ?? "socket";
  let plays = 0;
  const newestLog = () => [...files.keys()].filter((path) => path.startsWith(LOGS)).sort().at(-1)!;

  const machine = PlayMachine.of({
    processes: Effect.sync(() => processes),
    serverDirectory: () => Effect.succeed(SERVER),
    signal: (pids, signal) => Effect.sync(() => {
      events.push(`${signal} ${pids.join(" ")}`);
      processes = processes.filter((process) => !pids.includes(process.pid));
    }),
    openSteam: () => Effect.die("doctor opened Steam for a client started by its command"),
    start: (command) => Effect.sync(() => {
      events.push(`start ${command.at(-1)}`);
      processes = [...processes, wineserver(60001), launcherProcess(60002)];
      files.set(`${LOGS}/battle.net-20261006T220000.000000.log`, scenario.restartedLog ?? SIGNED_IN);
      return 60000;
    }),
    read: (path, from = 0) => Effect.sync(() => files.get(path)?.slice(from)),
    size: (path) => Effect.sync(() => files.get(path)?.length),
    digest: () => Effect.die("unused"),
    list: (directory) => Effect.sync(() => [...files.keys()].filter((path) => path.startsWith(`${directory}/`)).map((path) => path.slice(directory.length + 1))),
    append: () => Effect.die("unused"),
    write: () => Effect.die("unused"),
    copy: () => Effect.die("unused"),
  });

  const view = (state: ClientState): ClientView => ({ client: "b", state, source, evidence: state.kind === "menus" ? "SetGlueScreen" : "fake", at: 0, scan: "done", loadErrors: { count: 0 } });
  const watch = ClientWatch.of({ view: () => Effect.sync(() => view(state)) });

  const hands = DoctorHands.of({
    ...(scenario.noPlay === true ? {} : {
      pressPlay: () => Effect.sync(() => {
        plays++;
        events.push("play");
        files.set(newestLog(), files.get(newestLog())! + LAUNCH);
        processes = [...processes, gameProcess(70000 + plays)];
        state = scenario.afterPlay ?? { kind: "menus", screen: "MAIN_MENU" };
        source = "socket";
      }),
    }),
    leaveLobby: () => Effect.sync(() => {
      events.push("leave lobby");
      state = { kind: "menus", screen: "CUSTOM_GAMES" };
    }),
    closeScore: () => Effect.sync(() => {
      events.push("close score");
      state = { kind: "menus", screen: "CUSTOM_GAMES" };
    }),
  });

  const layer = Layer.mergeAll(Layer.succeed(PlayMachine, machine), Layer.succeed(ClientWatch, watch), Layer.succeed(DoctorHands, hands));
  const finish = async <A, E>(program: Effect.Effect<A, E, PlayMachine | ClientWatch | DoctorHands>) => {
    const exit = await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(program.pipe(Effect.provide(layer)));
      for (let step = 0; step < 2000 && fiber.pollUnsafe() === undefined; step++) {
        yield* Effect.yieldNow;
        yield* TestClock.adjust("500 millis");
      }
      return fiber.pollUnsafe();
    }).pipe(Effect.provide(TestClock.layer())));
    if (exit === undefined) throw new Error("doctor did not finish within 1000 simulated seconds");
    const error = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
    if (Exit.isFailure(exit) && Option.isNone(error)) throw new Error(Cause.pretty(exit.cause));
    return { failure: Option.isSome(error) ? (error.value as { readonly message: string }).message : undefined, value: Exit.isSuccess(exit) ? exit.value : undefined };
  };
  const run = async () => {
    const lines: string[] = [];
    const { failure } = await finish(doctor([target], (line) => lines.push(line)));
    return { lines, failure, events };
  };
  const drop = (next: ClientState) => {
    state = next;
  };
  return { run, finish, events, drop };
}

test("recorded launcher logs: signed in, a lost connection, a reconnect, a rejected saved login", () => {
  expect(launcherHealth(PLAYED)).toEqual({ kind: "signed in" });
  expect(launcherHealth(LOST)).toEqual({ kind: "connection failing", reason: "its last 3 presence updates timed out (ERROR_RPC_REQUEST_TIMED_OUT)" });
  // One timeout is a blip; a sign-in after the timeouts is a reconnect.
  expect(launcherHealth(LOST.split("\n").slice(0, 3).join("\n")).kind).toBe("signed in");
  expect(launcherHealth(RECONNECTED)).toEqual({ kind: "signed in" });
  expect(launcherHealth(REJECTED).kind).toBe("sign-in needed");
  expect(launcherHealth(REJECTED.split("\n")[0]!)).toEqual({ kind: "not signed in" });
  // The catalog's "DisableLoginCredentialUIRegionList" in every launcher's log is no sign-in form.
  expect(launcherHealth(`${SIGNED_IN}D 2026-10-06 12:33:38.741703 [CatalogVarStorage] {Main} Setting var from catalog Client.DisableLoginCredentialUIRegionList=CN\n`).kind).toBe("signed in");
});

test("the crash dialog is Warcraft III's BlizzardError.exe, not the launcher's copy", () => {
  const crash = fixture("crash-report.txt");
  expect(crash).toContain("\\_retail_\\x86_64\\Warcraft III.exe");
  expect(isErrorDialog(errorDialog(1))).toBe(true);
  expect(isErrorDialog({ ...errorDialog(1), args: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.17896\\BlizzardError.exe"] })).toBe(false);
  expect(isErrorDialog(gameProcess(1))).toBe(false);
});

test("disconnected: ends Warcraft III and presses Play in the signed-in launcher", async () => {
  const { lines, failure, events } = await world({ processes: "game", state: { kind: "disconnected", reason: "Battle.net connection lost" } }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["SIGTERM 52713", "play"]);
  expect(lines).toContain("b: disconnected: Battle.net connection lost (socket: fake); ending Warcraft III");
  expect(lines).toContain("b: Play started Warcraft III (pid 70001)");
  expect(lines.at(-1)).toBe("b: ready: menus (MAIN_MENU), after disconnected, no game");
});

test("empty login shell: a login screen held 120 s by the menus is relaunched with Play", async () => {
  const { lines, failure, events } = await world({ processes: "game", state: { kind: "menus", screen: "LOGIN_DOORS" } }).run();
  expect(failure).toBeUndefined();
  expect(lines[0]).toBe("b: Warcraft III at LOGIN_DOORS...");
  expect(lines.some((line) => line.startsWith("b: empty login shell: Warcraft III has shown LOGIN_DOORS for 12"))).toBe(true);
  expect(events).toEqual(["SIGTERM 52713", "play"]);
});

test("a log that shows no sign-in, with no menu report, is left alone: War3Log.txt is written in bursts", async () => {
  const war3Log = fixture("war3log-buffered-signed-in.txt");
  expect(ladderScan(war3Log).kind).toBe("signing in");
  const { lines, failure, events } = await world({ processes: "game", state: { kind: "signing in" }, source: "log", war3Log }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual([]);
  expect(lines.at(-1)).toStartWith("b: ready: signing in by its log only");
});

test("crashed with the error dialog up: closes the dialog and the game, then Play", async () => {
  const { lines, failure, events } = await world({ processes: "game and dialog", state: { kind: "crashed", reason: "Crash.txt: ACCESS_VIOLATION" } }).run();
  expect(failure).toBeUndefined();
  expect(lines).toContain("b: crashed: Warcraft III's error dialog is up (BlizzardError.exe pid 52990); closing the error dialog and Warcraft III");
  expect(events).toEqual(["SIGTERM 52713 52990", "play"]);
});

test("stale lobby: leaves it through the menus; the score screen likewise", async () => {
  const lobby = await world({ processes: "game", state: { kind: "lobby", host: true, map: "Smashcraft 0.0.49" } }).run();
  expect(lobby.failure).toBeUndefined();
  expect(lobby.events).toEqual(["leave lobby"]);
  expect(lobby.lines.at(-1)).toBe("b: ready: menus (CUSTOM_GAMES), after stale lobby");
  const results = await world({ processes: "game", state: { kind: "results" } }).run();
  expect(results.events).toEqual(["close score"]);
});

test("stuck loading: 120 s on the loading screen ends the game and presses Play", async () => {
  const { lines, failure, events } = await world({ processes: "game", state: { kind: "loading", map: "Smashcraft 0.0.49" } }).run();
  expect(failure).toBeUndefined();
  expect(lines[0]).toBe("b: Warcraft III loading a map...");
  expect(lines.some((line) => line.startsWith("b: stuck loading: Warcraft III has been loading Smashcraft 0.0.49 for 12"))).toBe(true);
  expect(events).toEqual(["SIGTERM 52713", "play"]);
});

test("two runtimes on one prefix: ends every program, starts Battle.net alone with its command, Play", async () => {
  const { lines, failure, events } = await world({ processes: "two runtimes" }).run();
  expect(failure).toBeUndefined();
  expect(lines[0]).toStartWith("b: two runtimes: 2 Wine runtimes use the prefix (wineserver pids 43614 51022)");
  expect(events).toEqual(["SIGTERM 43614 51022 43924", "start " + START.at(-1), "play"]);
  expect(lines.at(-1)).toBe("b: ready: menus (MAIN_MENU), after two runtimes, closed, no game");
});

test("a launcher whose connection is failing is restarted before Play; a rejected login stops with one line", async () => {
  const lost = await world({ processes: "launcher", launcherLog: LOST, restartedLog: RECONNECTED }).run();
  expect(lost.failure).toBeUndefined();
  expect(lost.events).toEqual(["SIGTERM 43614 43924", "start " + START.at(-1), "play"]);
  const rejected = await world({ processes: "launcher", launcherLog: REJECTED }).run();
  expect(rejected.events).toEqual([]);
  expect(rejected.failure).toBe("b: Battle.net rejected its saved login (ERROR_TOKEN_NOT_FOUND); it needs its owner to sign in to Battle.net: sign in in its launcher on display :2 with \"Keep me logged in\" ticked, then run doctor again");
  // A restart that lands on the sign-in form is the same one line, after its 90 s.
  const form = await world({ processes: "launcher", launcherLog: LOST, restartedLog: REJECTED.split("\n")[0]! }).run();
  expect(form.failure).toStartWith("b: Battle.net hasn't signed in after 9");
  expect(form.failure?.split("\n")).toHaveLength(1);
});

test("a state that comes back after its recovery stops doctor instead of looping", async () => {
  const { failure, events } = await world({ processes: "game", state: { kind: "disconnected", reason: "logged out" }, afterPlay: { kind: "disconnected", reason: "logged out" } }).run();
  expect(events).toEqual(["SIGTERM 52713", "play"]);
  expect(failure).toBe("b: still disconnected after ending Warcraft III once (logged out (socket: fake))");
});

test("without Play (for `play`, which presses it): a crashed client is cleared to its signed-in launcher", async () => {
  const { lines, failure, events } = await world({ processes: "game and dialog", state: { kind: "crashed", reason: "exited" }, noPlay: true }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["SIGTERM 52713 52990"]);
  expect(lines.at(-1)).toBe("b: ready: Battle.net signed in, after crashed");
});

test("a runtime left without Battle.net is ended after 20 s, then Battle.net starts", async () => {
  const { failure, events } = await world({ processes: "runtime alone" }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["SIGTERM 43614", "start " + START.at(-1), "play"]);
});

test("withDoctor: a run that fails gets one more try after doctor recovers something; otherwise its failure stands", async () => {
  let runs = 0;
  const flaky = Effect.suspend(() => (++runs === 1 ? Effect.fail(new PlayProblem({ problem: "B dropped from Battle.net" })) : Effect.succeed("match")));
  // Healthy before and after: the failure was the run's own, so it stands without another try.
  const recovering = world({ processes: "game" });
  const result = await recovering.finish(withDoctor(doctor([target], () => {}), () => {}, flaky));
  expect(result.value).toBeUndefined();
  expect(result.failure).toBe("B dropped from Battle.net");
  expect(runs).toBe(1);
  runs = 0;
  // Healthy before the run; the run fails because the client dropped, which the doctor after it recovers.
  const dropping = world({ processes: "game" });
  const failsOnce = Effect.suspend(() => {
    if (++runs > 1) return Effect.succeed("match");
    dropping.drop({ kind: "disconnected", reason: "logged out" });
    return Effect.fail(new PlayProblem({ problem: "B dropped" }));
  });
  const lines: string[] = [];
  const retried = await dropping.finish(withDoctor(doctor([target], (line) => lines.push(line)), (line) => lines.push(line), failsOnce));
  expect(retried.value).toBe("match");
  expect(runs).toBe(2);
  expect(lines).toContain("failed: B dropped; running doctor once");
  expect(dropping.events).toEqual(["SIGTERM 52713", "play"]);
});

test("diagnose orders the prefix before the game, and the game before the launcher", () => {
  const use = { runtimes: [wineserver(1), wineserver(2)], processes: [wineserver(1), wineserver(2), gameProcess(3)], game: gameProcess(3) };
  const view: ClientView = { client: "b", state: { kind: "disconnected", reason: "x" }, source: "socket", evidence: "", at: 0, scan: "done", loadErrors: { count: 0 } };
  expect(diagnose({ use, view, held: 0 }, true)).toMatchObject({ kind: "problem", problem: "two runtimes" });
  expect(diagnose({ use: { ...use, runtimes: [wineserver(1)] }, view, held: 0 }, true)).toMatchObject({ kind: "problem", problem: "disconnected" });
  expect(diagnose({ use: { ...use, runtimes: [wineserver(1)] }, view: { ...view, state: { kind: "in match" }, loadErrors: { count: 326, first: "war3mapImported/ImpactHit.mdx" } }, held: 0 }, true))
    .toMatchObject({ kind: "problem", problem: "map without its imports" });
  expect(diagnose({ use: { ...use, runtimes: [wineserver(1)] }, held: 0, unknown: "no menu page" }, true)).toMatchObject({ kind: "stop" });
});
