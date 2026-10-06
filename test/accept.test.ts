// `wisp accept` against a fake pair of clients. The War3Logs are the 6 Oct
// recordings in fixtures/war3log: a map loaded during the ladder scan
// (loadfile-scan-mid-load.txt, import failures) and one hosted after it
// (menus-after-scan.txt, none).
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Layer } from "effect";
import { expect, test } from "bun:test";
import { AcceptDriver, AcceptFailure, type AcceptSuite, type NativeCheck, cropFrame, describePlan, planSessions, runAccept, selectChecks, suiteProblems } from "../scripts/wisp/accept";
import { makeAccept } from "../scripts/wisp/commands/accept";
import { decodePpm, type Frame } from "../scripts/wisp/frameProbe";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/war3log", name), "utf8");
/** The log up to its first import failure (signed in, the map not yet loaded), and whole. */
const loadLog = (name: string) => {
  const log = fixture(name);
  const cut = log.indexOf("model creation failed");
  return { before: cut < 0 ? log : log.slice(0, log.lastIndexOf("\n", cut) + 1), after: log };
};

const CENTRE = { x: 10, y: 5, width: 20, height: 10 };
const check = (id: string, map: string, rest: Partial<NativeCheck> = {}): NativeCheck => ({ id, closes: `game#${id.split("-")[0]} box 2`, map, ...rest });
const effect = (n: number, rest: Partial<NativeCheck> = {}) => check(`82-effects-${n}`, "effects", {
  setup: [{ chat: `-dev effects ${n}` }, { receipt: "^GAME DEV receipt=\\d+" }],
  capture: [
    { kind: "frames", name: "centre", region: CENTRE, count: 3, everyMs: 5 },
    { kind: "reading", name: "label", region: { x: 0, y: 20, width: 40, height: 10 }, pattern: `dev: effects ${n} (\\S+)` },
  ],
  pass: [{ kind: "receipt", pattern: "^GAME DEV", client: "a", min: 1, max: 1 }, { kind: "reading", name: "label", pattern: "Impact", orLook: true }],
  look: "a flash at stage centre",
  ...rest,
});

const suite: AcceptSuite = {
  maps: { effects: { describe: "dev map, quick match" }, underside: { describe: "underside scenario" }, primary: { describe: "loads through -loadfile" } },
  measures: { brightRows: (frame) => frame.height },
  checks: [
    effect(12),
    check("57-underside", "underside", { capture: [{ kind: "measure", name: "edge", measure: "brightRows" }], pass: [{ kind: "reading", name: "edge", min: 20, max: 40 }] }),
    effect(2, { pass: [{ kind: "receipt", pattern: "^GAME DEV", client: "a" }, { kind: "reading", name: "label", pattern: "BoltImpact", orLook: true }] }),
    check("73-load", "primary", { pass: [{ kind: "log", pattern: "^model creation failed - war3mapImported", since: "session", max: 0 }] }),
    check("73-load-fresh", "primary", { session: "second", pass: [{ kind: "log", pattern: "^model creation failed", since: "session", max: 0 }] }),
  ],
};

test("checks group by map and session, maps in declared order, checks in declared order", () => {
  const sessions = planSessions(suite.checks);
  expect(sessions.map(({ map, session, checks }) => `${map}/${session}: ${checks.map(({ id }) => id).join(",")}`)).toEqual([
    "effects/shared: 82-effects-12,82-effects-2",
    "underside/shared: 57-underside",
    "primary/shared: 73-load",
    "primary/second: 73-load-fresh",
  ]);
  expect(selectChecks(suite, ["82-*", "73-load"]).checks.map(({ id }) => id)).toEqual(["82-effects-12", "82-effects-2", "73-load"]);
  expect(selectChecks(suite, ["96-*"]).unknown).toEqual(["96-*"]);
  const plan = describePlan(suite, planSessions(selectChecks(suite, ["82-effects-12"]).checks), "a");
  expect(plan).toEqual([
    "1 check in 1 session",
    "session 1/1: effects (shared): dev map, quick match",
    "  82-effects-12  game#82 box 2",
    "    do       chat a: -dev effects 12",
    "    do       wait for receipt a /^GAME DEV receipt=\\d+/ (10 s)",
    "    capture  frames centre a 20x10+10+5 x3 every 5 ms",
    "    capture  reading label a 40x10+0+20 /dev: effects 12 (\\S+)/",
    "    pass     receipt a /^GAME DEV/ = 1",
    "    pass     reading label /Impact/ (else look)",
    "    look     a flash at stage centre",
  ]);
});

