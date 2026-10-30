import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { Effect, Schema } from "effect";

class StorageFailure extends Schema.TaggedError<StorageFailure, { readonly brand: unique symbol }>()("StorageFailure", {
  problem: Schema.String,
}) {
  override get message(): string {
    return this.problem;
  }
}

const SHARED_TREES = ["Data", "_retail_"];

// The game rewrites its storage's shmem files while it runs, so each install keeps its own; it opens the rest for writing too and fails on read-only ones.
const isShmem = (file: string) => file.startsWith("Data/") && basename(file) === "shmem";

const MENU_PAGE = "_retail_/webui/index.html";

const isOwn = (file: string) => isShmem(file) || file === MENU_PAGE;

const PRIVATE_MODE = 0o644;

const INSTALL_IN_PREFIX = "drive_c/Program Files (x86)/Warcraft III";

const PREFIX_DLLS = ["d3d9", "d3d11", "d3d12core", "dxgi", "amdxcffx64"].map((name) => `${name}.dll`);

const PREFIX_FOLDERS = ["drive_c/windows/system32", "drive_c/windows/syswow64"];

const prefixOf = (install: string) => {
  const folder = resolve(install);
  return folder.endsWith(`/${INSTALL_IN_PREFIX}`) ? folder.slice(0, -INSTALL_IN_PREFIX.length - 1) : undefined;
};

// Wine's graphics DLLs are the same bytes in every prefix of a pool, so they are shared when their contents match; prefix files are relative to the install.
const prefixFiles = (install: string): readonly string[] => {
  const prefix = prefixOf(install);
  return prefix === undefined ? [] : PREFIX_FOLDERS.flatMap((folder) => PREFIX_DLLS.map((dll) => relative(install, join(prefix, folder, dll)))).filter((file) => existsSync(join(install, file))).sort();
};

const sameBytes = (first: string, second: string) => statSync(first).size === statSync(second).size && readFileSync(first).equals(readFileSync(second));

const sharedTreeFiles = (install: string): readonly string[] => SHARED_TREES.flatMap((tree) => {
  const folder = join(install, tree);
  return existsSync(folder)
    ? readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => relative(install, join(entry.parentPath, entry.name)))
    : [];
}).sort();

const fieldsOf = (install: string) => {
  const [header, ...rows] = readFileSync(join(install, ".build.info"), "utf8").split(/\r?\n/).filter((line) => line.length > 0).map((line) => line.split("|"));
  const column = (name: string) => header?.findIndex((field) => field.split("!")[0] === name) ?? -1;
  const row = rows.find((fields) => fields[column("Active")] === "1") ?? rows[0];
  return (name: string) => row?.[column(name)] || undefined;
};

export const buildOf = (install: string) => fieldsOf(install)("Version");

const buildKeyOf = (install: string) => {
  const field = fieldsOf(install);
  return `${field("Version")}/${field("Build Key")}`;
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

const ownCopy = (source: string, target: string) => {
  mkdirSync(dirname(target), { recursive: true });
  replaceWith(target, (temporary) => {
    copyFileSync(source, temporary);
    chmodSync(temporary, PRIVATE_MODE);
  });
};

export interface Linked {
  readonly linked: number;
  readonly removed: number;
  readonly freedBytes: number;
}

const linkPrefixFiles = (base: string, install: string) => {
  let linked = 0, freedBytes = 0;
  for (const file of prefixFiles(base)) {
    const source = join(base, file), target = join(install, file);
    if (!existsSync(target)) continue;
    const present = statSync(target);
    if (present.ino === statSync(source).ino || !sameBytes(source, target)) continue;
    if (present.nlink === 1) freedBytes += present.size;
    replaceWith(target, (temporary) => linkSync(source, temporary));
    linked += 1;
  }
  return { linked, freedBytes };
};

// Makes install's Data/ and _retail_ a view of base's: every file but the game-written ones is a hardlink to base's, and files base lacks go,
// so an install never mixes its own .idx versions with base's archives. Its shmem files follow base's whenever its storage changed.
export const linkStorage = (base: string, install: string) => Effect.try({
  try: (): Linked => {
    const baseFiles = sharedTreeFiles(base);
    const kept = new Set(baseFiles);
    let linked = 0, removed = 0, freedBytes = 0;
    for (const file of sharedTreeFiles(install).filter((file) => !kept.has(file) && !isOwn(file))) {
      const { size, nlink } = statSync(join(install, file));
      rmSync(join(install, file));
      removed += 1;
      if (nlink === 1) freedBytes += size;
    }
    for (const file of baseFiles.filter((file) => !isOwn(file))) {
      const source = join(base, file), target = join(install, file);
      const present = existsSync(target) ? statSync(target) : undefined;
      if (present?.ino === statSync(source).ino) continue;
      if (present?.nlink === 1) freedBytes += present.size;
      mkdirSync(dirname(target), { recursive: true });
      replaceWith(target, (temporary) => linkSync(source, temporary));
      linked += 1;
    }
    const changed = linked + removed > 0;
    for (const file of baseFiles.filter(isOwn)) {
      const target = join(install, file);
      if (!existsSync(target) || statSync(target).nlink > 1 || (changed && isShmem(file))) ownCopy(join(base, file), target);
    }
    const prefix = linkPrefixFiles(base, install);
    linked += prefix.linked;
    freedBytes += prefix.freedBytes;
    return { linked, removed, freedBytes };
  },
  catch: (cause) => new StorageFailure({ problem: `link ${install}'s storage and _retail_ to ${base}'s: ${String(cause)}` }),
});

export const shareStorage = (base: string, installs: readonly string[]) => Effect.gen(function*() {
  const key = yield* Effect.try({ try: () => buildKeyOf(base), catch: (cause) => new StorageFailure({ problem: `read ${base}'s .build.info: ${String(cause)}` }) });
  const others = yield* Effect.try({ try: () => installs.filter((install) => buildKeyOf(install) !== key), catch: (cause) => new StorageFailure({ problem: `read an install's .build.info: ${String(cause)}` }) });
  if (others.length > 0) return yield* new StorageFailure({ problem: `${others.join(", ")} ${others.length === 1 ? "is" : "are"} not on ${base}'s build ${key}` });
  let linked = 0, removed = 0, freedBytes = 0;
  for (const install of installs) {
    const result = yield* linkStorage(base, install);
    linked += result.linked;
    removed += result.removed;
    freedBytes += result.freedBytes;
  }
  return { linked, removed, freedBytes };
});

export const sharedFiles = (install: string) => [...sharedTreeFiles(install), ...prefixFiles(install)].filter((file) => !isOwn(file) && statSync(join(install, file)).nlink > 1);

export const unshareStorage = (install: string) => Effect.try({
  try: () => {
    const files = sharedFiles(install);
    let bytes = 0;
    for (const file of files) {
      const path = join(install, file);
      ownCopy(path, path);
      bytes += statSync(path).size;
    }
    return { files: files.length, bytes };
  },
  catch: (cause) => new StorageFailure({ problem: `give ${install} its own storage and _retail_: ${String(cause)}` }),
});
