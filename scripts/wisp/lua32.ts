// The pinned 32-bit Luas tests run in: Lua 5.3.6 from its checksummed release,
// `make generic` with LUA_32BITS, and its twin whose raw float + - * / and
// decimal numerals round toward zero (wisp:native/toward-zero.h). Warcraft's
// raw float arithmetic doesn't always round to nearest, and toward zero is the
// nearest model of it found; Bun and a stock Lua32 round to nearest. A replay
// or check that gives the same results in both Luas relies on no raw float
// + - * / or inexact numeral (wisp:docs/headless.md#raw-float-rounding).
//
// Each is built once per user into ~/.cache/wisp/lua32/KEY/lua, KEY hashing
// the source checksum, make target and flags; a lock file lets parallel
// worktrees share one build. Building needs gcc and make, or nix.
//
// `bun node_modules/wisp/scripts/wisp/lua32.ts [stock|toward-zero]` prints the
// executable, building it on first use.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import { Console, Effect, Schedule, Schema } from "effect";
import { MapBuildFailure, runProcess } from "./mapBuild";
import { step } from "./timings";

export const TOWARD_ZERO_HEADER = join(import.meta.dir, "../../native/toward-zero.h");

/** lua.org's SHA-256 of lua-5.3.6.tar.gz. */
const LUA_SOURCE_SHA256 = "fc5fd69bb8736323f026672b1b7235da613d7177e72558893a0bdcd320466d60";
/** Debian's copy is byte-identical; it answers where lua.org is unreachable. */
const LUA_SOURCE_URLS = [
  "https://www.lua.org/ftp/lua-5.3.6.tar.gz",
  "https://deb.debian.org/debian/pool/main/l/lua5.3/lua5.3_5.3.6.orig.tar.gz",
];

/** Prints 3 - 1e-30 in binary32: the binary32 below 3 when subtraction rounds toward zero, 3 when it rounds to nearest. */
const ROUNDING_PROBE = "local a, b = 3.0, 1e-30 io.write(string.format('%a', a - b))";
const TOWARD_ZERO_RESULT = "0x1.7ffffep+1";

/** How `lua` rounds raw float arithmetic: "toward-zero", "nearest", or why it can't tell. */
export function luaRounding(lua: string): "toward-zero" | "nearest" | string {
  const integers = Bun.spawnSync([lua, "-e", "io.write(math.maxinteger)"], { stdout: "pipe", stderr: "pipe" });
  if (integers.exitCode !== 0) return `${lua} doesn't run: ${integers.stderr.toString().trim()}`;
  if (integers.stdout.toString() !== "2147483647") return `${lua} is not a 32-bit Lua (LUA_32BITS)`;
  const probe = Bun.spawnSync([lua, "-e", ROUNDING_PROBE], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  return probe === TOWARD_ZERO_RESULT ? "toward-zero" : "nearest";
}

export type Lua32Variant = "stock" | "toward-zero";

const fail = (operation: string, path: string, cause: unknown) => new MapBuildFailure({ operation, path, cause });
const sha256 = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const trySync = <A>(operation: string, path: string, run: () => A) => Effect.try({ try: run, catch: (cause) => fail(operation, path, cause) });

/** Another process holds the build lock. */
class LockHeld extends Schema.TaggedError<LockHeld>()("LockHeld", { path: Schema.String }) {}

export const lua32CacheRoot = () => join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "wisp/lua32");

const flagsFor = (variant: Lua32Variant) => variant === "stock"
  ? { flags: "-DLUA_32BITS", header: "" }
  : { flags: "-DLUA_32BITS -include toward-zero.h", header: readFileSync(TOWARD_ZERO_HEADER, "utf8") };

/** The checked source tarball in `root`, downloaded on first use. */
const luaSource = (root: string) => Effect.gen(function*() {
  const tarball = join(root, "lua-5.3.6.tar.gz");
  if (existsSync(tarball) && sha256(readFileSync(tarball)) === LUA_SOURCE_SHA256) return tarball;
  const download = (url: string) => Effect.tryPromise({
    try: async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
    catch: (cause) => fail("download Lua 5.3.6 source", url, cause),
  }).pipe(Effect.flatMap((bytes) => {
    const digest = sha256(bytes);
    return digest === LUA_SOURCE_SHA256 ? Effect.succeed(bytes) : Effect.fail(fail("check Lua source", url, `SHA-256 ${digest} is not lua-5.3.6.tar.gz's`));
  }));
  const bytes = yield* Effect.firstSuccessOf(LUA_SOURCE_URLS.map(download));
  yield* trySync("save Lua source", tarball, () => {
    writeFileSync(`${tarball}.${process.pid}`, bytes);
    renameSync(`${tarball}.${process.pid}`, tarball);
  });
  return tarball;
});