test("declarations with unknown maps, measures, clients or readings, or duplicate ids, are refused", () => {
  const bad: AcceptSuite = {
    maps: { m: { describe: "" } },
    checks: [
      check("1", "m", { capture: [{ kind: "measure", name: "x", measure: "nope" }], pass: [{ kind: "reading", name: "y", min: 1 }] }),
      check("1", "missing", { setup: [{ chat: "hi", client: "c" }], look: "it" }),
      check("2", "m", { pass: [{ kind: "log", pattern: "(" }] }),
      check("3", "m"),
    ],
  };
  expect(suiteProblems(bad, ["a", "b"])).toEqual([
    "1: unknown measure nope",
    "1: rule reads y, which no capture takes",
    "1: declared twice",
    "1: unknown map profile missing",
    "1: unknown client c",
    "2: pattern ( is not a regular expression",
    "3: no pass rule and nothing to look at",
  ]);
  expect(suiteProblems(suite, ["a", "b"])).toEqual([]);
});

test("cropping keeps the region's pixels", () => {
  const frame: Frame = { width: 4, height: 3, rgb: Uint8Array.from({ length: 36 }, (_, i) => i) };
  const cropped = cropFrame(frame, { x: 1, y: 1, width: 2, height: 5 });
  expect([cropped.width, cropped.height]).toEqual([2, 2]);
  expect([...cropped.rgb]).toEqual([15, 16, 17, 18, 19, 20, 27, 28, 29, 30, 31, 32]);
});

/** Two fake clients: chat writes the game's receipt, the start of a map writes its War3Log. */
const fakeClients = (options: { readonly badStart?: string } = {}) => {
  const calls: string[] = [];
  let tick = 0;
  let receipts = 0;
  const files = new Map<string, { name: string; text: string; modified: number }[]>([["a", []], ["b", []]]);
  const logs = new Map([["a", loadLog("menus-after-scan.txt").before], ["b", loadLog("menus-after-scan.txt").before]]);
  let screen = "";
  const layer = Layer.succeed(AcceptDriver, AcceptDriver.of({
    clients: ["a", "b"],
    prepare: Effect.sync(() => void calls.push("prepare")),
    start: (map, session) => Effect.gen(function*() {
      calls.push(`start ${map}/${session}`);
      if (map === options.badStart) return yield* new AcceptFailure({ operation: `start ${map}`, problem: "lobby never filled" });
      const log = loadLog(map === "primary" ? "loadfile-scan-mid-load.txt" : "menus-after-scan.txt");
      // A map loading in the running Warcraft III appends its load; one in a new launch starts a new log.
      for (const client of ["a", "b"]) {
        const current = logs.get(client)!;
        logs.set(client, current.startsWith(log.before) ? current + log.after.slice(log.before.length) : log.after);
      }
    }),
    chat: (client, text) => Effect.sync(() => {
      calls.push(`chat ${client} ${text}`);
      const effect = /^-dev effects (\d+)$/.exec(text);
      if (effect === null) return;
      receipts++;
      for (const [name, list] of files) {
        const text = `function PreloadFiles takes nothing returns nothing\r\n\tcall PreloadStart()\r\n\tcall Preload( "GAME DEV receipt=${receipts} " )\r\n\tcall PreloadEnd( 0.0 )\r\n\r\nendfunction\r\n`;
        list.splice(0, list.length, { name: `game-dev-p${name === "a" ? 0 : 1}.txt`, text, modified: ++tick });
      }
      screen = `dev: effects ${effect[1]} ${effect[1] === "2" ? "Abilities\\Weapons\\Bolt\\BoltImpact.mdl" : "Objects\\Spawnmodels\\Impact.mdl"} sound`;
    }),
    keys: (client, keys) => Effect.sync(() => void calls.push(`keys ${client} ${keys.join(" ")}`)),
    capture: () => Effect.succeed({ width: 40, height: 30, rgb: new Uint8Array(40 * 30 * 3).fill(200) }),
    read: (client) => Effect.succeed(client === "a" ? `[gibberish] ${screen}` : ""),
    receipts: (client) => Effect.sync(() => [...files.get(client)!]),
    log: (client) => Effect.sync(() => logs.get(client)!),
    state: () => Effect.succeed("in match, by socket: SetGlueScreen"),
  }));
  return { calls, layer };
};

