







import { rename, rm } from "node:fs/promises";
import { join } from "node:path";


export type DisplaySettings = Readonly<Record<string, string>>;

export const preferencesPath = (documents: string) => join(documents, "War3Preferences.txt");

export const preferencesBackupPath = (documents: string) => join(documents, "War3Preferences-before-play.txt");

const SECTION = /^\s*\[([^\]]*)\]\s*$/;
const ENTRY = /^([^=;/\s][^=]*)=(.*?)\r?$/;


export type PreferenceSettings = Readonly<Record<string, DisplaySettings>>;


export function videoSettings(text: string, sectionName = "Video"): Record<string, string> {
  const settings: Record<string, string> = {};
  let inVideo = false;
  for (const line of text.split("\n")) {
    const section = SECTION.exec(line.replace(/\r$/, ""));
    if (section !== null) {
      inVideo = section[1] === sectionName;
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

  readonly actual?: string;
}


export function displayChanges(text: string, expected: DisplaySettings, sectionName = "Video"): DisplayChange[] {
  const actual = videoSettings(text, sectionName);
  const named = (key: string) => (sectionName === "Video" ? key : `${sectionName}.${key}`);
  return Object.entries(expected).flatMap(([key, value]) => (actual[key] === value ? [] : [{ key: named(key), expected: value, ...(actual[key] === undefined ? {} : { actual: actual[key] }) }]));
}


export const preferenceChanges = (text: string, expected: PreferenceSettings): DisplayChange[] =>
  Object.entries(expected).flatMap(([section, settings]) => displayChanges(text, settings, section));


export const withPreferences = (text: string, expected: PreferenceSettings): string =>
  Object.entries(expected).reduce((written, [section, settings]) => withDisplaySettings(written, settings, section), text);


export function absentSettings(text: string, recommended: DisplaySettings): DisplaySettings {
  const actual = videoSettings(text);
  return Object.fromEntries(Object.entries(recommended).filter(([key]) => actual[key] === undefined));
}


export function withDisplaySettings(text: string, expected: DisplaySettings, sectionName = "Video"): string {
  const lines = text.split("\n");
  const left = new Map(Object.entries(expected));
  const eol = (line: string) => (line.endsWith("\r") ? "\r" : text.includes("\r\n") ? "\r" : "");
  let inVideo = false;
  let lastVideoLine = -1;
  const out = lines.map((line, index) => {
    const section = SECTION.exec(line.replace(/\r$/, ""));
    if (section !== null) {
      inVideo = section[1] === sectionName;
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
  return `${out.join("\n")}${tail}[${sectionName}]${cr}\n${missing.join("\n")}\n`;
}


export async function restorePreferences(backup: string, preferences: string): Promise<boolean> {
  const file = Bun.file(backup);
  if (!(await file.exists())) return false;
  const temporary = `${preferences}.restoring`;
  await Bun.write(temporary, await file.text());
  await rename(temporary, preferences);
  await rm(backup);
  return true;
}


export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};


export function withGraphicsMode(text: string, mode: "classic" | "reforged" | "definitive"): string {
  return withDisplaySettings(text, { hd: String({ classic: 0, reforged: 1, definitive: 2 }[mode]) }, "Misc");
}
