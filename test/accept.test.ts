// `wisp accept` against a fake pair of clients whose War3Log is the 6 Oct
// recording in fixtures/war3log of a map loaded during the ladder scan
// (loadfile-scan-mid-load.txt, import failures; smashcraft#73).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { expect, test } from "bun:test";
import { AcceptDriver, type AcceptSuite, planSessions, runAccept } from "../scripts/wisp/accept";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/war3log", name), "utf8");

const suite: AcceptSuite = {
  maps: { primary: { describe: "loads through -loadfile" } },
  checks: [{ id: "73-load", closes: "game#73 box 2", map: "primary", pass: [{ kind: "log", pattern: "^model creation failed - war3mapImported", since: "session", max: 0 }] }],
};

/** Two fake clients: the start of a map writes the recorded War3Log. */
const fakeClients = () => {
  const recorded = fixture("loadfile-scan-mid-load.txt");
  const signedIn = recorded.slice(0, recorded.lastIndexOf("\n", recorded.indexOf("model creation failed")) + 1);
  let log = signedIn;
  return Layer.succeed(AcceptDriver, AcceptDriver.of({
    clients: ["a", "b"],
    prepare: Effect.void,
    start: () => Effect.sync(() => { log = recorded; }),
    chat: () => Effect.void,
    keys: () => Effect.void,
    capture: () => Effect.succeed({ width: 1, height: 1, rgb: new Uint8Array(3) }),
    read: () => Effect.succeed(""),
    receipts: () => Effect.succeed([]),
    log: () => Effect.sync(() => log),
    state: () => Effect.succeed("in match"),
  }));
};

test("[native] a map loaded during the ladder scan fails its no-import-failure check (smashcraft#73)", async () => {
  const directory = join(mkdtempSync(join(tmpdir(), "wisp-accept-")), "run");
  const report = await Effect.runPromise(runAccept(suite, planSessions(suite.checks), directory).pipe(Effect.provide(fakeClients())));
  const [result] = report.results;
  expect(result).toMatchObject({ id: "73-load", verdict: "fail" });
  expect(result?.reason).toContain("a 7 (first: model creation failed - war3mapImported");
});
