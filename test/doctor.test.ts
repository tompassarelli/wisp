import { expect, test } from "bun:test";
import { Effect, Exit, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ProcessInfo, launcherHealth, prefixUse } from "../scripts/warcraft/battleNet";
import { ladderScan } from "../scripts/warcraft/war3Log";
import { displayChanges, videoSettings, withDisplaySettings } from "../scripts/warcraft/preferences";
import { DoctorHands, type DoctorTarget, diagnose, doctor, type Observation } from "../scripts/wisp/doctor/doctor";
import { PlayMachine } from "../scripts/wisp/play/play";
import { leaveScoreScreen } from "../scripts/wisp/play/lobby";
import { ClientWatch, type ClientState, type ClientView } from "../scripts/wisp/dev/watch";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/doctor", name), "utf8");
const PLAYED = fixture("launcher-played.log");
const LOST = fixture("launcher-connection-lost.log");
const RECONNECTED = fixture("launcher-reconnected.log");
const REJECTED = fixture("launcher-login-rejected.log");
const BY_HAND = fixture("launcher-signed-in-by-hand.log").split("\n");
const ACCOUNT_PAGE = BY_HAND.slice(0, 5).join("\n") + "\n";
const SIGNED_IN = PLAYED.split("\n")[0]! + "\n";
const PREFIX = "/observed/client/pfx";
const gameProcess = (pid: number): ProcessInfo => ({ pid, name: "Warcraft III.ex", args: ["C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\Warcraft III.exe", "-launch", "-uid", "w3"], prefix: PREFIX });
const errorDialog = (pid: number): ProcessInfo => ({ pid, name: "BlizzardError.e", args: ["C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\BlizzardError.exe"], prefix: PREFIX });
const preferences = (name: string) => readFileSync(join(import.meta.dir, "fixtures/preferences", name), "utf8");
const PRIVATE = preferences("private-desktop.txt");
const MAIN = preferences("main-display.txt");
const DISPLAY = Object.fromEntries(["windowmode", "windowwidth", "windowheight", "windowx", "windowy", "reswidth", "resheight", "refreshrate", "maxfps"].map(key => [key, videoSettings(PRIVATE)[key]!]));

test("[native] recorded launcher logs: signed in, a lost connection, a reconnect, a rejected saved login", () => {
  expect(launcherHealth(PLAYED)).toEqual({ kind: "signed in" });
  expect(launcherHealth(LOST)).toEqual({ kind: "connection failing", reason: "its last 3 presence updates timed out (ERROR_RPC_REQUEST_TIMED_OUT)" });

  expect(launcherHealth(LOST.split("\n").slice(0, 3).join("\n")).kind).toBe("signed in");
  expect(launcherHealth(RECONNECTED)).toEqual({ kind: "signed in" });
  expect(launcherHealth(REJECTED).kind).toBe("sign-in needed");
  expect(launcherHealth(REJECTED.split("\n")[0]!)).toEqual({ kind: "not signed in" });

  expect(launcherHealth(`${SIGNED_IN}D 2026-10-06 12:33:38.741703 [CatalogVarStorage] {Main} Setting var from catalog Client.DisableLoginCredentialUIRegionList=CN\n`).kind).toBe("signed in");
});

