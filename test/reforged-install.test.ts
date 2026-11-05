import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverInstall, ReforgedRequired } from "../host/os/warcraft/reforgedInstall";

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
