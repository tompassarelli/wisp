import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Console, Effect } from "effect";
import { MapBuildFailure, captureProcess, tryMapPromise, tryMapSync } from "../cli/hostProcess";
import { compileLua32, lua32Key } from "./lua32";
import { packagerSource } from "./mapBuild";
import { type WindowsToolsManifest, fileSha256 } from "./windowsTools";

const STORMLIB_VERSION = "9.30";

const STORMLIB_URL = `https://github.com/ladislav-zezula/StormLib/archive/refs/tags/v${STORMLIB_VERSION}.tar.gz`;

const STORMLIB_SHA256 = "a709a6b034d206404f5297d85e474371203ff5483639955195d99b737bbf7dfe";

const PACKAGER_SOURCE = join(import.meta.dir, "../../native/map-pack.c");

const LINK = ["-static", "-s", "-Wl,--no-insert-timestamp"];

const run = (operation: string, command: readonly string[], cwd?: string) =>
  captureProcess(operation, cwd ?? command[0] ?? "", command, cwd === undefined ? {} : { cwd }).pipe(
    Effect.flatMap(({ exitCode, stdout, stderr }) => exitCode === 0
      ? Effect.void
      : Effect.fail(new MapBuildFailure({ operation, path: command[0] ?? "", cause: `exited with ${exitCode}: ${`${stdout}\n${stderr}`.trim().slice(-4000)}` }))),
  );

const stormlib = (work: string) => Effect.gen(function*() {
  const archive = join(work, "stormlib.tar");
  const bytes = yield* tryMapPromise("download StormLib", STORMLIB_URL, async () => {
    const response = await fetch(STORMLIB_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  });
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  if (digest !== STORMLIB_SHA256) return yield* new MapBuildFailure({ operation: "check StormLib source", path: STORMLIB_URL, cause: `SHA-256 ${digest} is not v${STORMLIB_VERSION}'s` });
  yield* tryMapSync("decompress StormLib", archive, () => writeFileSync(archive, Bun.gunzipSync(bytes)));
  yield* run("unpack StormLib", ["tar", "--no-same-owner", "-xf", "stormlib.tar"], work);
  const source = join(work, `StormLib-${STORMLIB_VERSION}`);
  const build = join(work, "stormlib-build");
  yield* run("configure StormLib", ["cmake", "-S", source, "-B", build, "-G", "MinGW Makefiles", "-DCMAKE_SH=CMAKE_SH-NOTFOUND",
    "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF", "-DSTORM_USE_BUNDLED_LIBRARIES=ON", "-DSTORM_SKIP_INSTALL=ON"]);
  yield* run("build StormLib", ["cmake", "--build", build, "--parallel", String(availableParallelism())]);
  return { include: join(source, "src"), library: join(build, "libStormLib.a") };
});

const packager = (work: string, out: string) => Effect.gen(function*() {
  const { include, library } = yield* stormlib(work);
  const object = join(work, "map-pack.o");
  yield* run("compile map packager", ["gcc", "-O2", "-DSTORMLIB_NO_AUTO_LINK", `-I${include}`, "-c", PACKAGER_SOURCE, "-o", object]);
  yield* run("link map packager", ["g++", ...LINK, object, library, "-lwininet", "-o", join(out, "map-pack.exe")]);
  const usage = yield* captureProcess("run map packager", out, [join(out, "map-pack.exe")]);
  if (usage.exitCode !== 2) return yield* new MapBuildFailure({ operation: "run map packager", path: out, cause: `usage exited ${usage.exitCode}: ${usage.stderr}` });
});

const lua = (work: string, out: string) => Effect.gen(function*() {
  for (const variant of ["stock", "toward-zero"] as const) {
    const { src, executable } = yield* compileLua32(variant, join(work, `lua32-${variant}`), [`MYLDFLAGS=${LINK.join(" ")}`]);
    yield* tryMapSync("copy Lua32", src, () => {
      copyFileSync(join(src, executable), join(out, `lua32-${variant}.exe`));
      if (variant === "stock") copyFileSync(join(src, "luac.exe"), join(out, "luac.exe"));
    });
  }
});

export const buildWindowsTools = (out: string) => Effect.acquireUseRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wisp-windows-tools-"))),
  (work) => Effect.gen(function*() {
    yield* tryMapSync("create output", out, () => mkdirSync(out, { recursive: true }));
    yield* packager(work, out);
    yield* lua(work, out);
    const sources = { "map-pack.exe": packagerSource(), "lua32-stock.exe": lua32Key("stock"), "lua32-toward-zero.exe": lua32Key("toward-zero"), "luac.exe": lua32Key("stock") };
    const manifest: WindowsToolsManifest = {
      tools: Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, { sha256: fileSha256(join(out, name)), source }])),
    };
    yield* tryMapSync("write manifest", out, () => writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`));
    yield* Console.log(readFileSync(join(out, "manifest.json"), "utf8"));
  }),
  (work) => Effect.sync(() => rmSync(work, { recursive: true, force: true })),
);

if (import.meta.main) {
  const [out] = process.argv.slice(2);
  if (out === undefined || process.platform !== "win32") {
    console.error("usage (on Windows with MinGW and CMake): bun host/compile/buildWindowsTools.ts OUT");
    process.exit(2);
  }
  const exit = await Effect.runPromiseExit(buildWindowsTools(resolve(out)));
  if (exit._tag === "Failure") {
    console.error(String(exit.cause));
    process.exit(1);
  }
}
