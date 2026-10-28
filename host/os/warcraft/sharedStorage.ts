import { chmodSync, closeSync, copyFileSync, existsSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { Effect, Schema } from "effect";

class StorageFailure extends Schema.TaggedError<StorageFailure, { readonly brand: unique symbol }>()("StorageFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

// The game rewrites its storage's shmem files while it runs, so each install keeps its own; it opens the rest for writing too and fails on read-only ones.
const GAME_WRITTEN = new Set(["shmem"]);

const PRIVATE_MODE = 0o644;

const isGameWritten = (file: string) => GAME_WRITTEN.has(basename(file));

const storageFiles = (install: string): readonly string[] => {
  const data = join(install, "Data");
  return existsSync(data)
    ? readdirSync(data, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => relative(data, join(entry.parentPath, entry.name))).sort()
    : [];
};

const storagePath = (install: string, file: string) => join(install, "Data", file);

export const buildOf = (install: string) => {
  const [header, ...rows] = readFileSync(join(install, ".build.info"), "utf8").split(/\r?\n/).filter((line) => line.length > 0).map((line) => line.split("|"));
  const column = (name: string) => header?.findIndex((field) => field.split("!")[0] === name) ?? -1;
  const row = rows.find((fields) => fields[column("Active")] === "1") ?? rows[0];
  return row?.[column("Version")] || undefined;
};

const replaceWith = (target: string, place: (temporary: string) => void) => {
  const temporary = `${target}.wisp-share`;
  rmSync(temporary, { force: true });
  try {
    place(temporary);
    renameSync(temporary, target);
  } catch (cause) {
    rmSync(temporary, { force: true });
    throw cause;
  }
};

const share = (source: string, target: string) => {
  mkdirSync(dirname(target), { recursive: true });
  replaceWith(target, (temporary) => linkSync(source, temporary));
};

export const linkStorage = (from: string, install: string) => Effect.try({
  try: () => {
    let linked = 0;
    for (const file of storageFiles(from)) {
      const source = storagePath(from, file), target = storagePath(install, file);
      if (isGameWritten(file)) {
        if (existsSync(target)) continue;
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
        chmodSync(target, PRIVATE_MODE);
        continue;
      }
      if (existsSync(target) && statSync(target).ino === statSync(source).ino) continue;
      share(source, target);
      linked += 1;
    }
    return linked;
  },
  catch: (cause) => new StorageFailure({ problem: `link ${install}'s storage to ${from}'s: ${String(cause)}` }),
});

const HASH_CHUNK = 8 * 2 ** 20;

const hashOf = (path: string) => Effect.try({
  try: () => {
    const hasher = new Bun.CryptoHasher("sha256");
    const chunk = Buffer.allocUnsafe(HASH_CHUNK);
    const file = openSync(path, "r");
    try {
      for (let read = readSync(file, chunk); read > 0; read = readSync(file, chunk)) hasher.update(chunk.subarray(0, read));
    } finally {
      closeSync(file);
    }
    return hasher.digest("hex");
  },
  catch: (cause) => new StorageFailure({ problem: `hash ${path}: ${String(cause)}` }),
});

interface Inode {
  readonly paths: string[];
  readonly size: number;
  readonly links: number;
  readonly device: number;
}

const inodesOf = (paths: readonly string[]) => {
  const inodes = new Map<string, Inode>();
  for (const path of paths) {
    const { dev, ino, size, nlink } = statSync(path);
    const known = inodes.get(`${dev}:${ino}`);
    if (known === undefined) inodes.set(`${dev}:${ino}`, { paths: [path], size, links: nlink, device: dev });
    else known.paths.push(path);
  }
  return [...inodes.values()];
};

const groupBy = <A>(items: readonly A[], key: (item: A) => string) => {
  const groups = new Map<string, A[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return [...groups.values()];
};

const identical = (inodes: readonly Inode[]) => inodes.length === 1
  ? Effect.succeed([inodes])
  : Effect.forEach(inodes, (inode) => hashOf(inode.paths[0]!).pipe(Effect.map((hash) => ({ inode, hash })))).pipe(
    Effect.map((hashed) => groupBy(hashed, ({ hash }) => hash).map((group) => group.map(({ inode }) => inode))));

const shareInodes = (same: readonly Inode[]) => Effect.try({
  try: () => {
    const [kept, ...others] = [...same].sort((a, b) => b.links - a.links);
    if (kept === undefined || kept.links + others.length === 1) return { linked: 0, freedBytes: 0 };
    for (const inode of others) for (const path of inode.paths) share(kept.paths[0]!, path);
    return {
      linked: others.reduce((sum, inode) => sum + inode.paths.length, 0),
      freedBytes: others.filter((inode) => inode.paths.length === inode.links).reduce((sum, inode) => sum + inode.size, 0),
    };
  },
  catch: (cause) => new StorageFailure({ problem: `share ${same[0]?.paths[0]}: ${String(cause)}` }),
});

const ownCopy = (path: string) => replaceWith(path, (temporary) => {
  copyFileSync(path, temporary);
  chmodSync(temporary, PRIVATE_MODE);
});

const separateGameWritten = (installs: readonly string[]) => Effect.try({
  try: () => {
    const linked = installs.flatMap((install) => storageFiles(install).filter(isGameWritten).map((file) => storagePath(install, file))).filter((path) => statSync(path).nlink > 1);
    for (const path of linked) ownCopy(path);
    return linked.length;
  },
  catch: (cause) => new StorageFailure({ problem: `give each install its own game-written storage files: ${String(cause)}` }),
});

export const shareStorage = (installs: readonly string[]) => Effect.gen(function*() {
  const separated = yield* separateGameWritten(installs);
  const located = installs.flatMap((install) => storageFiles(install).filter((file) => !isGameWritten(file)).map((file) => ({ file, path: storagePath(install, file) })));
  let linked = 0, freedBytes = 0;
  for (const paths of groupBy(located, ({ file }) => file)) {
    const inodes = yield* Effect.try({ try: () => inodesOf(paths.map(({ path }) => path)), catch: (cause) => new StorageFailure({ problem: `read ${paths[0]?.file}: ${String(cause)}` }) });
    for (const candidates of groupBy(inodes, (inode) => `${inode.device}:${inode.size}`)) {
      for (const same of yield* identical(candidates)) {
        const shared = yield* shareInodes(same);
        linked += shared.linked;
        freedBytes += shared.freedBytes;
      }
    }
  }
  return { linked, freedBytes, separated };
});

export const sharedFiles = (install: string) => storageFiles(install).filter((file) => !isGameWritten(file) && statSync(storagePath(install, file)).nlink > 1);

export const unshareStorage = (install: string) => Effect.try({
  try: () => {
    const files = sharedFiles(install);
    let bytes = 0;
    for (const file of files) {
      const path = storagePath(install, file);
      ownCopy(path);
      bytes += statSync(path).size;
    }
    return { files: files.length, bytes };
  },
  catch: (cause) => new StorageFailure({ problem: `give ${install} its own storage: ${String(cause)}` }),
});
