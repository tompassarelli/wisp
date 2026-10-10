import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ProcessInfo, prefixUse } from "../scripts/warcraft/battleNet";
import { sessionStart } from "../scripts/warcraft/war3Log";
import { type CrashReport, type SocketState, type Sources, changes, crashSummary, decide, eventLine, socketEvent, typesIntoMatch } from "../scripts/wisp/watch";

const fixture = (path: string) => readFileSync(join(import.meta.dir, "fixtures", path), "utf8");
const PREFIX = "/clients/a/pfx";
const process = (pid: number, exe: string): ProcessInfo => ({ pid, name: exe.split("\\").at(-1)!, args: [exe], prefix: PREFIX });
const GAME = process(52713, "C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\Warcraft III.exe");
const LAUNCHER = process(43924, "C:\\Program Files (x86)\\Battle.net\\Battle.net.exe");

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

test("[spec docs/watch.md] offline host permits chat only for its exact loaded, connected, playing process", () => {
  const lan = { pid: GAME.pid, map: "/private/test.w3x", phase: "playing", connected: true, loaded: true, left: false };
  const observed = (value: typeof lan) => decide("a", sources(on6Oct("21:00"), [GAME], { lan: value }));
  expect(typesIntoMatch(observed(lan))).toBe(true);
  expect(observed(lan).source).toBe("lan");
  for (const changed of [{ pid: GAME.pid + 1 }, { phase: "lobby" }, { phase: "loading" }, { phase: "over" }, { connected: false }, { loaded: false }, { left: true }]) {
    expect(typesIntoMatch(observed({ ...lan, ...changed }))).toBe(false);
  }
  expect(typesIntoMatch(decide("a", sources(on6Oct("21:00"), [], { lan })))).toBe(false);
});
const crashFolder = "2026-10-06 13.30.33 f80136c8";
const crash: CrashReport = {
  folder: crashFolder,
  session: sessionStart(fixture(`watch/errors/${crashFolder}/War3Log.txt`))!,
  summary: crashSummary(fixture(`watch/errors/${crashFolder}/Crash.txt`)),
  written: on6Oct("20:30:35"),
};

const trace = (lines: string, start: number, upTo = Number.POSITIVE_INFINITY): SocketState =>
  lines.trim().split("\n").map((line) => JSON.parse(line) as { at: number; messageType: string; payload: unknown })
    .filter(({ at }) => at <= upTo)
    .reduce<SocketState>((socket, { at, messageType, payload }) => socketEvent(socket, { messageType, payload }, start + at), { connected: true });

