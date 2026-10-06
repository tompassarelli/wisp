import { Effect, Exit, Layer } from "effect";
import { expect, test } from "bun:test";
import type { Client } from "../scripts/wisp/clients";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type ProcessInfo, prefixUse } from "../scripts/warcraft/battleNet";
import { sessionStart } from "../scripts/warcraft/war3Log";
import { type ClientState, type ClientView, ClientWatch, type CrashReport, type SocketState, type Sources, changes, crashSummary, decide, eventLine, inState, socketEvent, unlessLost, waitFor } from "../scripts/wisp/watch";

const client: Client = { name: "a", documents: "/a/Documents/Warcraft III" };
test("a rendered menu transition replaces old score data, while overlays do not", () => {
  const results = socketEvent({ connected: true }, { messageType: "UpdateScoreInfo", payload: {} }, 1);
  const menus = socketEvent(results, { messageType: "ScreenTransitionInfo", payload: { screen: "CREATE_GAME", type: "Screen" } }, 2);
  expect(menus.last?.state).toEqual({ kind: "menus", screen: "CREATE_GAME" });
  expect(socketEvent(menus, { messageType: "ScreenTransitionInfo", payload: { screen: "OPTIONS", type: "Overlay" } }, 3)).toEqual(menus);
});
const view = (state: ClientState): ClientView => ({ client: "a", state, source: "socket", evidence: "SetGlueScreen", at: 0, scan: "done", loadErrors: { count: 0 } });

/** A watch that reports each state once, then repeats the last. */
const scripted = (...states: ClientState[]) => {
  let index = 0;
  return Layer.succeed(ClientWatch, ClientWatch.of({ view: () => Effect.sync(() => view(states[Math.min(index++, states.length - 1)]!)) }));
};

test("waitFor returns the first view the predicate accepts", async () => {
  const seen = await Effect.runPromise(waitFor(client, inState("lobby")).pipe(Effect.provide(scripted({ kind: "menus", screen: "CUSTOM_GAMES" }, { kind: "lobby", host: true }))));
  expect(seen.state).toEqual({ kind: "lobby", host: true });
});

test("a crash or a lost Battle.net ends a wait at once, unless the predicate wants it", async () => {
  const crashed = await Effect.runPromiseExit(waitFor(client, inState("in match"), { what: "the match" }).pipe(Effect.provide(scripted({ kind: "loading" }, { kind: "crashed", reason: "Warcraft III exited" }))));
  expect(Exit.isFailure(crashed) && String(crashed.cause)).toContain("crashed: Warcraft III exited");
  const seen = await Effect.runPromise(waitFor(client, inState("disconnected", "signed in"), { failOn: [] }).pipe(Effect.provide(scripted({ kind: "disconnected", reason: "logged out" }))));
  expect(seen.state.kind).toBe("disconnected");
});

test("unlessLost stops a wait that would run out its own timeout when the client crashes, and changes nothing without a watch", async () => {
  const lost = await Effect.runPromiseExit(unlessLost(client, Effect.never).pipe(Effect.provide(scripted({ kind: "loading" }, { kind: "loading" }, { kind: "crashed", reason: "ACCESS_VIOLATION" }))));
  expect(Exit.isFailure(lost) && String(lost.cause)).toContain("crashed: ACCESS_VIOLATION");
  expect(await Effect.runPromise(unlessLost(client, Effect.succeed("hosted")))).toBe("hosted");
});

// ----- Deciding states from recorded sources (test/fixtures/watch/README.md) -----

