// Warcraft raw float arithmetic may round toward zero; check both Lua32 variants (docs/headless.md#raw-float-rounding).

import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { cacheHome } from "../os/xdg";
import { basename, join } from "node:path";
import { Console, Effect, Schedule, Schema } from "effect";
import { MapBuildFailure, captureProcess, runProcess } from "../process/hostProcess";
import { step } from "../process/timings";
import { usesWindowsTools, windowsTool } from "./windowsTools";

export const TOWARD_ZERO_HEADER = join(import.meta.dir, "../../native/toward-zero.h");

const FIXED_LAYOUT_HEADER = join(import.meta.dir, "../../native/fixed-layout.h");

const REQUESTED_BYTES_HEADER = join(import.meta.dir, "../../native/requested-bytes.h");

const SOURCE_EDITS: readonly (readonly [file: string, from: string, to: string])[] = [
  ["lstate.c", "g->seed = makeseed(L);", "g->seed = WISP_HASH_SEED; (void)makeseed;"],
  ["lua.c", "int main (int argc, char **argv) {\n", "int main (int argc, char **argv) {\n  wisp_fixed_addresses(argv);\n"],
  ["lstate.h", "} global_State;", "  size_t requested;\n} global_State;"],
  ["lstate.c", "  g->GCdebt = 0;\n", "  g->GCdebt = 0;\n  g->requested = 0;\n"],
  ["lmem.c", "  g->GCdebt = (g->GCdebt + nsize) - realosize;", "  if (nsize > realosize) wisp_charge(L, nsize - realosize);\n  g->GCdebt = (g->GCdebt + nsize) - realosize;"],
  ["lstring.c", "        changewhite(ts);  /* resurrect it */\n      return ts;", "        changewhite(ts);  /* resurrect it */\n      wisp_charge(L, sizelstring(l));\n      return ts;"],
  ["lstring.c", "      return p[j];  /* that is it */", "      return wisp_charge(L, sizelstring(strlen(str))), p[j];"],
  ["lstring.c", "    luaM_reallocvector(L, tb->hash, tb->size, newsize, TString *);\n    for", "    wisp_uncharged(L, luaM_reallocvector(L, tb->hash, tb->size, newsize, TString *));\n    for"],
  ["ldo.c", "  luaM_reallocvector(L, L->stack, L->stacksize, newsize, TValue);", "  wisp_uncharged(L, luaM_reallocvector(L, L->stack, L->stacksize, newsize, TValue));"],
  ["lstate.c", "  CallInfo *ci = luaM_new(L, CallInfo);", "  CallInfo *ci;\n  wisp_uncharged(L, ci = luaM_new(L, CallInfo));"],
  ["ltable.c", "    luaM_reallocvector(L, t->array, oldasize, nasize, TValue);", "    luaM_reallocvector(L, t->array, oldasize, nasize, TValue);\n    wisp_credit(L, (oldasize - nasize) * sizeof(TValue));"],
  ["ltable.c", "    luaM_freearray(L, nold, cast(size_t, oldhsize)); /* free old hash */", "    { luaM_freearray(L, nold, cast(size_t, oldhsize)); wisp_credit(L, cast(size_t, oldhsize) * sizeof(Node)); }"],
  ["lapi.c", "      res = g->gcrunning;\n      break;\n    }\n", "      res = g->gcrunning;\n      break;\n    }\n    case LUA_GCREQUESTED: {\n      res = (int)(unsigned int)g->requested;\n      break;\n    }\n"],
  ["lbaselib.c", "\"isrunning\", NULL};", "\"isrunning\", \"requested\", NULL};"],
  ["lbaselib.c", "    LUA_GCISRUNNING};", "    LUA_GCISRUNNING, LUA_GCREQUESTED};"],
];

const LUA_SOURCE = join(import.meta.dir, "../../vendor/lua-5.3.6.tar.gz");

const LUA_SOURCE_SHA256 = "fc5fd69bb8736323f026672b1b7235da613d7177e72558893a0bdcd320466d60";

const ROUNDING_PROBE = "local a, b = 3.0, 1e-30 io.write(a - b < a and 'toward-zero' or 'nearest')";

export const luaRounding = (lua: string) => Effect.gen(function*() {
  const integers = yield* captureProcess("probe Lua32", lua, [lua, "-e", "io.write(math.maxinteger)"]);
  if (integers.exitCode !== 0) return `${lua} doesn't run: ${integers.stderr.trim()}`;
  if (integers.stdout !== "2147483647") return `${lua} is not a 32-bit Lua (LUA_32BITS)`;
  const probe = (yield* captureProcess("probe Lua32 rounding", lua, [lua, "-e", ROUNDING_PROBE])).stdout;
  return probe === "toward-zero" ? "toward-zero" : "nearest";
});

export type Lua32Variant = "stock" | "toward-zero";

const fail = (operation: string, path: string, cause: unknown) => new MapBuildFailure({ operation, path, cause });
const sha256 = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const trySync = <A>(operation: string, path: string, run: () => A) => Effect.try({ try: run, catch: (cause) => fail(operation, path, cause) });

class LockHeld extends Schema.TaggedError<LockHeld, { readonly brand: unique symbol }>()("LockHeld", { path: Schema.String }) {}

