import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { AcceptDriver, AcceptFailure, type AcceptReport, type AcceptSuite, type ReceiptFile, planSessions, runAccept, summaryLine, mergeReports, suiteProblems } from "../host/accept/accept";
import cascades from "./fixtures/accept-cascade.json";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

test("[scenario] recorded moves failures skip dependent specials without driving them and preserve separate report counts", async () => {
  const checks: AcceptSuite = {
    maps: { good: { describe: "recorded gate-moves cascade" } },
    checks: [
      { id: "gate-moves", closes: "native cascade", map: "good", session: "gate-moves", setup: [{ chat: "-moves" }], pass: [{ kind: "receipt", pattern: "hello ok", client: "host" }] },
      { id: "gate-specials-spot", after: "gate-moves", closes: "native cascade", map: "good", session: "gate-moves", setup: [{ chat: "-specials" }], pass: [{ kind: "receipt", pattern: "hello ok", client: "host" }] },
    ],
  };
  expect(suiteProblems(checks)).toEqual([]);
  for (const row of [...cascades, { run: "session-start", reason: "session refused" }, { run: "receipt-failure", reason: "missing receipt" }, { run: "unselected-prerequisite", reason: "not selected" }, { run: "success", reason: "" }]) {
    const directory = mkdtempSync(join(tmpdir(), "wisp-cascade-"));
    directories.push(directory);
    const fake = fakeDriver();
    const base = await Effect.runPromise(AcceptDriver.pipe(Effect.provide(fake.layer)));
    const failure = Effect.fail(new AcceptFailure({ operation: "moves gate", problem: row.reason }));
    const driver = AcceptDriver.of({ ...base,
      start: row.run === "session-start" ? () => failure : base.start,
      chat: (client, text) => text === "-moves" && row.reason !== ""
        ? row.run === "receipt-failure" ? Effect.void : failure
        : base.chat(client, text),
    });
    const selected = row.run === "unselected-prerequisite" ? checks.checks.slice(1) : checks.checks;
    const report = await Effect.runPromise(runAccept(checks, planSessions(selected), directory).pipe(Effect.provide(Layer.succeed(AcceptDriver, driver))));
    const special = report.results.find(({ id }) => id === "gate-specials-spot");
    expect(special?.verdict).toBe(row.reason === "" ? "pass" : "skipped");
    if (row.reason !== "") {
      expect(special?.reason).toBe("gate-moves did not pass");
      expect(fake.calls).not.toContain("chat host -specials");
      expect(report.counts.skipped).toBe(1);
      expect(report.counts.fail).toBe(row.run === "unselected-prerequisite" ? 0 : 1);
      expect(summaryLine(report.results)).toContain("1 skipped");
    } else expect(fake.calls).toContain("chat host -specials");
    const saved = JSON.parse(readFileSync(join(directory, "report.json"), "utf8")) as AcceptReport;
    expect(saved.counts).toEqual(report.counts);
    const merged = mergeReports(directory, selected, [saved], 0, 1, () => { throw new Error("missing result"); });
    expect(merged.counts).toEqual(report.counts);
  }
});

test("[scenario] an acceptance held-key step keeps its declared duration through the driver", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-accept-hold-"));
  directories.push(directory);
  const fake = fakeDriver();
  const base = await Effect.runPromise(AcceptDriver.pipe(Effect.provide(fake.layer)));
  const driver = AcceptDriver.of({ ...base, keys: (client, keys, holdMs) => Effect.sync(() => { fake.calls.push(`keys ${client} ${keys.join(" ")} held ${holdMs} ms`); }) });
  const suite: AcceptSuite = {
    maps: { good: { describe: "held-key acceptance step" } },
    checks: [{ id: "held-hop", closes: "native input timing", map: "good", setup: [{ keys: ["z"], client: "a", holdMs: 120 }], look: "the character performs a full hop" }],
  };
  const report = await Effect.runPromise(runAccept(suite, planSessions(suite.checks), directory).pipe(Effect.provide(Layer.succeed(AcceptDriver, driver))));
  expect(fake.calls).toContain("keys a z held 120 ms");
  expect(report.results[0]?.verdict).toBe("needs-look");
});