const fixture = (path: string) => readFileSync(join(import.meta.dir, "fixtures", path), "utf8");
const PREFIX = "/clients/a/pfx";
const process = (pid: number, exe: string): ProcessInfo => ({ pid, name: exe.split("\\").at(-1)!, args: [exe], prefix: PREFIX });
const GAME = process(52713, "C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\Warcraft III.exe");
const LAUNCHER = process(43924, "C:\\Program Files (x86)\\Battle.net\\Battle.net.exe");
/** 6 Oct 2026 at a local time. */
const on6Oct = (time: string) => {
  const [hours, minutes, seconds = "0"] = time.split(":");
  return new Date(2026, 9, 6, Number(hours), Number(minutes), Number(seconds)).getTime();
};
const sources = (now: number, processes: readonly ProcessInfo[], extra: Partial<Sources> = {}): Sources => ({
  now,
  prefix: prefixUse(processes, PREFIX, ""),
  crashes: [],
  socket: { connected: false },
  ...extra,
});
const crashFolder = "2026-10-06 13.30.33 f80136c8";
const crash: CrashReport = {
  folder: crashFolder,
  session: sessionStart(fixture(`watch/errors/${crashFolder}/War3Log.txt`))!,
  summary: crashSummary(fixture(`watch/errors/${crashFolder}/Crash.txt`)),
  written: on6Oct("20:30:35"),
};
/** Folds a socket trace (JSON lines with `at` in ms from `start`) into the socket's state. */
const trace = (lines: string, start: number, upTo = Number.POSITIVE_INFINITY): SocketState =>
  lines.trim().split("\n").map((line) => JSON.parse(line) as { at: number; messageType: string; payload: unknown })
    .filter(({ at }) => at <= upTo)
    .reduce<SocketState>((socket, { at, messageType, payload }) => socketEvent(socket, { messageType, payload }, start + at), { connected: true });

test("the bad -loadfile run: signed in, ladder scan done, its map's imported models failing", () => {
  const log = fixture("war3log/loadfile-scan-mid-load.txt");
  const seen = decide("a", sources(on6Oct("20:36"), [LAUNCHER, GAME], { log }));
  expect(seen.state).toEqual({ kind: "signed in" });
  expect(seen.source).toBe("log");
  expect(seen.scan).toBe("done");
  expect(seen.loadErrors).toEqual({ count: 7, first: "war3mapImported/ImpactHit-14ab984c85a771b2c9feb68275c44577ceb14d0f5c5f2e3801cbc00c2decd594.mdx" });
  const events = changes(undefined, seen);
  expect(events.map(({ type }) => type)).toEqual(["state", "ladder scan", "load errors"]);
  expect(eventLine(events[2]!)).toContain("load errors: 7 models failed, first war3mapImported/ImpactHit-");
});

test("the crashed play --menus run: its crash report names the session in its log", () => {
  const log = fixture("war3log/menus-listing-during-scan.txt");
  // Gone, the game's crash stands; still running a minute after the report, a new launch is assumed.
  const gone = decide("a", sources(on6Oct("20:31"), [LAUNCHER], { log, crashes: [crash] }));
  expect(gone.state).toEqual({ kind: "crashed", reason: "ACCESS_VIOLATION (Failed to read address 0x0000000000000500 at instruction 0x00006FFFEEC73856)" });
  expect(gone.evidence).toBe(`Errors/${crashFolder}/Crash.txt`);
  expect(decide("a", sources(on6Oct("20:30:40"), [LAUNCHER, GAME], { log, crashes: [crash] })).state.kind).toBe("crashed");
  expect(decide("a", sources(on6Oct("20:40"), [LAUNCHER, GAME], { log, crashes: [crash] })).state.kind).not.toBe("crashed");
  // Another session's report doesn't count.
  expect(decide("a", sources(on6Oct("20:36"), [LAUNCHER], { log: fixture("war3log/loadfile-scan-mid-load.txt"), crashes: [crash] })).state.kind).toBe("launcher");
});

