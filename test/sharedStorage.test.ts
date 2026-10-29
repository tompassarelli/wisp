import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { shareStorage, sharedFiles, unshareStorage } from "../host/os/warcraft/sharedStorage";

const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

const install = (root: string, name: string, files: Readonly<Record<string, string>>, buildKey = "abc") => {
  const folder = join(root, name);
  write(join(folder, ".build.info"), `Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|Version!STRING:0|Tags!STRING:0\nus|1|${buildKey}|3.0.1.24371|geoip-${name}\n`);
  for (const [path, text] of Object.entries(files)) write(join(folder, path), text);
  return folder;
};

describe("shared storage", () => {
  test("[integration fs on tmpfs] share makes each install's Data and _retail_ a view of the base's, keeps game-written files its own, and unshare gives an install its own writable copy", async () => {
    const root = mkdtempSync("/dev/shm/wisp-shared-storage-");
    try {
      const documents = "drive_c/users/steamuser/Documents/Warcraft III";
      const base = install(root, "c", {
        "Data/data/data.000": "c's archive", "Data/data/0000000011.idx": "c's index", "Data/data/shmem": "c's memory",
        "_retail_/x86_64/Warcraft III.exe": "exe", "_retail_/webui/index.html": "c's page",
      });
      const b = install(root, "b", {
        "Data/data/data.000": "b's archive", "Data/data/0000000010.idx": "b's index", "Data/data/shmem": "b's memory",
        "_retail_/x86_64/Warcraft III.exe": "exe", "_retail_/webui/index.html": "b's page", [`${documents}/War3Preferences.txt`]: "b's prefs",
      });
      const fresh = install(root, "e", {});
      const inode = (folder: string, path: string) => statSync(join(folder, path)).ino;

      const shared = await Effect.runPromise(shareStorage(base, [b, fresh]));

      expect(shared).toEqual({ linked: 6, removed: 1, freedBytes: "b's archive".length + "b's index".length + "exe".length });
      for (const path of ["Data/data/data.000", "Data/data/0000000011.idx", "_retail_/x86_64/Warcraft III.exe"]) {
        expect(new Set([base, b, fresh].map((folder) => inode(folder, path))).size).toBe(1);
      }
      expect(existsSync(join(b, "Data/data/0000000010.idx"))).toBe(false);
      expect(new Set([base, b, fresh].map((folder) => inode(folder, "Data/data/shmem"))).size).toBe(3);
      expect(readFileSync(join(b, "Data/data/shmem"), "utf8")).toBe("c's memory");
      expect(readFileSync(join(b, "_retail_/webui/index.html"), "utf8")).toBe("b's page");
      expect(readFileSync(join(fresh, "_retail_/webui/index.html"), "utf8")).toBe("c's page");
      expect(inode(fresh, "_retail_/webui/index.html")).not.toBe(inode(base, "_retail_/webui/index.html"));
      expect(readFileSync(join(b, documents, "War3Preferences.txt"), "utf8")).toBe("b's prefs");

      writeFileSync(join(b, "Data/data/shmem"), "b's run");
      expect(await Effect.runPromise(shareStorage(base, [b, fresh]))).toEqual({ linked: 0, removed: 0, freedBytes: 0 });
      expect(readFileSync(join(b, "Data/data/shmem"), "utf8")).toBe("b's run");

      const patched = install(root, "d", {}, "def");
      expect(Effect.runPromise(shareStorage(base, [patched]))).rejects.toThrow(/not on .*'s build 3.0.1.24371\/abc/);

      expect(await Effect.runPromise(unshareStorage(b))).toEqual({ files: 3, bytes: "c's archive".length + "c's index".length + "exe".length });
      expect(sharedFiles(b)).toEqual([]);
      writeFileSync(join(b, "Data/data/data.000"), "b's update");
      expect(readFileSync(join(base, "Data/data/data.000"), "utf8")).toBe("c's archive");
      expect(sharedFiles(base)).toEqual(["Data/data/0000000011.idx", "Data/data/data.000", "_retail_/x86_64/Warcraft III.exe"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
