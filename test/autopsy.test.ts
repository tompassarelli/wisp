import { expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { DesyncReports, bornAs, classOf, groupReports, pollerAccess, runAutopsy, withAutopsy } from "../scripts/wisp/engine/autopsy";

// #158's desync on turn 921: the clients' Desync.logs (wisp engine's fixtures)
// and Desync.txt reports, and both clients' presence polls over two games.
const engine = join(import.meta.dir, "fixtures/engine");
const fixtures = join(import.meta.dir, "fixtures/autopsy");
const DESYNC_WRITTEN = Date.parse("2026-10-07T01:53:36.000Z");

/** A Documents/Warcraft III folder per client holding #158's report as the game writes it. */
function documents(root: string, client: "a" | "b", log = `${client}_Desync.log`, written = DESYNC_WRITTEN) {
  const docs = join(root, client, "Documents", "Warcraft III");
  const folder = join(docs, "Errors", `2026-10-07 02.53.36 ${client === "a" ? "4137f220" : "2983c438"}`);
  mkdirSync(folder, { recursive: true });
  copyFileSync(join(fixtures, `${client}-Desync.txt`), join(folder, "Desync.txt"));
  copyFileSync(join(engine, log), join(folder, `WHITERABBIT_100726_025200_Desync.log`));
  for (const name of ["Desync.txt", "WHITERABBIT_100726_025200_Desync.log"]) utimesSync(join(folder, name), written / 1000, written / 1000);
  return { docs, folder };
}

function pollDirectory(root: string) {
  const directory = join(root, "presence");
  mkdirSync(directory, { recursive: true });
  for (const client of ["a", "b"]) copyFileSync(join(fixtures, `${client}.presence.log`), join(directory, `${client}.log`));
  return directory;
}

test("the autopsy names #158's CScriptFunc birth on the client that made it a turn early, and saves the evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "autopsy-"));
  const a = documents(root, "a");
  const b = documents(root, "b");
  const out = join(root, "evidence");
  const result = runAutopsy({
    reports: [{ client: "a", folder: a.folder, written: DESYNC_WRITTEN }, { client: "b", folder: b.folder, written: DESYNC_WRITTEN }],
    pollDirectory: pollDirectory(root),
    out,
  });
  expect(result.lines[0]).toBe("first divergent birth #6279 CScriptFunc at turn 921 on client a");
  expect(result.finding?.divergence).toMatchObject({ kind: "birth", birth: 6279, turn: 921, client: "a", other: "b", births: [6280, 6279] });
  expect(result.lines).toContain(`evidence: ${out}`);
  const report = readFileSync(join(out, "autopsy.txt"), "utf8");
  expect(report).toContain("first difference: turn 921, section ipse");
  expect(report).toContain("A a.log:");
  for (const client of ["a", "b"]) {
    for (const name of ["Desync.txt", "WHITERABBIT_100726_025200_Desync.log", "presence.log"]) expect(existsSync(join(out, client, name))).toBe(true);
  }
});

test("without a presence poll the autopsy still names the birth, turn and client from the Desync.logs", () => {
  const root = mkdtempSync(join(tmpdir(), "autopsy-"));
  const a = documents(root, "a");
  const b = documents(root, "b");
  const result = runAutopsy({ reports: [{ client: "a", folder: a.folder, written: DESYNC_WRITTEN }, { client: "b", folder: b.folder, written: DESYNC_WRITTEN }], pollDirectory: undefined, out: join(root, "evidence") });
  expect(result.lines[0]).toBe("first divergent birth #6279 (class unknown: no poll log of that birth) at turn 921 on client a");
  expect(result.lines.some((line) => line.includes("no presence poll this session"))).toBe(true);
});

test("a birth number seen in two games resolves to the game that desynced", () => {
  const text = readFileSync(join(fixtures, "a.presence.log"), "utf8");
  const desynced = bornAs(text, 6279, DESYNC_WRITTEN);
  expect(desynced?.seconds).toBe(475.623);
  expect(desynced === undefined ? undefined : classOf(desynced)).toBe("CScriptFunc");
  const earlier = bornAs(text, 6279, Date.parse("2026-10-07T01:45:50.000Z"));
  expect(earlier?.seconds).toBe(6.489);
  expect(earlier?.owner).toBeUndefined();
});

test("a desync outside Tempest's presence table names its section", () => {
  const root = mkdtempSync(join(tmpdir(), "autopsy-"));
  const a = documents(root, "a", "rand-a_Desync.log");
  const b = documents(root, "b", "rand-b_Desync.log");
  const result = runAutopsy({ reports: [{ client: "a", folder: a.folder, written: DESYNC_WRITTEN }, { client: "b", folder: b.folder, written: DESYNC_WRITTEN }], pollDirectory: undefined, out: join(root, "evidence") });
  expect(result.lines[0]).toBe("first divergence at turn 498 in section rand, not Tempest's presence table");
});

