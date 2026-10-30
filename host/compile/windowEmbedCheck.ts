import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Console, Effect } from "effect";
import { MapBuildFailure, captureProcess, tryMapSync } from "../process/hostProcess";

const entrySource = (library: string) => `import embedded from "./lib/${library}" with { type: "file" };
import { dlopen } from "bun:ffi";
try {
  dlopen(embedded, { wisp_embed_probe_absent: { args: [], returns: "void" } });
} catch (error) {
  if (!String(error).includes("not found in")) throw error;
}
console.log(JSON.stringify({ path: embedded }));
`;

const run = (operation: string, command: readonly string[], cwd: string) =>
  captureProcess(operation, command[0] ?? "", command, { cwd }).pipe(
    Effect.map(({ exitCode, stdout, stderr }) => ({ exitCode, output: `${stdout}\n${stderr}`.trim().slice(-2000) })),
  );

export const windowEmbedCheck = (library: string, out: string) => Effect.acquireUseRelease(
  tryMapSync("create work directory", tmpdir(), () => mkdtempSync(join(tmpdir(), "window-embed-"))),
  (work) => Effect.gen(function*() {
    const name = basename(library);
    const executable = process.platform === "win32" ? "player.exe" : "player";
    yield* tryMapSync("stage the library", library, () => {
      mkdirSync(join(work, "src", "lib"), { recursive: true });
      mkdirSync(join(work, "alone"), { recursive: true });
      copyFileSync(library, join(work, "src", "lib", name));
      writeFileSync(join(work, "src", "entry.ts"), entrySource(name));
    });
    const compiled = yield* run("bun build --compile", ["bun", "build", "--compile", "entry.ts", "--outfile", join(work, "alone", executable)], join(work, "src"));
    if (compiled.exitCode !== 0) return yield* new MapBuildFailure({ operation: "bun build --compile", path: library, cause: compiled.output });
    const ran = yield* run("run the executable alone", [join(work, "alone", executable)], join(work, "alone"));
    const result = { library: name, bunVersion: Bun.version, platform: process.platform, embeddedLibraryOpens: ran.exitCode === 0, output: ran.output };
    yield* tryMapSync("write result", out, () => {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "embed.json"), `${JSON.stringify(result, null, 2)}\n`);
    });
    yield* Console.log(JSON.stringify(result));
  }),
  (work) => Effect.sync(() => rmSync(work, { recursive: true, force: true })),
);

if (import.meta.main) {
  const [library, out] = process.argv.slice(2);
  if (library === undefined || out === undefined) {
    console.error("usage: bun host/compile/windowEmbedCheck.ts LIBRARY OUT");
    process.exit(2);
  }
  const exit = await Effect.runPromiseExit(windowEmbedCheck(resolve(library), resolve(out)));
  if (exit._tag === "Failure") {
    console.error(String(exit.cause));
    process.exit(1);
  }
}