const tempDirectory = () => mkdtempSync(join(tmpdir(), "wisp-accept-"));

test("a run plays each session once, keeps each check's evidence privately and judges it", async () => {
  const { calls, layer } = fakeClients();
  const directory = join(tempDirectory(), "run");
  const report = await Effect.runPromise(runAccept(suite, planSessions(suite.checks), directory).pipe(Effect.provide(layer)));
  expect(calls.filter((call) => call.startsWith("start"))).toEqual(["start effects/shared", "start underside/shared", "start primary/shared", "start primary/second"]);
  expect(calls.filter((call) => call === "prepare")).toHaveLength(4);
  const byId = Object.fromEntries(report.results.map((result) => [result.id, result]));
  // The receipt and the label hold; a visual effect still needs the owner's look.
  expect(byId["82-effects-12"]).toMatchObject({ verdict: "needs-look", reason: "look: a flash at stage centre", readings: { label: "Objects\\Spawnmodels\\Impact.mdl" } });
  expect(byId["82-effects-2"]?.verdict).toBe("needs-look");
  expect(byId["57-underside"]).toMatchObject({ verdict: "pass", readings: { edge: 30 } });
  // The -loadfile run's map loaded during the ladder scan: its imports failed.
  expect(byId["73-load"]).toMatchObject({ verdict: "fail" });
  expect(byId["73-load"]?.reason).toContain("a 7 (first: model creation failed - war3mapImported");
  expect(statSync(directory).mode & 0o777).toBe(0o700);
  const evidence = byId["82-effects-12"]!.evidence;
  expect(readdirSync(evidence).sort()).toEqual(["centre-a-00.ppm", "centre-a-01.ppm", "centre-a-02.ppm", "check.json", "label-a.txt", "receipts-a.txt", "receipts-b.txt", "war3log-a.txt", "war3log-b.txt"]);
  const frame = decodePpm(readFileSync(join(evidence, "centre-a-00.ppm")));
  expect([frame?.width, frame?.height]).toEqual([20, 10]);
  expect(readFileSync(join(evidence, "receipts-a.txt"), "utf8")).toBe("GAME DEV receipt=1 \n");
  expect(readFileSync(join(directory, "report.txt"), "utf8")).toContain("5 checks: 1 pass, 2 fail, 2 needs-look");
  expect(JSON.parse(readFileSync(join(directory, "report.json"), "utf8")).results).toHaveLength(5);
});

test("a rule a screen reading can't confirm asks for a look; a session that can't start fails its checks and the run goes on", async () => {
  const { layer } = fakeClients({ badStart: "underside" });
  const misread: AcceptSuite = { ...suite, checks: [effect(12, { pass: [{ kind: "reading", name: "label", pattern: "Bolt", orLook: true }], look: undefined }), ...suite.checks.slice(1, 2), suite.checks[3]!] };
  const report = await Effect.runPromise(runAccept(misread, planSessions(misread.checks), join(tempDirectory(), "run")).pipe(Effect.provide(layer)));
  expect(report.results.map(({ id, verdict }) => `${id} ${verdict}`)).toEqual(["82-effects-12 needs-look", "57-underside fail", "73-load fail"]);
  expect(report.results[0]?.reason).toContain('read "Objects\\\\Spawnmodels\\\\Impact.mdl"');
  expect(report.results[1]?.reason).toBe("session did not start: start underside: lobby never filled (a: in match, by socket: SetGlueScreen; b: in match, by socket: SetGlueScreen)");
});

