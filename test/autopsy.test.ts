import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bornAs, classOf, runAutopsy } from "../scripts/wisp/engine/autopsy";

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

test("[native] the autopsy names #158's CScriptFunc birth on the client that made it a turn early", () => {
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
  const report = readFileSync(join(out, "autopsy.txt"), "utf8");
  expect(report).toContain("first difference: turn 921, section ipse");
});

test("[native] without a presence poll the autopsy still names the birth, turn and client from the Desync.logs", () => {
  const root = mkdtempSync(join(tmpdir(), "autopsy-"));
  const a = documents(root, "a");
  const b = documents(root, "b");
  const result = runAutopsy({ reports: [{ client: "a", folder: a.folder, written: DESYNC_WRITTEN }, { client: "b", folder: b.folder, written: DESYNC_WRITTEN }], pollDirectory: undefined, out: join(root, "evidence") });
  expect(result.lines[0]).toBe("first divergent birth #6279 (class unknown: no poll log of that birth) at turn 921 on client a");
});

test("[native] a birth number seen in two games resolves to the game that desynced", () => {
  const text = readFileSync(join(fixtures, "a.presence.log"), "utf8");
  const desynced = bornAs(text, 6279, DESYNC_WRITTEN);
  expect(desynced?.seconds).toBe(475.623);
  expect(desynced === undefined ? undefined : classOf(desynced)).toBe("CScriptFunc");
  const earlier = bornAs(text, 6279, Date.parse("2026-10-07T01:45:50.000Z"));
  expect(earlier?.seconds).toBe(6.489);
  expect(earlier?.owner).toBeUndefined();
});