test("only reports written after the start count, crash reports are skipped, and each desync pairs one report per client", () => {
  const root = mkdtempSync(join(tmpdir(), "autopsy-"));
  const old = Date.parse("2026-10-06T12:00:00.000Z");
  const docsA = documents(root, "a", "a_Desync.log", old).docs;
  const docsB = documents(root, "b", "b_Desync.log", old).docs;
  const reports = new DesyncReports([{ name: "a", documents: docsA }, { name: "b", documents: docsB }]);
  expect(reports.fresh()).toEqual([]);
  const crash = join(docsA, "Errors", "2026-10-07 03.00.00 deadbeef");
  mkdirSync(crash);
  writeFileSync(join(crash, "Crash.txt"), "crash");
  const later = Date.now() - 10_000;
  const newA = join(docsA, "Errors", "2026-10-07 03.10.00 aaaaaaaa");
  const newB = join(docsB, "Errors", "2026-10-07 03.10.00 bbbbbbbb");
  for (const [folder, log] of [[newA, "a_Desync.log"], [newB, "b_Desync.log"]] as const) {
    mkdirSync(folder);
    copyFileSync(join(engine, log), join(folder, "X_Desync.log"));
    copyFileSync(join(fixtures, "a-Desync.txt"), join(folder, "Desync.txt"));
    for (const name of ["X_Desync.log", "Desync.txt"]) utimesSync(join(folder, name), later / 1000, later / 1000);
  }
  const fresh = reports.fresh();
  expect(fresh.map(({ client, folder }) => [client, folder])).toEqual([["a", newA], ["b", newB]]);
  expect(reports.fresh()).toEqual([]);
  expect(groupReports([...fresh, { client: "a", folder: "next", written: later + 60_000 }]).map((group) => group.map(({ client }) => client))).toEqual([["a", "b"], ["a"]]);
});

test("the poller runs only where the machine lets it read the clients, and otherwise one line names the sysctl", () => {
  const clients = [{ name: "a", prefix: "/pa" }, { name: "b", prefix: "/pb" }];
  expect(pollerAccess("0\n", () => false, clients)).toEqual({ readable: clients, problem: undefined });
  expect(pollerAccess("1\n", () => true, clients)).toEqual({ readable: clients, problem: undefined });
  const access = pollerAccess("1\n", (client) => client.name === "a", clients);
  expect(access.readable.map(({ name }) => name)).toEqual(["a"]);
  const line = access.problem ?? "";
  expect(line).toContain("client b");
  expect(line).toContain("kernel.yama.ptrace_scope=1");
  expect(line).toContain("sudo sysctl kernel.yama.ptrace_scope=0");
  expect(line.includes("\n")).toBe(false);
});

test("a session wrapped in the autopsy prints the finding for a desync written while it runs, then its summary", async () => {
  const root = mkdtempSync(join(tmpdir(), "autopsy-"));
  const docsA = join(root, "a", "Documents", "Warcraft III");
  const docsB = join(root, "b", "Documents", "Warcraft III");
  mkdirSync(join(docsA, "Errors"), { recursive: true });
  mkdirSync(join(docsB, "Errors"), { recursive: true });
  const clientsFile = join(root, "clients.json");
  writeFileSync(clientsFile, JSON.stringify({ clients: [{ name: "a", documents: docsA }, { name: "b", documents: docsB }] }));
  const printed: string[] = [];
  // The game writes both reports during the session, a second before its end.
  const session = Effect.gen(function*() {
    yield* Effect.sleep("200 millis");
    yield* Effect.sync(() => {
      const written = Date.now() - 2_000;
      documents(root, "a", "a_Desync.log", written);
      documents(root, "b", "b_Desync.log", written);
    });
    yield* Effect.sleep("1200 millis");
    return "ran";
  });
  const value = await Effect.runPromise(withAutopsy({ clientsFile, print: (line) => printed.push(line), root: join(root, "sessions"), poll: false }, session));
  expect(value).toBe("ran");
  const found = printed.filter((line) => line.includes("first divergent birth #6279"));
  // Once when found during the run, once in the summary.
  expect(found).toEqual([
    "desync autopsy: first divergent birth #6279 (class unknown: no poll log of that birth) at turn 921 on client a",
    "  first divergent birth #6279 (class unknown: no poll log of that birth) at turn 921 on client a",
  ]);
  expect(printed).toContain("desync autopsy summary:");
}, 10_000);
