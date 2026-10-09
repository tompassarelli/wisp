import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { type ProcessInfo, isErrorDialog, launcherHealth, prefixUse } from "../scripts/warcraft/battleNet";
import { ladderScan } from "../scripts/warcraft/war3Log";
import { displayChanges, videoSettings, withDisplaySettings } from "../scripts/warcraft/preferences";
import { diagnose, type Observation } from "../scripts/wisp/doctor";
import { type ClientState, type ClientView, type Source } from "../scripts/wisp/watch";
import { platformLayer } from "../scripts/platform/layer";
import { doctorTargets } from "../scripts/wisp/clientDoctorCommand";
import { pairClients, writePoolClients } from "../scripts/wisp/lan/pool";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/doctor", name), "utf8");
const PLAYED = fixture("launcher-played.log");
const LOST = fixture("launcher-connection-lost.log");
const RECONNECTED = fixture("launcher-reconnected.log");
const REJECTED = fixture("launcher-login-rejected.log");
const BY_HAND = fixture("launcher-signed-in-by-hand.log").split("\n");
const ACCOUNT_PAGE = BY_HAND.slice(0, 5).join("\n") + "\n";
const PASSWORD_PAGE = BY_HAND.slice(5, 13).join("\n") + "\n";
const SIGNED_IN_BY_FORM = BY_HAND.slice(13).join("\n");
const SIGNED_IN = PLAYED.split("\n")[0]! + "\n";
const PREFIX = "/observed/client/pfx";
const gameProcess = (pid: number): ProcessInfo => ({ pid, name: "Warcraft III.ex", args: ["C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\Warcraft III.exe", "-launch", "-uid", "w3"], prefix: PREFIX });
const errorDialog = (pid: number): ProcessInfo => ({ pid, name: "BlizzardError.e", args: ["C:\\Program Files (x86)\\Warcraft III\\_retail_\\x86_64\\BlizzardError.exe"], prefix: PREFIX });
const preferences = (name: string) => readFileSync(join(import.meta.dir, "fixtures/preferences", name), "utf8");
const PRIVATE = preferences("private-desktop.txt");
const MAIN = preferences("main-display.txt");
const DISPLAY = Object.fromEntries(["windowmode", "windowwidth", "windowheight", "windowx", "windowy", "reswidth", "resheight", "refreshrate", "maxfps"].map(key => [key, videoSettings(PRIVATE)[key]!]));

test("[boundary] produced pool declarations round-trip through doctor targets", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const directory = mkdtempSync(join(tmpdir(), "doctor-pool-"));
  try {
    writeFileSync(join(directory, "display"), ":7");
    writeFileSync(join(directory, "xauthority"), "/private/xauthority");
    writeFileSync(join(directory, "wayland-display"), "wayland-0");
    const clients = pairClients(0, { a: directory, b: directory });
    for (const entries of [clients, clients.map((client) => ({ ...client, name: client.name.endsWith("a") ? "a" : "b", poolName: client.name }))]) {
      const clientsFile = join(directory, "clients.json");
      writePoolClients(clientsFile, entries);
      const targets = await Effect.runPromise(doctorTargets({ clientsFile, start: {} }, [entries[0]!.name]).pipe(Effect.provide(platformLayer())));
      expect(targets.map(({ client, display, start }) => ({ name: client.name, display, start }))).toEqual([{ name: entries[0]!.name, display: ":7", start: { kind: "offline-pool" } }]);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("[native] recorded launcher logs: signed in, a lost connection, a reconnect, a rejected saved login", () => {
  expect(launcherHealth(PLAYED)).toEqual({ kind: "signed in" });
  expect(launcherHealth(LOST)).toEqual({ kind: "connection failing", reason: "its last 3 presence updates timed out (ERROR_RPC_REQUEST_TIMED_OUT)" });

  expect(launcherHealth(LOST.split("\n").slice(0, 3).join("\n")).kind).toBe("signed in");
  expect(launcherHealth(RECONNECTED)).toEqual({ kind: "signed in" });
  expect(launcherHealth(REJECTED).kind).toBe("sign-in needed");
  expect(launcherHealth(REJECTED.split("\n")[0]!)).toEqual({ kind: "not signed in" });

  expect(launcherHealth(`${SIGNED_IN}D 2026-10-06 12:33:38.741703 [CatalogVarStorage] {Main} Setting var from catalog Client.DisableLoginCredentialUIRegionList=CN\n`).kind).toBe("signed in");
});

test("[native] the crash dialog is Warcraft III's BlizzardError.exe, not the launcher's copy", () => {
  const crash = fixture("crash-report.txt");
  expect(crash).toContain("\\_retail_\\x86_64\\Warcraft III.exe");
  expect(isErrorDialog(errorDialog(1))).toBe(true);
  expect(isErrorDialog({ ...errorDialog(1), args: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.17896\\BlizzardError.exe"] })).toBe(false);
  expect(isErrorDialog(gameProcess(1))).toBe(false);
});

test("[native] the launcher's sign-in pages, from its UnifiedAuth log", () => {
  expect(launcherHealth(ACCOUNT_PAGE)).toEqual({ kind: "sign-in form", form: "Login" });

  expect(launcherHealth(ACCOUNT_PAGE + BY_HAND.slice(5, 8).join("\n"))).toEqual({ kind: "not signed in" });
  expect(launcherHealth(ACCOUNT_PAGE + PASSWORD_PAGE)).toEqual({ kind: "sign-in form", form: "LoginCredential" });
  expect(launcherHealth(ACCOUNT_PAGE + PASSWORD_PAGE + SIGNED_IN_BY_FORM)).toEqual({ kind: "signed in" });

  expect(launcherHealth(REJECTED + ACCOUNT_PAGE)).toEqual({ kind: "sign-in form", form: "Login" });
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
