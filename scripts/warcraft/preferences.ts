// Warcraft III's display settings, kept in the [Video] section of
// Documents/Warcraft III/War3Preferences.txt. The game rewrites the file when
// it exits, with whatever window mode, window size, render resolution, frame
// rate cap and refresh rate it ran with. Clients on private desktops share a
// Wine prefix with a run on the owner's display, so a run there leaves the
// private desktop's settings changed (6 Oct: 3:2 render into a 2160x1440
// area). `doctor` restores declared settings; `play` puts the file back when
// its game exits (wisp:docs/display-settings.md).
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";

/** A client's expected [Video] settings, by key, as the file spells them. */
export type DisplaySettings = Readonly<Record<string, string>>;

export const preferencesPath = (documents: string) => join(documents, "War3Preferences.txt");
/** Where `play` keeps the file it replaced until its game exits. */
export const preferencesBackupPath = (documents: string) => join(documents, "War3Preferences-before-play.txt");

const SECTION = /^\s*\[([^\]]*)\]\s*$/;
const ENTRY = /^([^=;/\s][^=]*)=(.*?)\r?$/;

/** The [Video] section's entries, by key. */
export function videoSettings(text: string): Record<string, string> {
  const settings: Record<string, string> = {};
  let inVideo = false;
  for (const line of text.split("\n")) {
    const section = SECTION.exec(line.replace(/\r$/, ""));
    if (section !== null) {
      inVideo = section[1] === "Video";
      continue;
    }
    const entry = inVideo ? ENTRY.exec(line) : null;
    if (entry !== null) settings[entry[1]!] = entry[2]!;
  }
  return settings;
}

export interface DisplayChange {
  readonly key: string;
  readonly expected: string;
  /** Absent when the file has no such entry. */
  readonly actual?: string;
}

/** The expected settings the file's [Video] section doesn't hold. */
export function displayChanges(text: string, expected: DisplaySettings): DisplayChange[] {
  const actual = videoSettings(text);
  return Object.entries(expected).flatMap(([key, value]) => (actual[key] === value ? [] : [{ key, expected: value, ...(actual[key] === undefined ? {} : { actual: actual[key] }) }]));
}

/** The file with the expected settings written into its [Video] section; every other line is kept as it is. */
export function withDisplaySettings(text: string, expected: DisplaySettings): string {
  const lines = text.split("\n");
  const left = new Map(Object.entries(expected));
  const eol = (line: string) => (line.endsWith("\r") ? "\r" : text.includes("\r\n") ? "\r" : "");
  let inVideo = false;
  let lastVideoLine = -1;
  const out = lines.map((line, index) => {
    const section = SECTION.exec(line.replace(/\r$/, ""));
    if (section !== null) {
      inVideo = section[1] === "Video";
      return line;
    }
    if (!inVideo) return line;
    if (line.trim() !== "") lastVideoLine = index;
    const entry = ENTRY.exec(line);
    const key = entry?.[1];
    if (key === undefined || !left.has(key)) return line;
    const value = left.get(key)!;
    left.delete(key);
    return `${key}=${value}${eol(line)}`;
  });
  if (left.size === 0) return out.join("\n");
  const missing = [...left].map(([key, value]) => `${key}=${value}${eol(lines[0] ?? "")}`);
  if (lastVideoLine >= 0) {
    out.splice(lastVideoLine + 1, 0, ...missing);
    return out.join("\n");
  }
  const tail = text.length === 0 || text.endsWith("\n") ? "" : "\n";
  const cr = eol(lines[0] ?? "");
  return `${out.join("\n")}${tail}[Video]${cr}\n${missing.join("\n")}\n`;
}

/** Puts `backup` over `preferences` whole (through a temporary file) and removes the backup. Returns false when there is no backup. */
export async function restorePreferences(backup: string, preferences: string): Promise<boolean> {
  const file = Bun.file(backup);
  if (!(await file.exists())) return false;
  const temporary = `${preferences}.restoring`;
  await Bun.write(temporary, await file.text());
  await rename(temporary, preferences);
  await rm(backup);
  return true;
}

/** True while a process with this id exists. */
export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};
