import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { cacheHome } from "../os/xdg";

class WindowLibraryFailure extends Schema.TaggedError<WindowLibraryFailure, { readonly brand: unique symbol }>()("WindowLibraryFailure", { problem: Schema.String }) {
  override get message() { return this.problem; }
}

const SOURCE_FILES = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "flake.nix", "flake.lock"];

const sourceHash = (windowDirectory: string) => {
  const hasher = new Bun.CryptoHasher("sha256");
  const sources = [...new Bun.Glob("wisp-window/{Cargo.toml,src/**,assets/**}").scanSync({ cwd: windowDirectory, onlyFiles: true })].map((file) => file.replaceAll("\\", "/")).sort();
  for (const file of [...SOURCE_FILES, ...sources]) {
    const path = join(windowDirectory, file);
    if (existsSync(path)) hasher.update(`${file}\0`).update(readFileSync(path)).update("\0");
  }
  return hasher.digest("hex").slice(0, 16);
};

const cacheDirectory = (windowDirectory: string) => join(cacheHome(), "wisp/window", sourceHash(windowDirectory));

/** Where the build of `windowDirectory`'s source lands: the user cache, keyed by a hash of the source, so one package revision builds once however many checkouts consume it. */
export const cachedWindowLibrary = (windowDirectory: string, libraryFile: string) => join(cacheDirectory(windowDirectory), "release", libraryFile);

const hasNix = () => process.platform === "linux" && Bun.which("nix") !== null;

// With nix the dev shell supplies the toolchain, cmake and the runtime libraries, and links their store paths into the library's RUNPATH (window/flake.nix); elsewhere cargo builds against the system's.
const buildCommand = (windowDirectory: string) => hasNix()
  ? ["nix", "develop", "--extra-experimental-features", "nix-command flakes", `path:${windowDirectory}`, "--command", "cargo", "build", "--release", "--locked"]
  : ["cargo", "build", "--release", "--locked"];

/** Builds `window/` from this package into the user cache when `path` does not exist yet, then returns `path` (wisp:docs/native-window-plan.md, "Where a consumer gets the library"). */
export const buildWindowLibrary = (path: string, windowDirectory: string) => Effect.gen(function*() {
  if (existsSync(path)) return path;
  if (!existsSync(join(windowDirectory, "Cargo.toml"))) {
    return yield* new WindowLibraryFailure({ problem: `no wisp-window library at ${path} and no source at ${windowDirectory} to build one; set WISP_WINDOW_LIBRARY to a built library` });
  }
  const [program, ...args] = buildCommand(windowDirectory);
  const target = cacheDirectory(windowDirectory);
  console.log(`building wisp-window into ${target} (first run of this revision)`);
  const code = yield* ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.exitCode(ChildProcess.make(program!, args, {
    cwd: windowDirectory, env: { CARGO_TARGET_DIR: target }, extendEnv: true, stdin: "ignore", stdout: "inherit", stderr: "inherit",
  }))).pipe(Effect.mapError((failure) => new WindowLibraryFailure({ problem: `${program}: ${failure.message}` })));
  if (Number(code) !== 0 || !existsSync(path)) return yield* new WindowLibraryFailure({ problem: `building wisp-window with ${program} exited ${Number(code)}` });
  return path;
}).pipe(Effect.provide(BunServices.layer));