test("[scenario] a client-owned Battle.net Agent is visible when Wine hides its prefix", () => {
  const agent: ProcessInfo = { pid: 73125, name: "Agent.exe", args: ["Agent.exe"], ownerUnit: "wisp-client-clone-c.service" };
  const runner: ProcessInfo = {
    pid: 73124,
    name: "python3",
    args: ["/home/tom/.local/share/Steam/compatibilitytools.d/GE-Proton11-7-x86_64/proton", "waitforexitandrun"],
    ownerUnit: "wisp-client-clone-c.service",
  };
  const environment: ProcessInfo = {
    pid: 73123,
    name: "dbus-run-session",
    args: ["STEAM_COMPAT_APP_ID=3775098022", "SteamAppId=3775098022"],
    ownerUnit: "wisp-client-clone-c.service",
  };
  const runtimeDir = "/run/user/1000/private-desktop.test/runtime";
  const use = prefixUse([agent, runner, environment], PREFIX, "", { ownerUnit: "wisp-client-clone-c.service", display: ":17", runtimeDir });
  expect(use.launcher).toMatchObject({
    pid: agent.pid,
    prefix: PREFIX,
    display: ":17",
    runtimeDir,
    proton: { pid: runner.pid, command: runner.args[0], environment: { STEAM_COMPAT_APP_ID: "3775098022", SteamAppId: "3775098022" } },
  });
  expect(use.processes).toContainEqual(expect.objectContaining({ pid: agent.pid, prefix: PREFIX }));
  expect(prefixUse([agent], PREFIX, "", { ownerUnit: "wisp-client-clone-b.service" }).launcher).toBeUndefined();
});

