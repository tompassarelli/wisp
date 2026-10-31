import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { discoverInstall, findReforgedInstall, ReforgedRequired, storageArgument } from "../host/os/warcraft/reforgedInstall";
import { runStandalone, type StandaloneGame } from "../host/play/standalone";

const roots: string[] = [];
const scratch = () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-reforged-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const REFORGED_BUILD = "Branch!STRING:0|Active!DEC:1|Version!STRING:0|Product!STRING:0\nus|1|3.0.1.24371|w3\n";

const reforgedAt = (folder: string, build = REFORGED_BUILD) => {
  mkdirSync(join(folder, "Data/data"), { recursive: true });
  writeFileSync(join(folder, ".build.info"), build);
  writeFileSync(join(folder, "Data/data/0000000011.idx"), "");
  return folder;
};

const classicAt = (folder: string) => {
  mkdirSync(join(folder, "Data"), { recursive: true });
  writeFileSync(join(folder, "war3.mpq"), "");
  writeFileSync(join(folder, "Data/war3x.mpq"), "");
  return folder;
};

const PROTON = "drive_c/Program Files (x86)/Warcraft III";
const steamInstall = (home: string, app: string) => join(home, ".local/share/Steam/steamapps/compatdata", app, "pfx", PROTON);

const message = (found: ReturnType<typeof discoverInstall>) => {
  expect(found).toBeInstanceOf(ReforgedRequired);
  return (found as ReforgedRequired).message;
};

test("[spec docs/play.md] a Proton prefix's Reforged install is found with its version, and a search runs Steam, Lutris, Bottles, then Wine and passes over a refused folder", () => {
  const home = scratch();
  const wine = reforgedAt(join(home, ".wine", PROTON));
  const bottle = reforgedAt(join(home, ".local/share/bottles/bottles/Battle", PROTON));
  const lutris = reforgedAt(join(home, "Games/battlenet", PROTON));
  const steam = reforgedAt(steamInstall(home, "3516115571"));
  mkdirSync(join(home, ".local/share/Steam/steamapps/compatdata/242680/pfx"), { recursive: true });
  classicAt(steamInstall(home, "1"));
  const lookup = { home, env: {}, platform: "linux" as const };
  expect(discoverInstall(lookup)).toEqual({ storage: steam, version: "3.0.1.24371" });
  for (const expected of [steam, lutris, bottle, wine]) {
    expect(discoverInstall(lookup)).toMatchObject({ storage: expected });
    rmSync(expected.slice(0, expected.indexOf("/drive_c")), { recursive: true });
  }
  expect(message(discoverInstall(lookup))).toContain("pre-Reforged");
});

test("[spec docs/play.md] --storage beats WC3_STORAGE, which beats a search, a wrong override is never skipped, and --storage is read from the arguments", () => {
  const home = scratch();
  const searched = reforgedAt(steamInstall(home, "7"));
  const fromEnv = reforgedAt(join(scratch(), "env"));
  const fromFlag = reforgedAt(join(scratch(), "flag"));
  expect(discoverInstall({ home, env: { WC3_STORAGE: fromEnv }, platform: "linux", storage: fromFlag })).toMatchObject({ storage: fromFlag });
  expect(discoverInstall({ home, env: { WC3_STORAGE: fromEnv }, platform: "linux" })).toMatchObject({ storage: fromEnv });
  expect(discoverInstall({ home, env: {}, platform: "linux" })).toMatchObject({ storage: searched });
  const gone = join(scratch(), "gone");
  expect(message(discoverInstall({ home, env: {}, platform: "linux", storage: gone }))).toContain(`--storage names ${gone}, which is not a folder`);
  const old = classicAt(join(scratch(), "old"));
  expect(message(discoverInstall({ home, env: { WC3_STORAGE: old }, platform: "linux" }))).toContain("$WC3_STORAGE names");
  expect(storageArgument(["--map", "A.w3x", "--storage", "/x", "--headless"])).toEqual({ storage: "/x", rest: ["--map", "A.w3x", "--headless"] });
  expect(storageArgument(["--headless"])).toEqual({ rest: ["--headless"] });
  expect(storageArgument(["--storage", "--headless"])).toContain("--storage needs");
});

