// A 32-bit Lua that rounds as Warcraft III's does: Lua 5.3.6 with LUA_32BITS
// and wisp:native/warcraft-rounding.h, whose raw float + - * round toward
// zero. Bun and stock Lua32 round to nearest, so a replay that equals Bun's
// in this Lua relies on no raw float operation Warcraft would round
// differently (wisp:docs/headless.md#warcraft-rounding).
//
// `bun node_modules/wisp/scripts/wisp/warcraftLua.ts DIRECTORY` prints the
// executable, building it in DIRECTORY when it is missing or its header
// changed. Building needs `nix`: nixpkgs' Lua 5.3.6 source, checked against
// lua.org's checksum, and its gcc.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Console, Effect } from "effect";
import { MapBuildFailure, captureProcess, runProcess } from "./mapBuild";
import { step } from "./timings";

export const WARCRAFT_ROUNDING_HEADER = join(import.meta.dir, "../../native/warcraft-rounding.h");

/** lua.org's SHA-256 of lua-5.3.6.tar.gz. */
const LUA_SOURCE_SHA256 = "fc5fd69bb8736323f026672b1b7235da613d7177e72558893a0bdcd320466d60";

/**
 * A Lua chunk that prints 3 - 1e-30 in binary32: the next binary32 below 3
 * when the subtraction rounds toward zero, as Warcraft's does; 3 when it rounds to nearest.
 */
export const ROUNDING_PROBE = "local a, b = 3.0, 1e-30 io.write(string.format('%a', a - b))";
export const WARCRAFT_ROUNDS = "0x1.7ffffep+1";

/** How `lua` rounds raw float arithmetic: "warcraft" (toward zero), "nearest", or why it can't tell. */
export function luaRounding(lua: string): "warcraft" | "nearest" | string {
  const integers = Bun.spawnSync([lua, "-e", "io.write(math.maxinteger)"], { stdout: "pipe", stderr: "pipe" });
  if (integers.exitCode !== 0) return `${lua} doesn't run: ${integers.stderr.toString().trim()}`;
  if (integers.stdout.toString() !== "2147483647") return `${lua} is not a 32-bit Lua (LUA_32BITS)`;
  const probe = Bun.spawnSync([lua, "-e", ROUNDING_PROBE], { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  return probe === WARCRAFT_ROUNDS ? "warcraft" : "nearest";
}

const fail = (operation: string, path: string, cause: unknown) => new MapBuildFailure({ operation, path, cause });

/** The Warcraft-rounding Lua's executable in `directory`, built there when it is missing or its header changed. */
export const warcraftLua = (directory: string) => Effect.gen(function*() {
  const lua = join(directory, "lua-5.3.6/src/lua");
  // The build's copy of the header, written after the previous build is removed: a Lua beside it was built with it.
  const copy = join(directory, "warcraft-rounding.h");
  const header = readFileSync(WARCRAFT_ROUNDING_HEADER, "utf8");
  if (existsSync(lua) && existsSync(copy) && readFileSync(copy, "utf8") === header) return lua;
  const source = yield* captureProcess("fetch Lua 5.3.6 source", directory, ["nix", "build", "--no-link", "--print-out-paths", "nixpkgs#lua5_3.src"]).pipe(
    Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0
      ? Effect.succeed(stdout.trim().split("\n")[0] ?? "")
      : Effect.fail(fail("fetch Lua 5.3.6 source", directory, `nix exited with ${exitCode}: ${stderr.trim()}`))),
  );
  const digest = new Bun.CryptoHasher("sha256").update(readFileSync(source)).digest("hex");
  if (digest !== LUA_SOURCE_SHA256) return yield* fail("check Lua source", source, `SHA-256 ${digest} is not lua-5.3.6.tar.gz's`);
  yield* Effect.try({
    try: () => {
      rmSync(join(directory, "lua-5.3.6"), { recursive: true, force: true });
      mkdirSync(directory, { recursive: true });
      writeFileSync(copy, header);
    },
    catch: (cause) => fail("prepare", directory, cause),
  });
  yield* runProcess("unpack Lua source", directory, ["tar", "-xzf", source, "-C", directory]);
  yield* runProcess("compile Lua with Warcraft's rounding", directory, ["nix", "shell", "nixpkgs#gcc", "nixpkgs#gnumake", "--command",
    "make", "-C", join(directory, "lua-5.3.6/src"), "-j2", "posix", `MYCFLAGS=-DLUA_32BITS -include ${copy}`]);
  const rounding = luaRounding(lua);
  if (rounding !== "warcraft") return yield* fail("check rounding", lua, rounding === "nearest" ? "it rounds to nearest" : rounding);
  return lua;
}).pipe(step("Lua with Warcraft's rounding"));

if (import.meta.main) {
  const [directory] = process.argv.slice(2);
  if (directory === undefined) {
    console.error("usage: bun warcraftLua.ts DIRECTORY");
    process.exit(2);
  }
  const exit = await Effect.runPromiseExit(warcraftLua(directory).pipe(Effect.flatMap((lua) => Console.log(lua))));
  if (exit._tag === "Failure") {
    console.error(String(exit.cause));
    process.exit(1);
  }
}
