import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { GameLauncher } from "../host/os/platform/services";
import { installOf, prefixOf } from "../host/lan/pool";
import { setupClient } from "../host/lan/setup";

describe("lan setup registry", () => {
  test("[integration tmpfs] a prefix whose user.reg lacks Allow Local Files gets it set, so its menu page loads and reports its login doors", async () => {
    const root = mkdtempSync("/dev/shm/wisp-lan-registry-");
    const dataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = join(root, "data");
    try {
      const from = join(root, "Warcraft III");
      for (const [path, text] of [[".build.info", "Branch!STRING:0|Active!DEC:1|Version!STRING:0\nus|1|3.0.0.24268\n"], ["_retail_/x86_64/Warcraft III.exe", "exe"]] as const) {
        mkdirSync(join(from, path, ".."), { recursive: true });
        writeFileSync(join(from, path), text);
      }
      const registryRuns: string[][] = [];
      const setup = (name: string, registry: string) => {
        mkdirSync(join(installOf(name), ".."), { recursive: true });
        writeFileSync(join(prefixOf(name), "user.reg"), registry);
        return Effect.runPromise(setupClient(name, from, "3.0.0.24268", 47200, () => {}).pipe(
          Effect.provideService(GameLauncher, GameLauncher.of({ inPrefix: ({ args }) => {
            registryRuns.push([name, ...args]);
            return Effect.succeed({ command: ["true"], env: {} });
          } }))));
      };
      await setup("lan1a", "[Software\\\\Blizzard Entertainment\\\\Warcraft III]\n\"Window Mode\"=dword:00000001\n");
      await setup("lan1b", "\"Allow Local Files\"=dword:00000001\n");
      expect(registryRuns).toEqual([["lan1a", "add", "HKCU\\Software\\Blizzard Entertainment\\Warcraft III", "/v", "Allow Local Files", "/t", "REG_DWORD", "/d", "1", "/f"]]);
    } finally {
      if (dataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = dataHome;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("[integration tmpfs] a new client links the source's Data and _retail_, so it costs only its own small files beyond the shared base, and one left with only Data and _retail_ gets its own files back", async () => {
    const root = mkdtempSync("/dev/shm/wisp-lan-view-");
    const dataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = join(root, "data");
    try {
      const from = join(root, "Warcraft III");
      const megabyte = "x".repeat(2 ** 20);
      for (const [path, text] of [
        [".build.info", "Branch!STRING:0|Active!DEC:1|Version!STRING:0\nus|1|3.0.0.24268\n"], ["Launcher.db", "launcher"],
        ["Data/data/data.000", megabyte], ["Data/data/0000000001.idx", megabyte], ["Data/data/shmem", "memory"],
        ["_retail_/x86_64/Warcraft III.exe", megabyte], ["_retail_/x86_64/Warcraft III.dll", megabyte],
      ] as const) {
        mkdirSync(join(from, path, ".."), { recursive: true });
        writeFileSync(join(from, path), text);
      }
      mkdirSync(join(installOf("lan1a"), ".."), { recursive: true });
      writeFileSync(join(prefixOf("lan1a"), "user.reg"), "\"Allow Local Files\"=dword:00000001\n");
      await Effect.runPromise(setupClient("lan1a", from, "3.0.0.24268", 47200, () => {}).pipe(
        Effect.provideService(GameLauncher, GameLauncher.of({ inPrefix: () => Effect.succeed({ command: ["true"], env: {} }) }))));
      const baseInodes = new Set(readdirSync(from, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => statSync(join(entry.parentPath, entry.name)).ino));
      const clientFiles = readdirSync(installOf("lan1a"), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
      const ownBytes = clientFiles.filter((file) => !baseInodes.has(statSync(file).ino)).reduce((sum, file) => sum + statSync(file).size, 0);
      expect(clientFiles.length).toBe(8);
      expect(ownBytes).toBeLessThan(2 ** 16);

      rmSync(join(installOf("lan1a"), ".build.info"));
      rmSync(join(installOf("lan1a"), "Launcher.db"));
      await Effect.runPromise(setupClient("lan1a", from, "3.0.0.24268", 47200, () => {}).pipe(
        Effect.provideService(GameLauncher, GameLauncher.of({ inPrefix: () => Effect.succeed({ command: ["true"], env: {} }) }))));
      expect([".build.info", "Launcher.db"].filter((entry) => existsSync(join(installOf("lan1a"), entry)))).toEqual([".build.info", "Launcher.db"]);
    } finally {
      if (dataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = dataHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