test("[spec docs/play.md] with no install the message names what was searched and how to point at it", () => {
  const home = scratch();
  const text = message(discoverInstall({ home, env: {}, platform: "linux" }));
  expect(text).toStartWith("Warcraft III: Reforged required. No install found.");
  for (const place of ["--storage", "$WC3_STORAGE", "Steam compatdata", "Lutris", "Bottles", "~/.wine"]) expect(text).toContain(place);
  expect(text).toContain("--storage DIR or WC3_STORAGE=DIR");
  expect(text).toContain("not who owns it");
});

test("[spec docs/play.md] a pre-Reforged MPQ folder, a CASC 1.32 build, another product and a folder with no CASC index are each refused with their reason", () => {
  const home = scratch();
  const mpq = classicAt(join(home, "Games/classic", PROTON));
  expect(message(discoverInstall({ home, env: {}, platform: "linux" }))).toContain(`${mpq} (it holds MPQ archives and no .build.info, which is a pre-Reforged 1.x install)`);
  const casc132 = reforgedAt(steamInstall(home, "9"), "Branch!STRING:0|Active!DEC:1|Version!STRING:0|Product!STRING:0\nus|1|1.32.10.18820|w3\n");
  const text = message(discoverInstall({ home, env: {}, platform: "linux" }));
  expect(text).toContain(`${casc132} (its .build.info says version 1.32.10.18820; Reforged is 3.x and older builds are pre-Reforged)`);
  expect(text).toContain("Reforged 3.x installs only");
  const other = reforgedAt(join(scratch(), "other"), "Active!DEC:1|Version!STRING:0|Product!STRING:0\n1|3.0.0.1|hero\n");
  expect(message(discoverInstall({ storage: other, env: {} }))).toContain("not Warcraft III (w3)");
  const bare = join(scratch(), "bare");
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, ".build.info"), REFORGED_BUILD);
  expect(message(discoverInstall({ storage: bare, env: {} }))).toContain("no CASC storage");
});

test("[spec docs/play.md] on Windows the registry entry comes first, then the Program Files folders", () => {
  const files = scratch(), registered = reforgedAt(join(scratch(), "D-drive"));
  const inFiles = reforgedAt(join(files, "Warcraft III"));
  const env = { "ProgramFiles(x86)": files };
  expect(discoverInstall({ platform: "win32", env, registry: [registered] })).toMatchObject({ storage: registered });
  expect(discoverInstall({ platform: "win32", env, registry: [] })).toMatchObject({ storage: inFiles });
  const text = message(discoverInstall({ platform: "win32", env: {}, registry: [] }));
  expect(text).toContain("Battle.net registry entry");
  expect(text).toContain("%ProgramFiles(x86)%\\Warcraft III");
});

test("[spec docs/play.md] runStandalone with no install stops with the message before any game is made, and findReforgedInstall succeeds with the install", async () => {
  const home = scratch();
  let created = 0;
  const game: StandaloneGame = { title: "Fixture", render: { readAsset: async () => undefined }, create: async () => (created++, Promise.reject(new Error("opened"))) };
  const result = await Effect.runPromise(runStandalone(game, { window: "native", reforged: { home, env: {}, platform: "linux" } }).pipe(Effect.flip));
  expect(result).toBeInstanceOf(ReforgedRequired);
  expect(result.message).toContain("Reforged required");
  expect(created).toBe(0);
  const storage = reforgedAt(steamInstall(home, "5"));
  expect(await Effect.runPromise(findReforgedInstall({ home, env: {}, platform: "linux" }))).toEqual({ storage, version: "3.0.1.24371" });
});
