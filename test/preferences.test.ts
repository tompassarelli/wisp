import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preferencesBackupPath, preferencesPath } from "../host/os/warcraft/preferences";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/preferences", name), "utf8");

test("[boundary] the restore helper waits for the game's process, then puts the saved file back and removes the backup", async () => {
  const documents = mkdtempSync(join(tmpdir(), "wisp-preferences-"));
  writeFileSync(preferencesBackupPath(documents), fixture("private-desktop.txt"));
  writeFileSync(preferencesPath(documents), fixture("main-display.txt"));
  const game = Bun.spawn(["sleep", "600"]);
  const helper = Bun.spawn([process.execPath, join(import.meta.dir, "../host/client/restorePreferences.ts"), String(game.pid), documents], { stdout: "pipe" });
  const output = helper.stdout.pipeThrough(new TextDecoderStream()).getReader();

  let seen = "";
  while (!seen.includes("\n")) {
    const { value, done } = await output.read();
    if (done) break;
    seen += value;
  }
  expect(seen).toBe(`waiting for process ${game.pid}\n`);
  expect(readFileSync(preferencesPath(documents), "utf8")).toBe(fixture("main-display.txt"));
  game.kill();
  await game.exited;
  for (let chunk = await output.read(); !chunk.done; chunk = await output.read()) seen += chunk.value;
  expect(seen.trim().split("\n").at(-1)).toBe("restored War3Preferences.txt");
  expect(readFileSync(preferencesPath(documents), "utf8")).toBe(fixture("private-desktop.txt"));
  expect(existsSync(preferencesBackupPath(documents))).toBe(false);
});
