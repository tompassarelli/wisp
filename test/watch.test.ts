import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ProcessInfo, prefixUse } from "../scripts/warcraft/battleNet";
import { sessionStart } from "../scripts/warcraft/war3Log";
import { type ClientState, type CrashReport, type SocketState, type Sources, changes, crashSummary, decide, eventLine, socketEvent, typesIntoMatch } from "../scripts/wisp/watch";

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

test("[boundary] the pair owner's live Warcraft PID survives unreadable prefix metadata without admitting closed clients, other applications or a lobby", () => {
  const now = on6Oct("20:36");
  const game = { ...GAME, prefix: undefined };
  const lan = { pid: GAME.pid, map: "/proof/own-map.w3x", phase: "playing", connected: true, loaded: true, left: false };
  const observe = (processes: readonly ProcessInfo[], state = lan) => decide("a", {
    ...sources(now, processes), prefix: prefixUse(processes, PREFIX, "", state.pid), lan: state,
  });
  const match = observe([game]);
  expect(match.state.kind).toBe("in match");
  expect(match.source).toBe("lan");
  expect(typesIntoMatch(match)).toBe(true);
  expect(observe([]).state.kind).toBe("closed");
  expect(typesIntoMatch(observe([{ ...game, pid: GAME.pid + 1 }]))).toBe(false);
  expect(typesIntoMatch(observe([{ ...game, prefix: "/clients/b/pfx" }]))).toBe(false);
  expect(typesIntoMatch(observe([{ ...LAUNCHER, pid: GAME.pid, prefix: undefined }]))).toBe(false);
  expect(typesIntoMatch(observe([{ ...game, args: ["C:\\unknown.exe"] }]))).toBe(false);
  for (const state of [{ ...lan, phase: "lobby" }, { ...lan, loaded: false }, { ...lan, connected: false }, { ...lan, left: true }]) {
    const view = observe([game], state);
    expect(view.state.kind).toBe("running");
    expect(typesIntoMatch(view)).toBe(false);
  }
  for (const state of [{ kind: "menus", screen: "MAIN_MENU" }, { kind: "lobby" }] as const) {
    const view = decide("a", {
      ...sources(now, [game]), prefix: prefixUse([game], PREFIX, "", lan.pid), lan: { ...lan, phase: "lobby" },
      socket: { connected: true, last: { state, at: now, evidence: "current menu page" } },
    });
    expect(view.state).toEqual(state);
    expect(typesIntoMatch(view)).toBe(false);
  }
  expect(prefixUse([game], PREFIX, "").game).toBeUndefined();
});

const crashFolder = "2026-10-06 13.30.33 f80136c8";
const crash: CrashReport = {
  folder: crashFolder,
  session: sessionStart(fixture(`watch/errors/${crashFolder}/War3Log.txt`))!,
  summary: crashSummary(fixture(`watch/errors/${crashFolder}/Crash.txt`)),
  written: on6Oct("20:30:35"),
};

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

test("[property seed 4141] evidence from before the game started never counts, a fresh receipt outranks an older lobby or loading screen, and chat goes only into a match its menu page reports", () => {
  let seed = 4141;
  const next = (below: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 16) % below;
  };
  const log = fixture("war3log/menus-after-scan.txt");
  const logStart = on6Oct("16:20:57") + 156, login = on6Oct("16:21:11") + 129, now = on6Oct("16:36");
  const states: readonly ClientState[] = [{ kind: "menus", screen: "MAIN_MENU" }, { kind: "lobby" }, { kind: "loading" }, { kind: "in match" }, { kind: "results" }, { kind: "signing in" }];
  for (let sample = 0; sample < 400; sample++) {
    const started = on6Oct("16:20") + next(4) * 30_000;
    const time = () => started - 60_000 + next(180) * 1000;
    const socket: SocketState = next(3) === 0 ? { connected: false } : { connected: true, last: { state: states[next(states.length)]!, at: time(), evidence: "generated" } };
    const extra = { socket, ...(next(2) === 0 ? { log } : {}), ...(next(3) === 0 ? {} : { receipt: time() }) };
    const view = decide("a", sources(now, [LAUNCHER, { ...GAME, started }], extra));
    const said = socket.last !== undefined && socket.last.at >= started ? socket.last : undefined;
    const receipt = extra.receipt !== undefined && extra.receipt >= started ? extra.receipt : undefined;
    const signedIn = extra.log !== undefined && logStart >= started;
    const fresh = { socket: said === undefined ? { connected: false } : socket, ...(signedIn ? { log } : {}), ...(receipt === undefined ? {} : { receipt }) };
    const evidence = `sample ${sample}: ${JSON.stringify(extra.socket)} receipt ${String(extra.receipt)} log ${extra.log !== undefined} started ${started}`;
    expect(view, evidence).toEqual(decide("a", sources(now, [LAUNCHER, { ...GAME, started }], fresh)));
    expect(typesIntoMatch(view), evidence).toBe(view.state.kind === "in match" && said !== undefined);
    const counted = receipt !== undefined && (!signedIn || receipt >= login) ? receipt : undefined;
    if (said === undefined) {
      expect(view.state.kind, evidence).toBe(counted !== undefined && signedIn ? "in match" : signedIn ? "signed in" : "running");
    } else if ((said.state.kind === "lobby" || said.state.kind === "loading") && counted !== undefined) {
      expect(view.state, evidence).toEqual(counted > said.at ? { kind: "in match" } : said.state);
    }
  }
  for (let sample = 0; sample < 200; sample++) {
    const screens = Array.from({ length: 6 }, () => ["MAIN_MENU", "GAME_LOBBY", "LOADING_SCREEN", "DISABLED_SCREEN", "SCORE_SCREEN"][next(5)]!);
    screens.reduce<SocketState>((socket, screen, index) => {
      const after = socketEvent(socket, { messageType: "SetGlueScreen", payload: { screen } }, index);
      if (screen === "DISABLED_SCREEN") expect(after.last?.state.kind === "in match", screens.join(" ")).toBe(socket.last?.state.kind === "loading" || socket.last?.state.kind === "in match");
      return after;
    }, { connected: true });
  }
});