/** `make` arguments run with gcc and make from PATH, else from nixpkgs. */
const makeCommand = (args: readonly string[]) => Bun.which("gcc") !== null && Bun.which("make") !== null
  ? ["make", ...args]
  : ["nix", "shell", "nixpkgs#gcc", "nixpkgs#gnumake", "--command", "make", ...args];

/** Holds `lock` (an exclusive file naming its pid) for the scope, waiting while a live process holds it. */
const buildLock = (lock: string) => Effect.acquireRelease(
  Effect.suspend((): Effect.Effect<void, LockHeld | MapBuildFailure> => {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return Effect.void;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") return Effect.fail(fail("take build lock", lock, cause));
    }
    let alive = false;
    try {
      const holder = Number(readFileSync(lock, "utf8"));
      // An empty lock is one its holder hasn't written its pid to yet.
      alive = holder === 0 || (Number.isInteger(holder) && process.kill(holder, 0));
    } catch (cause) {
      // ENOENT: released meanwhile. ESRCH: its build died and left the lock.
      alive = (cause as NodeJS.ErrnoException).code === "ENOENT";
    }
    if (!alive) rmSync(lock, { force: true });
    return Effect.fail(new LockHeld({ path: lock }));
  }).pipe(Effect.retry({ while: (error) => error._tag === "LockHeld", schedule: Schedule.spaced("200 millis"), times: 6000 })),
  () => Effect.sync(() => rmSync(lock, { force: true })),
);

/** The cached Lua32 `variant`'s executable, built on first use. */
export const lua32 = (variant: Lua32Variant) => Effect.gen(function*() {
  const root = lua32CacheRoot();
  const { flags, header } = flagsFor(variant);
  const key = sha256(`${LUA_SOURCE_SHA256}\0generic\0${flags}\0${header}`).slice(0, 16);
  const directory = join(root, key);
  const lua = join(directory, "lua");
  if (existsSync(lua)) return lua;
  yield* trySync("create Lua cache", root, () => mkdirSync(root, { recursive: true }));
  return yield* Effect.scoped(Effect.gen(function*() {
    yield* buildLock(`${directory}.lock`);
    if (existsSync(lua)) return lua;
    const source = yield* luaSource(root);
    const build = `${directory}.build`;
    yield* trySync("prepare build", build, () => {
      rmSync(build, { recursive: true, force: true });
      mkdirSync(build, { recursive: true });
    });
    yield* runProcess("unpack Lua source", build, ["tar", "-xzf", source, "-C", build]);
    const src = join(build, "lua-5.3.6/src");
    if (header !== "") yield* trySync("write header", src, () => writeFileSync(join(src, "toward-zero.h"), header));
    yield* runProcess(`compile Lua32 ${variant}`, src, makeCommand(["-C", src, `-j${availableParallelism()}`, "generic", `MYCFLAGS=${flags}`]));
    const rounding = luaRounding(join(src, "lua"));
    const expected = variant === "stock" ? "nearest" : "toward-zero";
    if (rounding !== expected) return yield* fail("check rounding", src, `it rounds ${rounding}, not ${expected}`);
    yield* trySync("install Lua32", directory, () => {
      mkdirSync(`${build}/out`);
      copyFileSync(join(src, "lua"), `${build}/out/lua`);
      rmSync(directory, { recursive: true, force: true });
      renameSync(`${build}/out`, directory);
      rmSync(build, { recursive: true, force: true });
    });
    return lua;
  }));
}).pipe(step(`Lua32 ${variant}`));

/** Points LUA and TOWARD_ZERO_LUA at the cached Lua32s where they are unset. */
export const provideLua32Env = Effect.gen(function*() {
  if (process.env.LUA === undefined) process.env.LUA = yield* lua32("stock");
  if (process.env.TOWARD_ZERO_LUA === undefined) process.env.TOWARD_ZERO_LUA = yield* lua32("toward-zero");
});

if (import.meta.main) {
  const [variant = "stock"] = process.argv.slice(2);
  if (variant !== "stock" && variant !== "toward-zero") {
    console.error("usage: bun lua32.ts [stock|toward-zero]");
    process.exit(2);
  }
  const exit = await Effect.runPromiseExit(lua32(variant).pipe(Effect.flatMap((lua) => Console.log(lua))));
  if (exit._tag === "Failure") {
    console.error(String(exit.cause));
    process.exit(1);
  }
}
