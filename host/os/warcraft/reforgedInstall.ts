import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { captureProcess } from "../../process/hostProcess";

export const STORAGE_ENV = "WC3_STORAGE";

const PRODUCT = "w3";
const REFORGED_MAJOR = "3";
const WINE_FOLDERS = ["drive_c/Program Files (x86)/Warcraft III", "drive_c/Program Files/Warcraft III"];
const WINDOWS_FOLDER = "Warcraft III";
const REGISTRY_KEYS = [
  "HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\Warcraft III",
  "HKCU\\SOFTWARE\\Blizzard Entertainment\\Warcraft III",
];

export interface InstallLookup {
  /** `--storage DIR`: the folder that holds `.build.info` and `Data/`. Tried first and never skipped. */
  readonly storage?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: string;
  readonly platform?: NodeJS.Platform;
  /** Windows only: the install folders Battle.net registered, read from the registry. */
  readonly registry?: readonly string[];
}

export interface ReforgedInstall {
  readonly storage: string;
  readonly version: string;
}

type Refusal = { readonly storage: string; readonly reason: string };

export class ReforgedRequired extends Schema.TaggedError<ReforgedRequired, { readonly brand: unique symbol }>()("ReforgedRequired", { problem: Schema.String }) {
  override get message(): string {
    return this.problem;
  }
}

const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const entries = (directory: string) => {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
};

const subdirectories = (directory: string) => entries(directory).map((name) => join(directory, name)).filter(isDirectory);

const activeBuildRow = (storage: string): Readonly<Record<string, string>> | undefined => {
  let text: string;
  try {
    text = readFileSync(join(storage, ".build.info"), "utf8");
  } catch {
    return undefined;
  }
  const [head = "", ...lines] = text.trim().split(/\r?\n/);
  const columns = head.split("|").map((header) => header.split("!")[0] ?? header);
  const rows = lines.map((line) => Object.fromEntries(line.split("|").map((value, index) => [columns[index] ?? String(index), value])));
  return rows.find((row) => row.Active === "1") ?? rows[0] ?? {};
};

/** A Reforged (3.x) CASC install, or the reason a folder is not one. Reads file names and the `.build.info` text only. */
export function classifyInstall(storage: string): ReforgedInstall | Refusal {
  const row = activeBuildRow(storage);
  if (row === undefined) {
    const mpqs = [...entries(storage), ...entries(join(storage, "Data"))].filter((name) => name.toLowerCase().endsWith(".mpq"));
    return { storage, reason: mpqs.length > 0 ? "it holds MPQ archives and no .build.info, which is a pre-Reforged 1.x install" : "it has no .build.info, so it is not a Battle.net-installed Warcraft III" };
  }
  const version = row.Version ?? "";
  if (row.Product !== undefined && row.Product !== PRODUCT) return { storage, reason: `its .build.info is for product ${row.Product}, not Warcraft III (${PRODUCT})` };
  if (version.split(".")[0] !== REFORGED_MAJOR) return { storage, reason: `its .build.info says version ${version === "" ? "(none)" : version}; Reforged is 3.x and older builds are pre-Reforged` };
  if (!entries(join(storage, "Data", "data")).some((name) => name.toLowerCase().endsWith(".idx"))) return { storage, reason: "it has no CASC storage (no .idx files under Data/data)" };
  return { storage, version };
}

const registryFolders = Effect.forEach(REGISTRY_KEYS, (key) =>
  captureProcess("read the Battle.net registry entry", key, ["reg", "query", key, "/v", "InstallPath"]).pipe(
    Effect.map(({ exitCode, stdout }) => {
      const match = /InstallPath\s+REG_SZ\s+(.+?)\r?$/m.exec(stdout);
      return exitCode === 0 && match?.[1] !== undefined ? [match[1].trim()] : [];
    }),
    Effect.orElseSucceed((): string[] => []),
  )).pipe(Effect.map((folders) => folders.flat()));

function windowsSearch(env: Readonly<Record<string, string | undefined>>, registry: readonly string[]) {
  const roots = [env["ProgramFiles(x86)"], env.ProgramFiles, "C:\\Program Files (x86)", "C:\\Program Files"];
  return {
    folders: [...registry, ...roots.flatMap((root) => root === undefined ? [] : [join(root, WINDOWS_FOLDER)])],
    described: ["the Battle.net registry entry (Blizzard Entertainment\\Warcraft III InstallPath)", "%ProgramFiles(x86)%\\Warcraft III", "%ProgramFiles%\\Warcraft III"],
  };
}

