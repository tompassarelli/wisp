import type { SoundCue } from "../../src/headless/client";

export type SoundAssetReader = (path: string) => Promise<Uint8Array | undefined>;
export interface SoundAsset { readonly path: string; readonly bytes: Uint8Array }

const TABLES = ["AnimSounds", "AbilitySounds", "UISounds", "UnitAckSounds", "UnitCombatSounds", "AmbienceSounds", "DialogSounds"];
const normalize = (path: string) => path.replaceAll("\\", "/");

function soundRows(bytes: Uint8Array): Map<string, string[]> {
  const rows = new Map<number, Map<number, string>>();
  let x = 1;
  let y = 1;
  for (const line of new TextDecoder().decode(bytes).split(/\r?\n/)) {
    const fields = line.match(/(?:[^;"\r\n]|"(?:[^"]|"")*")+/g) ?? [];
    if (fields[0] !== "C") continue;
    let value: string | undefined;
    for (const field of fields.slice(1)) {
      if (field.startsWith("X")) x = Number(field.slice(1));
      else if (field.startsWith("Y")) y = Number(field.slice(1));
      else if (field.startsWith("K")) {
        const cell = field.slice(1);
        value = cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell;
      }
    }
    if (value === undefined) continue;
    let row = rows.get(y);
    if (row === undefined) rows.set(y, row = new Map());
    row.set(x, value);
  }
  const headers = rows.get(1);
  const column = (name: string) => [...headers ?? []].find(([, value]) => value.toLowerCase() === name)?.[0];
  const nameColumn = column("soundname");
  const filesColumn = column("filenames");
  const directoryColumn = column("directorybase");
  const sounds = new Map<string, string[]>();
  if (nameColumn === undefined || filesColumn === undefined) return sounds;
  for (const [rowNumber, row] of rows) {
    if (rowNumber === 1) continue;
    const name = row.get(nameColumn);
    const files = row.get(filesColumn);
    if (name === undefined || files === undefined || files === "_") continue;
    const directory = directoryColumn === undefined ? "" : row.get(directoryColumn) ?? "";
    const prefix = directory === "_" || directory === "" ? "" : normalize(directory).replace(/\/?$/, "/");
    sounds.set(name.toLowerCase(), files.split(",").map((file) => prefix + normalize(file.trim())).filter((file) => file !== ""));
  }
  return sounds;
}

export function createSoundResolver(readAsset: SoundAssetReader): (cue: SoundCue) => Promise<SoundAsset | undefined> {
  let labels: Promise<Map<string, string[]>> | undefined;
  const assets = new Map<string, Promise<SoundAsset | undefined>>();
  const loadLabels = async () => {
    const tables = await Promise.all(TABLES.map((name) => readAsset(`UI/SoundInfo/${name}.slk`)));
    const result = new Map<string, string[]>();
    for (const table of tables) {
      if (table === undefined) continue;
      for (const [label, paths] of soundRows(table)) if (!result.has(label)) result.set(label, paths);
    }
    return result;
  };
  const load = async (path: string): Promise<SoundAsset | undefined> => {
    const base = path.replace(/\.(?:wav|mp3|flac|ogg)$/i, "");
    const candidates = [...new Set([path, ...["flac", "wav", "mp3", "ogg"].map((extension) => `${base}.${extension}`)])];
    for (const candidate of candidates) {
      const bytes = await readAsset(candidate);
      if (bytes !== undefined) return { path: candidate, bytes };
    }
    return undefined;
  };
  return async (cue) => {
    let paths: string[];
    if (cue.source !== undefined && cue.source !== "") paths = [normalize(cue.source)];
    else {
      if (cue.label === undefined) return undefined;
      labels ??= loadLabels();
      paths = (await labels).get(cue.label.toLowerCase()) ?? [];
    }

    const first = Math.abs(cue.handle.id) % paths.length;
    for (let offset = 0; offset < paths.length; offset++) {
      const path = paths[(first + offset) % paths.length];
      if (path === undefined) continue;
      const key = path.toLowerCase();
      let asset = assets.get(key);
      if (asset === undefined) assets.set(key, asset = load(path));
      const resolved = await asset;
      if (resolved !== undefined) return resolved;
    }
    return undefined;
  };
}

export function soundAsset(cue: SoundCue, readAsset: SoundAssetReader): Promise<SoundAsset | undefined> {
  return createSoundResolver(readAsset)(cue);
}
