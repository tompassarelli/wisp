// The saved War3Preferences.txt goes back over the one the game rewrote on exit,
// by the detached helper `play` starts (wisp:scripts/wisp/restorePreferences.ts),
// on real files.
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preferencesBackupPath, preferencesPath, restorePreferences, withGraphicsMode } from "../scripts/warcraft/preferences";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/preferences", name), "utf8");

test("the helper waits for the game's process, then puts the saved file back and removes the backup", async () => {
  const documents = mkdtempSync(join(tmpdir(), "wisp-preferences-"));
  writeFileSync(preferencesBackupPath(documents), fixture("private-desktop.txt"));
  writeFileSync(preferencesPath(documents), fixture("main-display.txt"));
  const game = Bun.spawn(["sleep", "1"]);
  const helper = Bun.spawn([process.execPath, join(import.meta.dir, "../scripts/wisp/restorePreferences.ts"), String(game.pid), documents], { stdout: "pipe" });
  await Bun.sleep(300);
  expect(readFileSync(preferencesPath(documents), "utf8")).toBe(fixture("main-display.txt"));
  await game.exited;
  expect((await new Response(helper.stdout).text()).trim()).toBe("restored War3Preferences.txt");
  expect(readFileSync(preferencesPath(documents), "utf8")).toBe(fixture("private-desktop.txt"));
  expect(existsSync(preferencesBackupPath(documents))).toBe(false);
});

test("without a backup the file the game wrote stays", async () => {
  const documents = mkdtempSync(join(tmpdir(), "wisp-preferences-"));
  writeFileSync(preferencesPath(documents), fixture("main-display.txt"));
  expect(await restorePreferences(preferencesBackupPath(documents), preferencesPath(documents))).toBe(false);
  expect(readFileSync(preferencesPath(documents), "utf8")).toBe(fixture("main-display.txt"));
});

test("graphics mode changes [Misc] hd and preserves [Video]", () => {
  const text = "[Misc]\nhd=2\nfoo=1\n\n[Video]\nassao=0\n";
  expect(withGraphicsMode(text, "reforged")).toBe(text.replace("hd=2", "hd=1"));
  expect(withGraphicsMode("[Video]\nassao=0\n", "classic")).toContain("[Misc]\nhd=0\n");
  expect(withGraphicsMode(text, "definitive")).toBe(text);
});