function unixSearch(home: string, env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform) {
  const steam = [".local/share/Steam", ".steam/steam", ".var/app/com.valvesoftware.Steam/.local/share/Steam"].flatMap((root) => subdirectories(join(home, root, "steamapps/compatdata")).map((app) => join(app, "pfx")));
  const lutris = [join(home, "Games"), join(home, ".local/share/lutris/runners/wine")].flatMap((root) => subdirectories(root).flatMap((game) => [game, ...subdirectories(game)]));
  const bottles = [".local/share/bottles/bottles", ".var/app/com.usebottles.bottles/data/bottles/bottles"].flatMap((root) => subdirectories(join(home, root)));
  const wine = [...(env.WINEPREFIX === undefined ? [] : [env.WINEPREFIX]), join(home, ".wine")];
  const folders = [...steam, ...lutris, ...bottles, ...wine].flatMap((prefix) => WINE_FOLDERS.map((folder) => join(prefix, folder)));
  return {
    folders: platform === "darwin" ? [...folders, "/Applications/Warcraft III"] : folders,
    described: ["Steam compatdata/*/pfx (native and Flatpak Steam)", "Lutris and Wine prefixes under ~/Games", "Bottles bottles", "$WINEPREFIX and ~/.wine", `each under ${WINE_FOLDERS.join(" or ")}`, ...(platform === "darwin" ? ["/Applications/Warcraft III"] : [])],
  };
}

const pointing = `Point Wisp at it with --storage DIR or ${STORAGE_ENV}=DIR, where DIR holds .build.info and Data/ (Wisp checks that the install is present, not who owns it).`;

function explicitInstall(storage: string | undefined, env: Readonly<Record<string, string | undefined>>): ReforgedInstall | ReforgedRequired | undefined {
  const fromEnv = env[STORAGE_ENV];
  const given = storage !== undefined ? { source: "--storage", path: storage } : fromEnv === undefined || fromEnv === "" ? undefined : { source: `$${STORAGE_ENV}`, path: fromEnv };
  if (given === undefined) return undefined;
  if (!isDirectory(given.path)) return new ReforgedRequired({ problem: `Warcraft III: Reforged required, but ${given.source} names ${given.path}, which is not a folder. ${pointing}` });
  const verdict = classifyInstall(given.path);
  return "version" in verdict ? verdict : new ReforgedRequired({ problem: `Warcraft III: Reforged required, but ${given.source} names ${given.path} and ${verdict.reason}. ${pointing}` });
}

/** The first Reforged install Wisp finds, or the one message that says what it looked for and how to point it at the install. */
export function discoverInstall(lookup: InstallLookup = {}): ReforgedInstall | ReforgedRequired {
  const env = lookup.env ?? process.env, platform = lookup.platform ?? process.platform;
  const explicit = explicitInstall(lookup.storage, env);
  if (explicit !== undefined) return explicit;
  const { folders, described } = platform === "win32" ? windowsSearch(env, lookup.registry ?? []) : unixSearch(lookup.home ?? homedir(), env, platform);
  const refused: Refusal[] = [];
  for (const folder of folders) {
    if (!isDirectory(folder)) continue;
    const verdict = classifyInstall(folder);
    if ("version" in verdict) return verdict;
    refused.push(verdict);
  }
  if (refused.length > 0) return new ReforgedRequired({ problem: `Warcraft III: Reforged required. Found ${refused.map(({ storage, reason }) => `${storage} (${reason})`).join("; ")}. Wisp supports Reforged 3.x installs only. ${pointing}` });
  return new ReforgedRequired({ problem: `Warcraft III: Reforged required. No install found. Looked at --storage, $${STORAGE_ENV}, ${described.join(", ")}. ${pointing}` });
}

export const findReforgedInstall = (lookup: InstallLookup = {}): Effect.Effect<ReforgedInstall, ReforgedRequired> => Effect.gen(function*() {
  const windows = (lookup.platform ?? process.platform) === "win32" && lookup.registry === undefined;
  const registry = windows ? yield* registryFolders : lookup.registry;
  const found = discoverInstall({ ...lookup, ...(registry === undefined ? {} : { registry }) });
  return found instanceof ReforgedRequired ? yield* found : found;
});

/** Reads `--storage DIR` from a play command's arguments; the rest come back untouched. */
export function storageArgument(args: readonly string[]): { readonly storage?: string; readonly rest: readonly string[] } | string {
  const at = args.indexOf("--storage");
  if (at < 0) return { rest: args };
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) return "--storage needs the Warcraft III folder (the one with .build.info and Data/)";
  return { storage: value, rest: [...args.slice(0, at), ...args.slice(at + 2)] };
}