test("[property seed 22] diagnosis preserves ready clients and distinguishes observed faults across ages and sources", () => {
  const states: readonly ClientState[] = [
    { kind: "menus", screen: "MAIN_MENU" }, { kind: "signed in" }, { kind: "in match" },
    { kind: "menus", screen: "LOGIN_DOORS" }, { kind: "loading" }, { kind: "signing in" },
    { kind: "disconnected", reason: "recorded lost connection" }, { kind: "crashed", reason: "recorded crash" },
    { kind: "lobby", host: true }, { kind: "results" }, { kind: "running" },
  ];
  const use = prefixUse([gameProcess(52713)], PREFIX, "");
  for (const source of ["socket", "log", "process"] as const) for (const held of [0, 59999, 119999, 120000, 240000]) for (const state of states) {
    const view: ClientView = { client: "recording", state, source, evidence: "recorded observation", at: held, scan: "done", loadErrors: { count: 0 } };
    const observation: Observation = { use, view, held };
    const result = diagnose(observation, true);
    if (state.kind === "menus" && state.screen === "MAIN_MENU" || state.kind === "signed in" || state.kind === "in match") expect(result.kind).toBe("ready");
    if (state.kind === "disconnected" || state.kind === "crashed") expect(result).toMatchObject({ kind: "problem", problem: state.kind });
    if (state.kind === "loading") expect(result.kind).toBe(held < 120000 ? "wait" : "problem");
    if (state.kind === "menus" && state.screen === "LOGIN_DOORS") expect(result.kind).toBe(held < 120000 ? "wait" : "problem");
    if (state.kind === "signing in") expect(result.kind).toBe(held < 120000 ? "wait" : source === "socket" ? "problem" : "ready");
    if (state.kind === "lobby") expect(result).toMatchObject({ kind: "problem", problem: "stale lobby" });
    if (state.kind === "results") expect(result).toMatchObject({ kind: "problem", problem: "score screen" });
    if (state.kind === "running") {
      expect(diagnose({ ...observation, startupCpu: 0 }, true)).toMatchObject({ kind: "problem", problem: "hung startup" });
      expect(diagnose({ ...observation, startupCpu: 1 }, true).kind).toBe("ready");
    }
    expect(diagnose({ ...observation, errorDialog: errorDialog(52990) }, true)).toMatchObject({ kind: "problem", problem: "crashed" });
    if (state.kind !== "disconnected" && state.kind !== "crashed") expect(diagnose({ ...observation, view: { ...view, loadErrors: { count: 7, first: "recorded.mdx" } } }, true)).toMatchObject({ kind: "problem", problem: "map without its imports" });
  }
  expect(ladderScan(fixture("war3log-buffered-signed-in.txt")).kind).toBe("signing in");
  for (const log of [PLAYED, LOST, RECONNECTED, REJECTED, ACCOUNT_PAGE]) {
    const observation: Observation = { use: prefixUse([{ pid: 43924, name: "CrBrowserMain", prefix: PREFIX, args: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.exe"] }], PREFIX, ""), launcher: launcherHealth(log), held: 240000 };
    const result = diagnose(observation, true, ":recording");
    if (log === PLAYED || log === RECONNECTED) expect(result).toMatchObject({ kind: "problem", problem: "no game" });
    if (log === LOST) expect(result).toMatchObject({ kind: "problem", problem: "connection failing" });
    if (log === REJECTED || log === ACCOUNT_PAGE) expect(result.kind).toBe("stop");
  }
});

test("[property seed 8058] preference edits are idempotent, add a missing key to [Video], keep CRLF endings and preserve every unrelated recorded setting", () => {
  for (const source of [MAIN, PRIVATE]) for (const newline of ["\n", "\r\n"]) for (const width of [640, 1280, 1920, 2876]) {
    const before = source.replace(/\r?\n/g, newline);
    const settings = { windowwidth: String(width), bogus: "1" };
    const after = withDisplaySettings(before, settings);
    expect(videoSettings(after)).toMatchObject(settings);
    expect(withDisplaySettings(after, settings)).toBe(after);
    expect(displayChanges(after, settings)).toEqual([]);
    const untouched = (text: string) => text.split(newline).filter(line => !/^(windowwidth|bogus)=/.test(line)).join(newline);
    expect(untouched(after)).toBe(untouched(before));
  }
  {
    expect(displayChanges(PRIVATE, { vsync: "1" })).toEqual([{ key: "vsync", expected: "1", actual: "0" }]);
    expect(displayChanges(PRIVATE, { bogus: "1" })).toEqual([{ key: "bogus", expected: "1" }]);
    const added = withDisplaySettings(PRIVATE, { bogus: "1" });
    expect(videoSettings(added).bogus).toBe("1");
    expect(added.indexOf("bogus=1")).toBeGreaterThan(added.indexOf("[Video]"));
    const crlf = withDisplaySettings(MAIN.replace(/\n/g, "\r\n"), DISPLAY);
    expect(crlf.split("\r\n").length).toBe(MAIN.split("\n").length);
    expect(displayChanges(crlf, DISPLAY)).toEqual([]);
    expect(crlf.replace(/\r\n/g, "\n").split("\n").every((line) => !line.includes("\r"))).toBe(true);

    expect(videoSettings("[Gameplay]\nwindowmode=9\n[Video]\nwindowmode=2\n").windowmode).toBe("2");
  }
});

function doctorHarness(running: ProcessInfo[], stubborn: ReadonlySet<number>, preferencesText?: string, score?: { presses: number }) {
  const signals: [string, number[]][] = [];
  const writes: string[] = [];
  const log = "battle.net-20261014T110000.1.log";
  const machine = PlayMachine.of({
    processes: Effect.sync(() => [...running]),
    serverDirectory: () => Effect.succeed("server"),
    signal: (pids, signal) => Effect.sync(() => {
      signals.push([signal, [...pids]]);
      const ended = pids.filter((pid) => signal === "SIGKILL" || !stubborn.has(pid));
      running.splice(0, running.length, ...running.filter(({ pid }) => !ended.includes(pid)));
    }),
    launch: () => Effect.die("doctor launched a game it was told not to"),
    openSteam: () => Effect.die("doctor opened Steam"),
    start: () => Effect.die("doctor started a command"),
    startService: () => Effect.die("doctor started a service"),
    startLock: () => Effect.succeed(Effect.void),
    read: (path) => Effect.succeed(path.endsWith(log) ? SIGNED_IN : path.endsWith("War3Preferences.txt") ? preferencesText : undefined),
    size: () => Effect.succeed(0),
    modified: () => Effect.succeed(0),
    digest: () => Effect.succeed(undefined),
    list: () => Effect.succeed([log]),
    write: (_path, text) => Effect.sync(() => { writes.push(text); }),
    copy: () => Effect.void,
  });
  const hands = DoctorHands.of({ launches: false, leaveLobby: () => Effect.void, closeScore: () => Effect.sync(() => { if (score !== undefined) score.presses++; }) });
  const watch = ClientWatch.of({ view: (client) => Effect.sync(() => ({ client: client.name, state: score !== undefined && score.presses < 2 ? { kind: "results" } : { kind: "menus", screen: "MAIN_MENU" }, source: "socket", evidence: "UpdateScoreInfo then ScreenTransitionInfo MAIN_MENU", at: 0, scan: "done", loadErrors: { count: 0 } })) });
  const target = (settings?: DoctorTarget["settings"]): DoctorTarget => ({
    client: { name: "fake", documents: `${PREFIX}/drive_c/users/steamuser/Documents/Warcraft III` },
    prefix: PREFIX,
    start: { kind: "steam", appId: 1, name: "fake" },
    ...(settings === undefined ? {} : { settings }),
  });
  const run = (settings?: DoctorTarget["settings"]) => Effect.gen(function*() {
    const fiber = yield* doctor([target(settings)], () => {}).pipe(Effect.provide(Layer.mergeAll(Layer.succeed(PlayMachine, machine), Layer.succeed(DoctorHands, hands), Layer.succeed(ClientWatch, watch))), Effect.exit, Effect.forkChild);
    yield* TestClock.adjust("60 seconds");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);
  return { signals, writes, run };
}

const LAUNCHER: ProcessInfo = { pid: 40, name: "Battle.net", args: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.exe"], prefix: PREFIX };

test("[scenario] UpdateScore recovers to menus through doctor and fresh-match setup when the first Escape is missed", async () => {
  const score = { presses: 0 };
  const harness = doctorHarness([LAUNCHER, gameProcess(41)], new Set(), undefined, score);
  const exit = await harness.run();
  expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([{ client: "fake", state: "menus (MAIN_MENU)", recovered: ["score screen"] }]);
  expect(score.presses).toBe(2);
  expect(harness.signals).toEqual([]);
  let presses = 0;
  const client = { name: "clone-b", documents: "recorded" };
  const program = Effect.gen(function*() {
    const fiber = yield* leaveScoreScreen(client, Effect.sync(() => { presses++; })).pipe(Effect.forkChild);
    yield* TestClock.adjust("30 seconds");
    yield* Fiber.join(fiber);
    yield* leaveScoreScreen(client, Effect.sync(() => { presses++; }));
  }).pipe(Effect.provideService(ClientWatch, ClientWatch.of({ view: () => Effect.sync(() => ({ client: client.name, state: presses < 2 ? { kind: "results" } : { kind: "menus", screen: "MAIN_MENU" }, source: "socket", evidence: "recorded UpdateScoreInfo", at: 0 })) })), Effect.provide(TestClock.layer()));
  await Effect.runPromise(program);
  expect(presses).toBe(2);
});

test("[scenario] doctor ends a crashed game with its error dialog, kills only what ignored SIGTERM, leaves Battle.net running and reports the client ready", async () => {
  const harness = doctorHarness([LAUNCHER, gameProcess(41), errorDialog(42)], new Set([41]));
  const exit = await harness.run();
  expect(Exit.isSuccess(exit) ? exit.value : exit).toEqual([{ client: "fake", state: "Battle.net signed in", recovered: ["crashed"] }]);
  expect(harness.signals).toEqual([["SIGTERM", [41, 42]], ["SIGKILL", [41]]]);
});

test("[scenario] doctor restores changed display settings once and refuses when the same problem returns", async () => {
  const harness = doctorHarness([], new Set(), "[Video]\nwindowwidth=800\n");
  const exit = await harness.run({ Video: { windowwidth: "1280" } });
  expect(Exit.isFailure(exit)).toBe(true);
  expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain("fake: still display settings changed after restoring the display settings once");
  expect(harness.writes).toEqual(["[Video]\nwindowwidth=1280\n"]);
  expect(harness.signals).toEqual([]);
});
