import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { GameLauncher } from "../host/contract/services";
import { installOf, prefixOf } from "../host/lan/pool";
import { relinkPairPrefixes, setupClient } from "../host/lan/setup";

describe("lan setup registry", () => {

  test("[integration tmpfs] a client whose launch rewrote a linked Wine system file is linked to the first client's again once its pair is stopped", async () => {
    const root = mkdtempSync("/dev/shm/wisp-lan-relink-");
    const dataHome = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = join(root, "data");
    try {
      const windows = (name: string) => join(prefixOf(name), "drive_c/windows/system32/d3d11.dll");
      for (const name of ["lan1a", "lan1b"]) {
        mkdirSync(installOf(name), { recursive: true });
        mkdirSync(join(windows(name), ".."), { recursive: true });
        writeFileSync(windows(name), "graphics");
      }
      expect(statSync(windows("lan1b")).ino).not.toBe(statSync(windows("lan1a")).ino);
      await Effect.runPromise(relinkPairPrefixes(1));
      expect(statSync(windows("lan1b")).ino).toBe(statSync(windows("lan1a")).ino);
      expect(statSync(windows("lan1a")).nlink).toBe(2);
    } finally {
      if (dataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = dataHome;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
