// `doctor` against a simulated client: its prefix's processes (the shapes of
// clients A and B on 6 Oct), its launcher's log (recorded lines in
// fixtures/doctor), the watch's view and the launcher's launch are fakes. Each
// known bad state is recovered with its documented recovery, or stops with
// one plain line.
//
// fixtures/doctor (recorded, account ids replaced by zeros):
//   launcher-played.log            client A's launcher, 6 Oct: signed in, Play, Warcraft III running
//   launcher-connection-lost.log   client B's launcher, 3 Oct: signed in, then presence updates timing out
//   launcher-reconnected.log       the same launcher once restarted: its cached login, signed in again
//   launcher-signed-in-by-hand.log client A's launcher, 6 Oct: its UnifiedAuth account page, password page and sign-in
//   launcher-login-rejected.log    written from smashcraft:docs/warcraft-authentication.md's record of
//                                  3 Oct (ERROR_TOKEN_NOT_FOUND (49), then LoginCredential); that log rotated
//   war3log-buffered-signed-in.txt client B's War3Log.txt, 6 Oct: written 3 s into a session that signed
//                                  in and played all evening, and nothing since
//   ../preferences/*.txt           client A's War3Preferences.txt of 6 Oct, trimmed (private-desktop.txt),
//                                  and the same with the display values a main-display run writes (main-display.txt;
//                                  those values are constructed from the 6 Oct report, not recorded)
//   crash-report.txt               client A's Errors/…/Crash.txt of the 6 Oct menus run that crashed loading
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ProcessInfo, isErrorDialog, launcherHealth } from "../scripts/warcraft/battleNet";
import { ladderScan } from "../scripts/warcraft/war3Log";
import { displayChanges, videoSettings, withDisplaySettings } from "../scripts/warcraft/preferences";
import { DoctorHands, type DoctorTarget, doctor, withDoctor } from "../scripts/wisp/doctor";
import { PlayMachine, PlayProblem } from "../scripts/wisp/play";
import { type ClientState, type ClientView, ClientWatch, type Source } from "../scripts/wisp/watch";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/doctor", name), "utf8");
const PLAYED = fixture("launcher-played.log");
const LOST = fixture("launcher-connection-lost.log");
const RECONNECTED = fixture("launcher-reconnected.log");
const REJECTED = fixture("launcher-login-rejected.log");
const BY_HAND = fixture("launcher-signed-in-by-hand.log").split("\n");
/** The launcher's log up to its account page, then up to its password page, then signed in. */
const ACCOUNT_PAGE = BY_HAND.slice(0, 5).join("\n") + "\n";
const PASSWORD_PAGE = BY_HAND.slice(5, 13).join("\n") + "\n";
const SIGNED_IN_BY_FORM = BY_HAND.slice(13).join("\n");
const SIGNED_IN = PLAYED.split("\n")[0]! + "\n";
const LAUNCH = PLAYED.split("\n").slice(1, 4).join("\n") + "\n";

const PREFIX = "/home/u/.local/share/wc3-melee/client-b/pfx";
const DOCUMENTS = `${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III`;
const LOGS = `${PREFIX}/drive_c/users/steamuser/AppData/Local/Battle.net/Logs`;
const WAR3LOG = `${DOCUMENTS}/Logs/War3Log.txt`;
const PREFERENCES = `${DOCUMENTS}/War3Preferences.txt`;
const preferences = (name: string) => readFileSync(join(import.meta.dir, "fixtures/preferences", name), "utf8");
const PRIVATE = preferences("private-desktop.txt");
const MAIN = preferences("main-display.txt");
const DISPLAY = Object.fromEntries(["windowmode", "windowwidth", "windowheight", "windowx", "windowy", "reswidth", "resheight", "refreshrate", "maxfps"].map((key) => [key, videoSettings(PRIVATE)[key]!]));
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
  readonly execRequestLog?: boolean;
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
  /** War3Preferences.txt as the client finds it; the client declares DISPLAY settings when set. */
  readonly preferences?: string;
  /** Views the started game reports as `afterPlay` before its menus report MAIN_MENU. */
  readonly settlesAfter?: number;
  /** Escape presses the score screen takes to leave (1 by default); Infinity never leaves. */
  readonly scoreEscapes?: number;
  /** The client declares an account and doctor has hands to type it; "stuck" leaves the form where it is. */
  readonly signsIn?: "works" | "stuck";
  /** The prefix was copied from another install: that install's signed-in log is there, written before this launcher started. */
  readonly copiedLog?: boolean;
}

