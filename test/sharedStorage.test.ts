import { describe, expect, test } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { shareStorage, sharedFiles, unshareStorage } from "../host/os/warcraft/sharedStorage";

const write = (path: string, text: string) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

const install = (root: string, name: string, files: Readonly<Record<string, string>>) => {
  const folder = join(root, name);
  write(join(folder, ".build.info"), "Branch!STRING:0|Active!DEC:1|Version!STRING:0\nus|1|3.0.1.24371\n");
  for (const [path, text] of Object.entries(files)) write(join(folder, path), text);
  return folder;
};

describe("shared storage", () => {
  test("[integration fs on tmpfs] share links identical storage, keeps game-written and differing files apart, and unshare gives an install its own writable copy", async () => {
    const root = mkdtempSync("/dev/shm/wisp-shared-storage-");
    try {
      const common = { "Data/data/data.000": "archive", "Data/indices/a.index": "index", "Data/data/shmem": "memory" };
      const documents = "drive_c/users/steamuser/Documents/Warcraft III";
      const b = install(root, "b", { ...common, "Data/data/data.001": "b's update", [`${documents}/War3Preferences.txt`]: "prefs" });
      const c = install(root, "c", { ...common, "Data/data/data.001": "c's update", [`${documents}/War3Preferences.txt`]: "prefs" });
      const d = install(root, "d", common);
      const inode = (folder: string, path: string) => statSync(join(folder, path)).ino;
      rmSync(join(d, "Data/data/shmem"));
      linkSync(join(c, "Data/data/shmem"), join(d, "Data/data/shmem"));

      const shared = await Effect.runPromise(shareStorage([b, c, d]));

      expect(shared).toEqual({ linked: 4, freedBytes: 2 * ("archive".length + "index".length), separated: 2 });
      for (const path of ["Data/data/data.000", "Data/indices/a.index"]) {
        expect(new Set([b, c, d].map((folder) => inode(folder, path))).size).toBe(1);
      }
      expect(new Set([b, c, d].map((folder) => inode(folder, "Data/data/shmem"))).size).toBe(3);
      expect(inode(b, "Data/data/data.001")).not.toBe(inode(c, "Data/data/data.001"));
      expect(inode(b, `${documents}/War3Preferences.txt`)).not.toBe(inode(c, `${documents}/War3Preferences.txt`));
      expect(await Effect.runPromise(shareStorage([b, c, d]))).toEqual({ linked: 0, freedBytes: 0, separated: 0 });

      const newClone = install(root, "e", common);
      expect(await Effect.runPromise(shareStorage([b, newClone]))).toEqual({ linked: 2, freedBytes: "archive".length + "index".length, separated: 0 });
      expect(inode(newClone, "Data/data/data.000")).toBe(inode(b, "Data/data/data.000"));

      expect(await Effect.runPromise(unshareStorage(c))).toEqual({ files: 2, bytes: "archive".length + "index".length });
      expect(sharedFiles(c)).toEqual([]);
      writeFileSync(join(c, "Data/data/data.000"), "c's archive");
      expect(readFileSync(join(b, "Data/data/data.000"), "utf8")).toBe("archive");
      expect(sharedFiles(b)).toEqual(["data/data.000", "indices/a.index"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
