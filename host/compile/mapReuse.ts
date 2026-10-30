import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { Console, Effect } from "effect";
import { cacheHome } from "../os/xdg";
import { captureProcess, runProcess, tryMapSync } from "../cli/hostProcess";
import { holdLock } from "../cli/flockHold";

const DEFAULT_CAP_GIB = 8;
const SIDECARS = [".base.lua"] as const;
const MAP_FILE = "map.w3x";
const UNPACK = 'set -o pipefail; staging=$1; shift; "$@" | tar -xf - -C "$staging"';
const REMOTE_STORE = '"${WISP_MAP_REUSE_STORE:-${XDG_CACHE_HOME:-$HOME/.cache}/wisp/maps}"';

export const reuseStore = () => process.env.WISP_MAP_REUSE_STORE || join(cacheHome(), "wisp/maps");

/** `$WISP_MAP_REUSE_PEERS`: the ssh destinations whose store a build missing here is copied from, under the same key, before building it. */
export const reusePeers = () => (process.env.WISP_MAP_REUSE_PEERS ?? "").split(/[\s,]+/).filter((peer) => peer !== "");

export const sshTo = (peer: string): readonly string[] => ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", peer];

/** Copies a peer's stored build of `key` into `store` under the same key; false when the peer has none or cannot be reached. */
export const copyFromPeer = (store: string, key: string, remote: readonly string[]) => {
  const staging = join(store, `.peer-${key}-${process.pid}`);
  return Effect.acquireUseRelease(
    tryMapSync("stage a map copy from a peer", staging, () => {
      rmSync(staging, { recursive: true, force: true });
      mkdirSync(staging, { recursive: true });
    }),
    () => runProcess("copy a stored map from a peer", store, ["bash", "-c", UNPACK, "bash", staging, ...remote, `cd ${REMOTE_STORE} && test -f ${key}/${MAP_FILE} && tar -cf - ${key}`]).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
      Effect.flatMap((fetched) => fetched && existsSync(join(staging, key, MAP_FILE))
        ? tryMapSync("place the peer's map copy", store, () => {
          rmSync(join(store, key), { recursive: true, force: true });
          renameSync(join(staging, key), join(store, key));
          return true;
        })
        : Effect.succeed(false)),
    ),
    () => Effect.sync(() => rmSync(staging, { recursive: true, force: true })),
  );
};

const positive = (text: string | undefined) => {
  const gib = Number(text);
  return text !== undefined && text.trim() !== "" && Number.isFinite(gib) && gib > 0 ? gib : undefined;
};

const hostMapShare = captureProcess("read the host's map store share", "map_store", ["north", "capacity", "disk-share", "map_store"]).pipe(
  Effect.map(({ exitCode, stdout }) => (exitCode === 0 ? stdout.trim() : undefined)),
  Effect.orElseSucceed(() => undefined),
);

/** The store's cap: `$WISP_MAP_REUSE_GIB`, else the map_store share of the host's disk budget in orchestration.toml, else 8 GiB. */
export const reuseCapBytes = (hostShare: Effect.Effect<string | undefined> = hostMapShare) => {
  const fromEnv = positive(process.env.WISP_MAP_REUSE_GIB);
  const gib = fromEnv === undefined ? hostShare.pipe(Effect.map((share) => positive(share) ?? DEFAULT_CAP_GIB)) : Effect.succeed(fromEnv);
  return gib.pipe(Effect.map((value) => value * 2 ** 30));
};

/** The hash of exactly the named inputs: each label and value is length-prefixed, so no two input sets share a key. */
export const mapReuseKey = (inputs: Readonly<Record<string, string | Uint8Array>>): string => {
  const hash = new Bun.CryptoHasher("sha256");
  for (const label of Object.keys(inputs).sort()) {
    const value = inputs[label] ?? "";
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    hash.update(`${label}\0${bytes.length}\0`).update(bytes);
  }
  return hash.digest("hex");
};

const directorySize = (directory: string): number =>
  readdirSync(directory).reduce((total, name) => total + statSync(join(directory, name)).size, 0);

/** Removes the least recently used entries until the store fits `capBytes`; the entry named `keep` stays whatever its size. */
export const pruneReuseStore = (store: string, capBytes: number, keep: string): readonly string[] => {
  if (!existsSync(store)) return [];
  const entries = readdirSync(store).filter((name) => /^[0-9a-f]{64}$/.test(name)).map((name) => {
    const path = join(store, name);
    return { name, path, used: statSync(path).mtimeMs, size: directorySize(path) };
  }).sort((left, right) => right.used - left.used);
  let total = entries.reduce((sum, { size }) => sum + size, 0);
  const removed: string[] = [];
  for (const entry of [...entries].reverse()) {
    if (total <= capBytes) break;
    if (entry.name === keep) continue;
    rmSync(entry.path, { recursive: true, force: true });
    total -= entry.size;
    removed.push(entry.name);
  }
  return removed;
};

const lockPath = (store: string, key: string) => join(store, `${key}.lock`);

const copyMap = (from: string, to: string) => {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  for (const suffix of SIDECARS) if (existsSync(`${from}${suffix}`)) copyFileSync(`${from}${suffix}`, `${to}${suffix}`);
};

export interface MapReuse<E, R> {
  readonly key: string;
  readonly out: string;
  readonly build: Effect.Effect<void, E, R>;
  readonly store?: string;
  readonly peers?: readonly string[];
  readonly remote?: (peer: string) => readonly string[];
}

/** Puts at `out` the map of `key`: the stored one when a build of the same inputs finished here or on a peer, else the one `build` writes, which it then stores. Concurrent callers with one key wait for the first build and reuse it. */
export const reuseOrBuild = <E, R>({ key, out, build, store = reuseStore(), peers = reusePeers(), remote = sshTo }: MapReuse<E, R>) => Effect.scoped(Effect.gen(function*() {
  yield* tryMapSync("create the map store", store, () => mkdirSync(store, { recursive: true }));
  yield* holdLock(lockPath(store, key));
  const entry = join(store, key);
  const stored = join(entry, MAP_FILE);
  for (const peer of peers) {
    if (existsSync(stored)) break;
    if (yield* copyFromPeer(store, key, remote(peer))) yield* Console.log(`copied map build ${key} from ${peer}`);
  }
  if (existsSync(stored)) {
    yield* tryMapSync("reuse the stored map", stored, () => {
      const now = new Date();
      utimesSync(entry, now, now);
      copyMap(stored, out);
    });
    yield* Console.log(`reused map build ${key}`);
    return { reused: true, key } as const;
  }
  yield* build;
  const capBytes = yield* reuseCapBytes();
  yield* tryMapSync("store the built map", entry, () => {
    const staging = join(store, `.staging-${key}-${process.pid}`);
    rmSync(staging, { recursive: true, force: true });
    copyMap(out, join(staging, MAP_FILE));
    rmSync(entry, { recursive: true, force: true });
    renameSync(staging, entry);
    for (const name of pruneReuseStore(store, capBytes, key)) console.log(`dropped stored map build ${name}`);
  });
  yield* Console.log(`stored map build ${key}`);
  return { reused: false, key } as const;
}));