test("[scenario] a frames capture with a press takes its first frame before the held keys are released", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-accept-press-"));
  directories.push(directory);
  const fake = fakeDriver();
  const base = await Effect.runPromise(AcceptDriver.pipe(Effect.provide(fake.layer)));
  const driver = AcceptDriver.of({
    ...base,
    keys: (client, keys, holdMs) => Effect.sync(() => { fake.calls.push(`press ${client} ${keys.join(" ")} held ${holdMs} ms`); }).pipe(Effect.andThen(Effect.sleep("40 millis")), Effect.andThen(Effect.sync(() => { fake.calls.push("release"); }))),
    capture: () => Effect.sync(() => { fake.calls.push("frame"); return { width: 1, height: 1, rgb: new Uint8Array(3) }; }),
  });
  const suite: AcceptSuite = {
    maps: { good: { describe: "a short move captured from its key press" } },
    checks: [{ id: "jab", closes: "native input timing", map: "good", capture: [{ kind: "frames", name: "jab", client: "a", count: 3, everyMs: 30, press: { keys: ["n"], holdMs: 60 } }], look: "the jab's windup and contact" }],
  };
  expect(suiteProblems(suite, ["a"])).toEqual([]);
  expect(suiteProblems({ ...suite, checks: [{ ...suite.checks[0]!, capture: [{ kind: "frames", name: "jab", press: { keys: ["n"], client: "z", holdMs: 0 } }] }] }, ["a"])).toEqual(["jab: unknown client z", "jab: held keys need a positive finite holdMs"]);
  const report = await Effect.runPromise(runAccept(suite, planSessions(suite.checks), directory).pipe(Effect.provide(Layer.succeed(AcceptDriver, driver))));
  const driven = fake.calls.filter((call) => call === "frame" || call === "release" || call.startsWith("press"));
  expect(driven.slice(0, 3)).toEqual(["frame", "press a n held 60 ms", "frame"]);
  expect(driven.indexOf("release")).toBeGreaterThan(driven.indexOf("frame"));
  expect(report.results[0]?.files.filter((file) => file.endsWith(".ppm"))).toEqual(["jab-a-00.ppm", "jab-a-01.ppm", "jab-a-02.ppm"]);
});

const suite: AcceptSuite = {
  maps: { broken: { describe: "a map whose session can't start" }, good: { describe: "a map that starts" } },
  checks: [
    { id: "broken-a", closes: "wisp#1", map: "broken", pass: [{ kind: "receipt", pattern: "never" }] },
    { id: "good-receipt", closes: "wisp#2", map: "good", setup: [{ chat: "-greet" }, { receipt: "hello", seconds: 1 }], pass: [{ kind: "receipt", pattern: "hello ok", client: "host", min: 1, max: 1 }] },
    { id: "good-log", closes: "wisp#3", map: "good", pass: [{ kind: "log", pattern: "never written" }] },
    { id: "good-look", closes: "wisp#4", map: "good", pass: [{ kind: "log", pattern: "never written", orLook: true }] },
  ],
};

function fakeDriver() {
  const calls: string[] = [];
  let clock = 10;
  const receipts = new Map<string, ReceiptFile[]>([["host", [{ name: "stale.txt", text: "hello ok\n", modified: 1 }]], ["guest", []]]);
  const driver = AcceptDriver.of({
    clients: ["host", "guest"],
    prepare: Effect.sync(() => { calls.push("prepare"); }),
    start: (map) => map === "broken"
      ? Effect.sync(() => { calls.push(`start ${map}`); }).pipe(Effect.andThen(Effect.fail(new AcceptFailure({ operation: `start ${map}`, problem: "lobby refused" }))))
      : Effect.sync(() => { calls.push(`start ${map}`); }),
    chat: (client, text) => Effect.sync(() => {
      calls.push(`chat ${client} ${text}`);
      receipts.set(client, [...(receipts.get(client) ?? []), { name: `greet-${++clock}.txt`, text: "hello ok\n", modified: clock }]);
    }),
    keys: (client, keys) => Effect.sync(() => { calls.push(`keys ${client} ${keys.join(" ")}`); }),
    capture: () => Effect.fail(new AcceptFailure({ operation: "capture", problem: "no desktop" })),
    read: () => Effect.fail(new AcceptFailure({ operation: "read", problem: "no desktop" })),
    receipts: (client) => Effect.sync(() => receipts.get(client) ?? []),
    log: () => Effect.succeed(""),
    state: (client) => Effect.sync(() => { calls.push(`state ${client}`); return client === "host" ? "menus" : "crashed"; }),
  });
  return { calls, layer: Layer.succeed(AcceptDriver, driver) };
}

test("[scenario] accept fails every check of a session that can't start without driving it, counts only receipts written during a check, and judges the remaining sessions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-accept-"));
  directories.push(directory);
  const { calls, layer } = fakeDriver();
  const report = await Effect.runPromise(runAccept(suite, planSessions(suite.checks), directory).pipe(Effect.provide(layer)));
  expect(calls).toEqual(["prepare", "start broken", "state host", "state guest", "prepare", "start good", "chat host -greet"]);
  const verdicts = Object.fromEntries(report.results.map(({ id, verdict, reason }) => [id, { verdict, reason }]));
  expect(verdicts["broken-a"]).toEqual({ verdict: "fail", reason: "session did not start: start broken: lobby refused (host: menus; guest: crashed)" });
  expect(verdicts["good-receipt"]?.verdict).toBe("pass");
  expect(verdicts["good-log"]?.verdict).toBe("fail");
  expect(verdicts["good-look"]?.verdict).toBe("needs-look");
  const saved = JSON.parse(readFileSync(join(directory, "report.json"), "utf8")) as AcceptReport;
  expect(saved.results.map(({ id }) => id)).toEqual(["broken-a", "good-receipt", "good-log", "good-look"]);
});