test("wisp accept prints the plan for --dry-run without its driver, and fails a run with a failed check", async () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (line: string) => void lines.push(line);
  try {
    const neverBuilt = Layer.effect(AcceptDriver, Effect.die("a dry run builds no driver"));
    const accept = makeAccept({ suite, evidenceRoot: tempDirectory(), driver: neverBuilt, clients: ["a", "b"] });
    await Effect.runPromise(accept(["--only", "73-*", "--dry-run"]));
    expect(lines).toEqual([
      "2 checks in 2 sessions",
      "session 1/2: primary (shared): loads through -loadfile",
      "  73-load  game#73 box 2",
      "    pass     War3Log every client /^model creation failed - war3mapImported/ since session <= 0",
      "session 2/2: primary (second): loads through -loadfile",
      "  73-load-fresh  game#73 box 2",
      "    pass     War3Log every client /^model creation failed/ since session <= 0",
    ]);
    const unknown = await Effect.runPromiseExit(accept(["--only", "99"]));
    expect(Exit.isFailure(unknown) && String(unknown.cause)).toContain("no declared check matches 99");

    lines.length = 0;
    const root = tempDirectory();
    const run = await Effect.runPromiseExit(makeAccept({ suite, evidenceRoot: root, driver: fakeClients().layer, clients: ["a", "b"] })(["--only", "57-underside", "73-load"]));
    expect(Exit.isFailure(run) && String(run.cause)).toContain("1 failed: 73-load");
    expect(lines.filter((line) => /^(PASS|FAIL|NEEDS-LOOK)/.test(line)).map((line) => line.split(/\s+/).slice(0, 2).join(" "))).toEqual(["PASS 57-underside", "FAIL 73-load"]);
    const [runFolder] = readdirSync(root);
    expect(existsSync(join(root, runFolder!, "57-underside", "edge-a.ppm"))).toBe(true);
  } finally {
    console.log = log;
  }
});

test("the live driver reads receipts and War3Log from each client's Documents and runs without a watch", async () => {
  const { Clients } = await import("../scripts/wisp/clients");
  const { GameFiles } = await import("../scripts/wisp/gameFiles");
  const { liveAcceptDriver } = await import("../scripts/wisp/acceptLive");
  const stored = new Map([
    ["/a/Documents/Warcraft III/CustomMapData/game-dev-p0.txt", "receipt"],
    ["/a/Documents/Warcraft III/CustomMapData/other.txt", "other"],
    ["/a/Documents/Warcraft III/Logs/War3Log.txt", "log"],
  ]);
  const chats: string[] = [];
  const clients = Layer.succeed(Clients, Clients.of({
    all: [{ name: "a", documents: "/a/Documents/Warcraft III" }],
    read: () => Effect.succeed(""),
    capture: () => Effect.succeed({ width: 1, height: 1, rgb: new Uint8Array(3) }),
    words: () => Effect.succeed([]),
    click: () => Effect.void,
    keys: () => Effect.void,
    typeText: () => Effect.void,
    batch: (_, actions) => Effect.sync(() => void chats.push(actions.map((action) => (action.kind === "text" ? action.text : action.kind === "keys" ? action.keys.join("+") : action.kind)).join(" "))),
  }));
  const files = Layer.succeed(GameFiles, GameFiles.of({
    read: (path) => Effect.succeed(stored.has(path) ? { text: stored.get(path)!, modified: 1 } : undefined),
    write: () => Effect.void,
    replace: () => Effect.void,
    list: () => Effect.succeed(["game-dev-p0.txt", "other.txt"]),
    remove: () => Effect.void,
    installMap: () => Effect.void,
  }));
  const started: string[] = [];
  const driver = liveAcceptDriver({ start: (map, session) => Effect.sync(() => void started.push(`${map}/${session}`)), receipt: (name) => name.startsWith("game-dev-") }).pipe(Layer.provide(Layer.mergeAll(clients, files)));
  const seen = await Effect.runPromise(Effect.gen(function*() {
    const live = yield* AcceptDriver;
    yield* live.prepare;
    yield* live.start("m", "shared");
    yield* live.chat("a", "-dev effects 12");
    return { receipts: yield* live.receipts("a"), log: yield* live.log("a"), state: yield* live.state("a") };
  }).pipe(Effect.provide(driver)));
  expect(seen).toEqual({ receipts: [{ name: "game-dev-p0.txt", text: "receipt", modified: 1 }], log: "log", state: "not watched" });
  expect(started).toEqual(["m/shared"]);
  expect(chats).toEqual(["Return -dev effects 12 Return"]);
});