test("the login shell: a log without a sign-in says nothing; the menus' login screen is a lost connection once signed in", () => {
  // Client B's log stopped 3 s after its start while B played all evening: the log is written in bursts.
  const log = fixture("watch/login-shell-no-sign-in.txt");
  const silent = decide("b", sources(on6Oct("21:00"), [LAUNCHER, GAME], { log }));
  expect(silent.state).toEqual({ kind: "running" });
  expect(silent.source).toBe("process");
  const loginScreen = (state: SocketState) => socketEvent(state, { messageType: "SetGlueScreen", payload: { screen: "LOGIN_DOORS" } }, on6Oct("21:00"));
  expect(decide("b", sources(on6Oct("21:00"), [LAUNCHER, GAME], { log, socket: loginScreen({ connected: true }) })).state).toEqual({ kind: "signing in" });
  const before = decide("b", sources(on6Oct("20:59"), [LAUNCHER, GAME], { log, socket: trace(fixture("watch/host-match.jsonl"), on6Oct("20:58"), 1500) }));
  expect(before.state).toEqual({ kind: "menus", screen: "CUSTOM_LOBBIES" });
  const lost = decide("b", sources(on6Oct("21:00"), [LAUNCHER, GAME], { log, socket: loginScreen({ connected: true }) }), before);
  expect(lost.state).toEqual({ kind: "disconnected", reason: "the menus went back to the login screen" });
  expect(lost.source).toBe("socket");
});

test("a hosted match from the menus' socket: screens, lobby host, loading, match, results, signed out", () => {
  const log = fixture("watch/menus-closed.txt").replace(/\r\n[^\r\n]*GameMain Ended\r\n$/, "\r\n");
  const start = on6Oct("16:22");
  const at = (offset: number) => decide("a", sources(start + offset, [LAUNCHER, GAME], { log, socket: trace(fixture("watch/host-match.jsonl"), start, offset) }));
  expect(at(0).state).toEqual({ kind: "menus", screen: "MAIN_MENU" });
  expect(at(4000).state).toEqual({ kind: "menus", screen: "CUSTOM_LOBBIES" });
  expect(at(6000).state).toEqual({ kind: "lobby" });
  expect(at(6100).state).toEqual({ kind: "lobby", host: true });
  expect(at(9000).state).toEqual({ kind: "loading" });
  expect(at(16000).state).toEqual({ kind: "in match" });
  expect(at(76100).state).toEqual({ kind: "results" });
  expect(at(80100).state).toEqual({ kind: "menus", screen: "CUSTOM_LOBBIES" });
  expect(at(90000).state).toEqual({ kind: "disconnected", reason: "Battle.net signed this client out" });
  expect(at(6100).source).toBe("socket");
  // A DISABLED_SCREEN that doesn't follow loading is no match.
  expect(socketEvent({ connected: true }, { messageType: "SetGlueScreen", payload: { screen: "DISABLED_SCREEN" } }, 0)).toEqual({ connected: true });
});

test("the map's match receipt places a client in its match when the socket says no more than the lobby or nothing", () => {
  const log = fixture("war3log/menus-after-scan.txt");
  const start = on6Oct("16:30");
  const loading = trace(fixture("watch/host-match.jsonl"), start, 9000);
  const seen = decide("a", sources(start + 12_000, [LAUNCHER, GAME], { log, socket: loading, receipt: start + 11_000 }));
  expect(seen.state).toEqual({ kind: "in match" });
  expect(seen.source).toBe("receipt");
  expect(decide("a", sources(start, [LAUNCHER, GAME], { log, receipt: start - 1000 })).source).toBe("receipt");
  // A receipt from before this session's sign-in is an earlier session's.
  expect(decide("a", sources(start, [LAUNCHER, GAME], { log, receipt: on6Oct("16:00") })).state).toEqual({ kind: "signed in" });
});

test("processes alone: closed, launcher, and a clean exit's log as the last session's", () => {
  expect(decide("a", sources(on6Oct("17:00"), [])).state).toEqual({ kind: "closed" });
  expect(decide("a", sources(on6Oct("17:00"), [LAUNCHER])).state).toEqual({ kind: "launcher" });
  // Warcraft III started again; the log still holds the last session, which ended.
  expect(decide("a", sources(on6Oct("17:00"), [LAUNCHER, GAME], { log: fixture("watch/menus-closed.txt") })).state).toEqual({ kind: "running" });
  expect(readdirSync(join(import.meta.dir, "fixtures/watch/errors"))).toEqual([crashFolder]);
});