test("[native] the bad -loadfile run: signed in, ladder scan done, its map's imported models failing", () => {
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

test("[native] the crashed play --menus run: its crash report names the session in its log", () => {
  const log = fixture("war3log/menus-listing-during-scan.txt");

  const gone = decide("a", sources(on6Oct("20:31"), [LAUNCHER], { log, crashes: [crash] }));
  expect(gone.state).toEqual({ kind: "crashed", reason: "ACCESS_VIOLATION (Failed to read address 0x0000000000000500 at instruction 0x00006FFFEEC73856)" });
  expect(gone.evidence).toBe(`Errors/${crashFolder}/Crash.txt`);
  expect(decide("a", sources(on6Oct("20:30:40"), [LAUNCHER, GAME], { log, crashes: [crash] })).state.kind).toBe("crashed");
  expect(decide("a", sources(on6Oct("20:40"), [LAUNCHER, GAME], { log, crashes: [crash] })).state.kind).not.toBe("crashed");

  expect(decide("a", sources(on6Oct("20:36"), [LAUNCHER], { log: fixture("war3log/loadfile-scan-mid-load.txt"), crashes: [crash] })).state.kind).toBe("launcher");
});

test("[native] the login shell: a log without a sign-in says nothing", () => {

  const log = fixture("watch/login-shell-no-sign-in.txt");
  const silent = decide("b", sources(on6Oct("21:00"), [LAUNCHER, GAME], { log }));
  expect(silent.state).toEqual({ kind: "running" });
  expect(silent.source).toBe("process");
});

test("[provisional] the menus' login screen is signing in before a sign-in and a lost connection after one", () => {
  const log = fixture("watch/login-shell-no-sign-in.txt");
  const loginScreen = (state: SocketState) => socketEvent(state, { messageType: "SetGlueScreen", payload: { screen: "LOGIN_DOORS" } }, on6Oct("21:00"));
  expect(decide("b", sources(on6Oct("21:00"), [LAUNCHER, GAME], { log, socket: loginScreen({ connected: true }) })).state).toEqual({ kind: "signing in" });
  const before = decide("b", sources(on6Oct("20:59"), [LAUNCHER, GAME], { log, socket: trace(fixture("watch/host-match.jsonl"), on6Oct("20:58"), 1500) }));
  expect(before.state).toEqual({ kind: "menus", screen: "CUSTOM_LOBBIES" });
  const lost = decide("b", sources(on6Oct("21:00"), [LAUNCHER, GAME], { log, socket: loginScreen({ connected: true }) }), before);
  expect(lost.state).toEqual({ kind: "disconnected", reason: "the menus went back to the login screen" });
  expect(lost.source).toBe("socket");
});

test("[provisional] a hosted match from the menus' socket: screens, lobby host, loading, match, results, signed out", () => {
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

  expect(socketEvent({ connected: true }, { messageType: "SetGlueScreen", payload: { screen: "DISABLED_SCREEN" } }, 0)).toEqual({ connected: true });
  const results = socketEvent({ connected: true }, { messageType: "UpdateScoreInfo", payload: {} }, 1);
  const menus = socketEvent(results, { messageType: "ScreenTransitionInfo", payload: { screen: "CREATE_GAME", type: "Screen" } }, 2);
  expect(menus.last?.state).toEqual({ kind: "menus", screen: "CREATE_GAME" });
  expect(socketEvent(menus, { messageType: "ScreenTransitionInfo", payload: { screen: "OPTIONS", type: "Overlay" } }, 3)).toEqual(menus);
});

test("[spec docs/watch.md] chat goes only into a match its menu page reports, never on a receipt alone or a previous launch's evidence", () => {
  const log = fixture("war3log/menus-after-scan.txt");
  const start = on6Oct("16:30");
  const at = (offset: number) => decide("a", sources(start + offset, [LAUNCHER, GAME], { log, socket: trace(fixture("watch/host-match.jsonl"), start, offset) }));

  for (const offset of [0, 4000, 6100, 9000, 76100, 80100]) expect(typesIntoMatch(at(offset))).toBe(false);
  expect(typesIntoMatch(at(16000))).toBe(true);

  expect(typesIntoMatch(decide("a", sources(start + 12_000, [LAUNCHER, GAME], { log, socket: trace(fixture("watch/host-match.jsonl"), start, 9000), receipt: start + 11_000 })))).toBe(true);

  const receiptOnly = decide("a", sources(start, [LAUNCHER, GAME], { log, receipt: start - 1000 }));
  expect(receiptOnly.state).toEqual({ kind: "in match" });
  expect(typesIntoMatch(receiptOnly)).toBe(false);
  const started = on6Oct("16:30");
  const game = { ...GAME, started };
  const old = { log, receipt: started - 1000 };
  expect(decide("a", sources(started + 9000, [LAUNCHER, { ...game, started: on6Oct("16:20") }], { log, receipt: started + 2000 })).state.kind).toBe("in match");
  expect(decide("a", sources(started + 9000, [LAUNCHER, game], old)).state.kind).toBe("running");
  expect(decide("a", sources(started + 9000, [LAUNCHER, game], old)).evidence).toContain("starting");
  expect(decide("a", sources(started + 9000, [LAUNCHER, game], { ...old, socket: { connected: true, last: { state: { kind: "in match" }, at: started - 1000, evidence: "old match" } } })).state.kind).toBe("running");
  const current = { ...old, socket: { connected: true, last: { state: { kind: "loading" as const }, at: started + 1000, evidence: "loading" } }, receipt: started + 2000 };
  expect(decide("a", sources(started + 9000, [LAUNCHER, game], current)).state.kind).toBe("in match");
  for (const state of [{ kind: "menus" as const, screen: "MAIN_MENU" }, { kind: "signed in" as const }]) {
    expect(decide("a", sources(started + 9000, [LAUNCHER, game], { ...old, socket: { connected: true, last: { state, at: started + 1000, evidence: "current" } } })).state).toEqual(state);
  }
});

test("[native] processes alone: closed, launcher, and a clean exit's log as the last session's", () => {
  expect(decide("a", sources(on6Oct("17:00"), [])).state).toEqual({ kind: "closed" });
  expect(decide("a", sources(on6Oct("17:00"), [LAUNCHER])).state).toEqual({ kind: "launcher" });

  expect(decide("a", sources(on6Oct("17:00"), [LAUNCHER, GAME], { log: fixture("watch/menus-closed.txt") })).state).toEqual({ kind: "running" });
});
