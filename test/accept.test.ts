import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { AcceptDriver, AcceptFailure, type AcceptReport, type AcceptSuite, type ReceiptFile, planSessions, runAccept } from "../scripts/wisp/accept";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
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