/** When the launcher of a copied prefix started, and when the copied install last wrote its log. */
const LAUNCHER_STARTED = Date.parse("2026-10-08T02:19:57Z");
const COPIED_LOG = `${LOGS}/battle.net-20261005T231502.118204.log`;

function world(scenario: Scenario) {
  const events: string[] = [];
  let processes: ProcessInfo[] = [
    ...(scenario.processes === "two runtimes" ? [wineserver(43614), wineserver(51022)] : [wineserver(43614)]),
    ...(scenario.processes === "runtime alone" ? [] : [scenario.copiedLog ? { ...launcherProcess(43924), started: LAUNCHER_STARTED } : launcherProcess(43924)]),
    ...(scenario.processes === "game" || scenario.processes === "game and dialog" ? [gameProcess(52713)] : []),
    ...(scenario.processes === "game and dialog" ? [errorDialog(52990)] : []),
  ];
  const files = new Map<string, string>([[`${LOGS}/battle.net-20261006T085733.941623.log`, scenario.launcherLog ?? SIGNED_IN], [WAR3LOG, scenario.war3Log ?? ""], ...(scenario.preferences === undefined ? [] : [[PREFERENCES, scenario.preferences] as [string, string]])]);
  if (scenario.copiedLog) files.set(COPIED_LOG, PLAYED);
  if (scenario.execRequestLog) files.set(`${LOGS}/battle.net-20261006T235959.000000.log`, fixture("launcher-exec.log"));
  let state: ClientState = scenario.state ?? { kind: "menus", screen: "MAIN_MENU" };
  let source: Source = scenario.source ?? "socket";
  let plays = 0;
  let escapes = 0;
  const newestLog = () => [...files.keys()].filter((path) => path.startsWith(LOGS)).sort().at(-1)!;

  const machine = PlayMachine.of({
    processes: Effect.sync(() => processes),
    serverDirectory: () => Effect.succeed(SERVER),
    signal: (pids, signal) => Effect.sync(() => {
      events.push(`${signal} ${pids.join(" ")}`);
      processes = processes.filter((process) => !pids.includes(process.pid));
    }),
    openSteam: () => Effect.die("doctor opened Steam for a client started by its command"),
    launch: (launcher) => Effect.sync(() => {
      plays++;
      events.push(`launch ${launcher.pid}`);
      const log = [...files.keys()].sort().findLast((path) => path.startsWith(LOGS) && path !== COPIED_LOG && files.get(path)!.includes("[BNLogin]")) ?? newestLog();
      files.set(log, files.get(log)! + LAUNCH);
      processes = [...processes, gameProcess(70000 + plays)];
      state = scenario.afterPlay ?? { kind: "menus", screen: "MAIN_MENU" };
      source = "socket";
    }),
    start: () => Effect.die("doctor starts a client's command as a service"),
    startLock: () => Effect.succeed(Effect.void),
    startService: (unit, command) => Effect.sync(() => {
      events.push(`start ${command.at(-1)} as ${unit}`);
      processes = [...processes, wineserver(60001), launcherProcess(60002)];
      files.set(`${LOGS}/battle.net-20261006T220000.000000.log`, scenario.restartedLog ?? SIGNED_IN);
    }),
    read: (path, from = 0) => Effect.sync(() => files.get(path)?.slice(from)),
    size: (path) => Effect.sync(() => files.get(path)?.length),
    // Every file is written during the run but the copied install's log, written the evening before.
    modified: (path) => Effect.sync(() => (!files.has(path) ? undefined : path === COPIED_LOG ? LAUNCHER_STARTED - 3 * 3600_000 : LAUNCHER_STARTED + 1500)),
    digest: () => Effect.die("unused"),
    list: (directory) => Effect.sync(() => [...files.keys()].filter((path) => path.startsWith(`${directory}/`)).map((path) => path.slice(directory.length + 1))),
    write: (path, text) => Effect.sync(() => {
      events.push(`write ${path.slice(DOCUMENTS.length + 1)}`);
      files.set(path, text);
    }),
    copy: () => Effect.die("unused"),
  });

  const view = (state: ClientState): ClientView => ({ client: "b", state, source, evidence: state.kind === "menus" ? "SetGlueScreen" : "fake", at: 0, scan: "done", loadErrors: { count: 0 } });
  let views = 0;
  const watch = ClientWatch.of({ view: () => Effect.sync(() => {
    if (plays > 0 && scenario.settlesAfter !== undefined && ++views > scenario.settlesAfter) state = { kind: "menus", screen: "MAIN_MENU" };
    return view(state);
  }) });

  const hands = DoctorHands.of({
    launches: scenario.noPlay !== true,
    leaveLobby: () => Effect.sync(() => {
      events.push("leave lobby");
      state = { kind: "menus", screen: "CUSTOM_GAMES" };
    }),
    closeScore: () => Effect.sync(() => {
      // The state the key lands on: doctor may press only on the score screen.
      events.push(state.kind === "results" ? "close score" : `close score at ${state.kind}`);
      if (++escapes >= (scenario.scoreEscapes ?? 1)) state = { kind: "menus", screen: "CUSTOM_GAMES" };
    }),
    enterLogin: (_target, field) => Effect.sync(() => {
      events.push(`enter ${field}`);
      if (scenario.signsIn !== "works") return;
      const log = newestLog();
      files.set(log, files.get(log)! + (field === "username" ? PASSWORD_PAGE : SIGNED_IN_BY_FORM));
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
    const account = scenario.signsIn === undefined ? {} : { account: { username: ["print", "username"], password: ["print", "password"] } };
    const { failure } = await finish(doctor([{ ...(scenario.preferences === undefined ? target : { ...target, settings: { Video: DISPLAY } }), ...account }], (line) => lines.push(line)));
    return { lines, failure, events };
  };
  const written = () => files.get(PREFERENCES);
  const drop = (next: ClientState) => {
    state = next;
  };
  return { run, finish, events, drop, written };
}

test("[native] recorded launcher logs: signed in, a lost connection, a reconnect, a rejected saved login", () => {
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

test("[repro bcb768d] doctor ignores a newer --exec log when checking and launching from a signed-in launcher", async () => {
  const result = await world({ processes: "launcher", execRequestLog: true }).run();
  expect(result.failure).toBeUndefined();
  expect(result.events).toContain("launch 43924");
});

test("[native] the crash dialog is Warcraft III's BlizzardError.exe, not the launcher's copy", () => {
  const crash = fixture("crash-report.txt");
  expect(crash).toContain("\\_retail_\\x86_64\\Warcraft III.exe");
  expect(isErrorDialog(errorDialog(1))).toBe(true);
  expect(isErrorDialog({ ...errorDialog(1), args: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.17896\\BlizzardError.exe"] })).toBe(false);
  expect(isErrorDialog(gameProcess(1))).toBe(false);
});

test("[spec #22] disconnected: ends Warcraft III and asks the signed-in launcher to launch the game", async () => {
  const { failure, events } = await world({ processes: "game", state: { kind: "disconnected", reason: "Battle.net connection lost" } }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["SIGTERM 52713", "launch 43924"]);
});

test("[spec #22] empty login shell: a login screen held 120 s by the menus is relaunched by the launcher", async () => {
  const { failure, events } = await world({ processes: "game", state: { kind: "menus", screen: "LOGIN_DOORS" } }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["SIGTERM 52713", "launch 43924"]);
});

test("[native] a log that shows no sign-in, with no menu report, is left alone: War3Log.txt is written in bursts", async () => {
  const war3Log = fixture("war3log-buffered-signed-in.txt");
  expect(ladderScan(war3Log).kind).toBe("signing in");
  const { failure, events } = await world({ processes: "game", state: { kind: "signing in" }, source: "log", war3Log }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual([]);
});

test("[spec #22] crashed with the error dialog up: closes the dialog and the game, then launches", async () => {
  const { failure, events } = await world({ processes: "game and dialog", state: { kind: "crashed", reason: "Crash.txt: ACCESS_VIOLATION" } }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["SIGTERM 52713 52990", "launch 43924"]);
});

test("[spec #22] stale lobby: leaves it through the menus; the score screen likewise", async () => {
  const lobby = await world({ processes: "game", state: { kind: "lobby", host: true, map: "Smashcraft 0.0.49" } }).run();
  expect(lobby.failure).toBeUndefined();
  expect(lobby.events).toEqual(["leave lobby"]);
  const results = await world({ processes: "game", state: { kind: "results" } }).run();
  expect(results.events).toEqual(["close score"]);
});

test("[repro f14f6f6] a score screen that ignores Escape gets it again, only while it shows, then Warcraft III is ended and launched", async () => {
  // Client B on 7 Oct stayed on the score screen after one Escape; a later press left it.
  const second = await world({ processes: "game", state: { kind: "results" }, scoreEscapes: 2 }).run();
  expect(second.failure).toBeUndefined();
  expect(second.events).toEqual(["close score", "close score"]);

  const stuck = await world({ processes: "game", state: { kind: "results" }, scoreEscapes: Infinity }).run();
  expect(stuck.failure).toBeUndefined();
  expect(stuck.events).toEqual(["close score", "close score", "close score", "SIGTERM 52713", "launch 43924"]);
});

test("[spec #22] stuck loading: 120 s on the loading screen ends the game and launches the game", async () => {
  const { failure, events } = await world({ processes: "game", state: { kind: "loading", map: "Smashcraft 0.0.49" } }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["SIGTERM 52713", "launch 43924"]);
});

test("[spec #22] two runtimes on one prefix: ends every program, starts Battle.net alone with its command, launches", async () => {
  const { failure, events } = await world({ processes: "two runtimes" }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["SIGTERM 43614 51022 43924", "start " + START.at(-1) + " as wisp-client-b.service", "launch 60002"]);
});

test("[spec #22] a launcher whose connection is failing is restarted before launching; a rejected login stops with one line", async () => {
  const lost = await world({ processes: "launcher", launcherLog: LOST, restartedLog: RECONNECTED }).run();
  expect(lost.failure).toBeUndefined();
  expect(lost.events).toEqual(["SIGTERM 43614 43924", "start " + START.at(-1) + " as wisp-client-b.service", "launch 60002"]);
  const rejected = await world({ processes: "launcher", launcherLog: REJECTED }).run();
  expect(rejected.events).toEqual([]);
  expect(rejected.failure?.split("\n")).toHaveLength(1);
  // A restart that lands on the sign-in form is the same one line, after its 90 s.
  const form = await world({ processes: "launcher", launcherLog: LOST, restartedLog: REJECTED.split("\n")[0]! }).run();
  expect(form.failure?.split("\n")).toHaveLength(1);
});

test("[invariant] a state that comes back after its recovery stops doctor instead of looping", async () => {
  const { failure, events } = await world({ processes: "game", state: { kind: "disconnected", reason: "logged out" }, afterPlay: { kind: "disconnected", reason: "logged out" } }).run();
  expect(events).toEqual(["SIGTERM 52713", "launch 43924"]);
  expect(failure).toBeDefined();
});

test("[spec #22] withDoctor: a run that fails gets one more try after doctor recovers something; otherwise its failure stands", async () => {
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
  const retried = await dropping.finish(withDoctor(doctor([target], () => {}), () => {}, failsOnce));
  expect(retried.value).toBe("match");
  expect(runs).toBe(2);
  expect(dropping.events).toEqual(["SIGTERM 52713", "launch 43924"]);
});

test("[repro 8f0ba58] display settings changed: a closed game's preferences are rewritten with the declared values, nothing else touched", async () => {
  const changed = world({ processes: "launcher", preferences: MAIN });
  const { failure, events } = await changed.run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["write War3Preferences.txt", "launch 43924"]);
  // Only the declared Video keys differ from what the client found; sfxvolume (Gameplay) stays 70.
  expect(changed.written()).toBe(MAIN.replace(/^(windowmode|windowwidth|windowheight|windowx|windowy|reswidth|resheight|refreshrate|maxfps)=.*$/gm, (_, key: string) => `${key}=${DISPLAY[key]}`));
  expect(displayChanges(changed.written()!, DISPLAY)).toEqual([]);
  expect(changed.written()).toContain("sfxvolume=70");
});

test("[invariant] settings that match are left alone", async () => {
  const same = await world({ processes: "launcher", preferences: PRIVATE }).run();
  expect(same.events).toEqual(["launch 43924"]);
});

test("[invariant] a declared key the file lacks is added to its [Video] section; CRLF files keep their endings", () => {
  expect(displayChanges(PRIVATE, { vsync: "1" })).toEqual([{ key: "vsync", expected: "1", actual: "0" }]);
  expect(displayChanges(PRIVATE, { bogus: "1" })).toEqual([{ key: "bogus", expected: "1" }]);
  const added = withDisplaySettings(PRIVATE, { bogus: "1" });
  expect(videoSettings(added).bogus).toBe("1");
  expect(added.indexOf("bogus=1")).toBeGreaterThan(added.indexOf("[Video]"));
  const crlf = withDisplaySettings(MAIN.replace(/\n/g, "\r\n"), DISPLAY);
  expect(crlf.split("\r\n").length).toBe(MAIN.split("\n").length);
  expect(displayChanges(crlf, DISPLAY)).toEqual([]);
  expect(crlf.replace(/\r\n/g, "\n").split("\n").every((line) => !line.includes("\r"))).toBe(true);
  // Entries of other sections with a Video key's name are not Video settings.
  expect(videoSettings("[Gameplay]\nwindowmode=9\n[Video]\nwindowmode=2\n").windowmode).toBe("2");
});

test("[native] the launcher's sign-in pages, from its UnifiedAuth log", () => {
  expect(launcherHealth(ACCOUNT_PAGE)).toEqual({ kind: "sign-in form", form: "Login" });
  // Submitted: no page until the password page loads.
  expect(launcherHealth(ACCOUNT_PAGE + BY_HAND.slice(5, 8).join("\n"))).toEqual({ kind: "not signed in" });
  expect(launcherHealth(ACCOUNT_PAGE + PASSWORD_PAGE)).toEqual({ kind: "sign-in form", form: "LoginCredential" });
  expect(launcherHealth(ACCOUNT_PAGE + PASSWORD_PAGE + SIGNED_IN_BY_FORM)).toEqual({ kind: "signed in" });
  // A rejected saved login, then its form.
  expect(launcherHealth(REJECTED + ACCOUNT_PAGE)).toEqual({ kind: "sign-in form", form: "Login" });
});

test("[repro d5014f6] a copied prefix's old signed-in log is ignored: the fresh launcher's account page is signed in", async () => {
  const { failure, events } = await world({ processes: "launcher", launcherLog: ACCOUNT_PAGE, signsIn: "works", copiedLog: true }).run();
  expect(failure).toBeUndefined();
  expect(events).toEqual(["enter username", "enter password", "launch 43924"]);
});

test("[spec #22] a sign-in form without an account, or one that doesn't move, stops with one line", async () => {
  const none = await world({ processes: "launcher", launcherLog: ACCOUNT_PAGE }).run();
  expect(none.events).toEqual([]);
  expect(none.failure?.split("\n")).toHaveLength(1);
  const stuck = await world({ processes: "launcher", launcherLog: ACCOUNT_PAGE, signsIn: "stuck" }).run();
  expect(stuck.events).toEqual(["enter username"]);
  expect(stuck.failure?.split("\n")).toHaveLength(1);
});

test("[repro 8 Oct clone lanes] client doctor after client stop starts a new private desktop instead of failing on the old run folder's display", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { reviveDesktops } = await import("../scripts/wisp/clientServicesCommand");
  const directory = mkdtempSync(join(tmpdir(), "doctor-desktop-"));
  try {
    const live = join(directory, "private-desktop.live");
    mkdirSync(join(live, "runtime"), { recursive: true });
    writeFileSync(join(live, "runtime/wayland-0"), "");
    writeFileSync(join(live, "display"), ":7");
    const fresh = join(directory, "private-desktop.fresh");
    const clientsFile = join(directory, "clients.json");
    const client = (name: string, run: string) => ({ name, run, documents: `/clones/${name}/pfx/drive_c/users/steamuser/Documents/Warcraft III` });
    writeFileSync(clientsFile, JSON.stringify({ tools: { grim: "grim", xdotool: "xdotool", wlrctl: "wlrctl", tesseract: "tesseract" }, clients: [client("clone-a", join(directory, "private-desktop.stopped")), client("clone-b", live)] }));
    const started: string[] = [];
    await Effect.runPromise(reviveDesktops(clientsFile, [], (name) => Effect.sync(() => {
      started.push(name);
      return fresh;
    })));
    expect(started).toEqual(["clone-a"]);
    const runs = (JSON.parse(readFileSync(clientsFile, "utf8")) as { clients: { name: string; run: string }[] }).clients.map(({ name, run }) => `${name} ${run}`);
    expect(runs).toEqual([`clone-a ${fresh}`, `clone-b ${live}`]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
