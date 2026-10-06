// `bun restorePreferences.ts PID DOCUMENTS`: waits for Warcraft III's process
// PID to exit, then puts back the preferences file `play` saved before the game
// started, so the game's exit-time rewrite of its display settings doesn't
// outlive the session (wisp:docs/display-settings.md). `play` starts it
// detached.
import { alive, preferencesBackupPath, preferencesPath, restorePreferences } from "../warcraft/preferences";

if (import.meta.main) {
  const [pid, documents] = Bun.argv.slice(2);
  if (pid === undefined || documents === undefined || !Number.isInteger(Number(pid))) {
    console.error("usage: restorePreferences.ts PID DOCUMENTS");
    process.exit(2);
  }
  while (alive(Number(pid))) await Bun.sleep(1000);
  console.log((await restorePreferences(preferencesBackupPath(documents), preferencesPath(documents))) ? "restored War3Preferences.txt" : "no saved War3Preferences.txt");
}