export const lua32CacheRoot = () => join(cacheHome(), "wisp/lua32");

const headersFor = (variant: Lua32Variant) => variant === "stock"
  ? [FIXED_LAYOUT_HEADER, REQUESTED_BYTES_HEADER]
  : [FIXED_LAYOUT_HEADER, REQUESTED_BYTES_HEADER, TOWARD_ZERO_HEADER];

const luaSource = trySync("read Lua source", LUA_SOURCE, () => sha256(readFileSync(LUA_SOURCE))).pipe(
  Effect.flatMap((digest) => digest === LUA_SOURCE_SHA256
    ? Effect.succeed(LUA_SOURCE)
    : Effect.fail(fail("check Lua source", LUA_SOURCE, `SHA-256 ${digest} is not lua-5.3.6.tar.gz's`))),
);

const makeCommand = (args: readonly string[]) => Bun.which("gcc") !== null && Bun.which("make") !== null
  ? ["make", ...args]
  : ["nix", "shell", "nixpkgs#gcc", "nixpkgs#gnumake", "--command", "make", ...args];

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

      alive = holder === 0 || (Number.isInteger(holder) && process.kill(holder, 0));
    } catch (cause) {

      alive = (cause as NodeJS.ErrnoException).code === "ENOENT";
    }
    if (!alive) rmSync(lock, { force: true });
    return Effect.fail(new LockHeld({ path: lock }));
  // Not a poll: it retries taking the build lock while another process holds it.
  }).pipe(Effect.retry({ while: (error) => error._tag === "LockHeld", schedule: Schedule.spaced("200 millis"), times: 6000 })),
  () => Effect.sync(() => rmSync(lock, { force: true })),
);

const lua32Recipe = (variant: Lua32Variant) => {
  const headers = headersFor(variant).map((path) => [basename(path), readFileSync(path, "utf8")] as const);
  const flags = ["-DLUA_32BITS", ...headers.map(([name]) => `-include ${name}`)].join(" ");
  const key = sha256([LUA_SOURCE_SHA256, "generic", flags, ...headers.flat(), ...SOURCE_EDITS.flat()].join("\0")).slice(0, 16);
  return { headers, flags, key };
};

export const lua32Key = (variant: Lua32Variant) => lua32Recipe(variant).key;

export const compileLua32 = (variant: Lua32Variant, build: string, makeArgs: readonly string[] = []) => Effect.gen(function*() {
  const { headers, flags } = lua32Recipe(variant);
  const source = yield* luaSource;
  yield* trySync("prepare build", build, () => {
    rmSync(build, { recursive: true, force: true });
    mkdirSync(build, { recursive: true });
  });
  yield* trySync("decompress Lua source", build, () => writeFileSync(join(build, "lua-5.3.6.tar"), Bun.gunzipSync(readFileSync(source))));
  yield* runProcess("unpack Lua source", build, ["tar", "--no-same-owner", "-xf", "lua-5.3.6.tar"], build);
  const src = join(build, "lua-5.3.6/src");
  yield* trySync("write headers", src, () => {
    for (const [name, text] of headers) writeFileSync(join(src, name), text);
  });
  yield* trySync("edit Lua source", src, () => {
    for (const [file, from, to] of SOURCE_EDITS) {
      const text = readFileSync(join(src, file), "utf8");
      if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
      writeFileSync(join(src, file), text.replace(from, to));
    }
  });
  yield* runProcess(`compile Lua32 ${variant}`, src, makeCommand(["-C", src, `-j${availableParallelism()}`, "generic", `MYCFLAGS=${flags}`, ...makeArgs]));
  const executable = existsSync(join(src, "lua.exe")) ? "lua.exe" : "lua";
  const rounding = yield* luaRounding(join(src, executable));
  const expected = variant === "stock" ? "nearest" : "toward-zero";
  if (rounding !== expected) return yield* fail("check rounding", src, `it rounds ${rounding}, not ${expected}`);
  return { src, executable };
});

export const lua32 = (variant: Lua32Variant) => Effect.gen(function*() {
  const { key } = lua32Recipe(variant);
  if (usesWindowsTools()) return yield* windowsTool(`lua32-${variant}.exe`, key);
  const root = lua32CacheRoot();
  const directory = join(root, key);
  const installed = () => [join(directory, "lua"), join(directory, "lua.exe")].find((path) => existsSync(path));
  const cached = installed();
  if (cached !== undefined) return cached;
  yield* trySync("create Lua cache", root, () => mkdirSync(root, { recursive: true }));
  return yield* Effect.scoped(Effect.gen(function*() {
    yield* buildLock(`${directory}.lock`);
    const raced = installed();
    if (raced !== undefined) return raced;
    const build = `${directory}.build`;
    const { src, executable } = yield* compileLua32(variant, build);
    yield* trySync("install Lua32", directory, () => {
      mkdirSync(`${build}/out`);
      copyFileSync(join(src, executable), `${build}/out/${executable}`);
      rmSync(directory, { recursive: true, force: true });
      renameSync(`${build}/out`, directory);
      rmSync(build, { recursive: true, force: true });
    });
    return join(directory, executable);
  }));
}).pipe(step(`Lua32 ${variant}`));

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
