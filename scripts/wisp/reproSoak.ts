import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { installHeadless } from "./headless";
import { describeCause } from "./command";
import { loadSoakGame, loadSoakProject, playSoakMatch, readSoakRepro } from "./soak";
import { shrinkSoakRepro, soakInputCount } from "./reproShrink";

const importFrom = (directory: string, file: string) => {
  const path = relative(directory, file).replace(/\.ts$/, "");
  return path.startsWith(".") ? path : `./${path}`;
};

class SoakReplayFailure extends Schema.TaggedError<SoakReplayFailure>()("SoakReplayFailure", { problem: Schema.String }) {}

export const replaySoakRepro = (file: string, declaration: { readonly project: string; readonly tests: string }, options: { readonly shrink: boolean; readonly out?: string; readonly name?: string }) =>
  Effect.tryPromise({ try: async () => {
    const project = await loadSoakProject(declaration.project);
    const game = await loadSoakGame(project.game);
    const original = readSoakRepro(readFileSync(file, "utf8"));
    if (original.project !== project.name) throw new Error(`${file} belongs to ${original.project}, not ${project.name}`);
    let repro = original;
    const output: string[] = [];
    if (options.shrink) {
      const shrunk = shrinkSoakRepro(project, game, original);
      repro = shrunk.repro;
      const target = resolve(options.out ?? file.replace(/(?:\.json)?$/, ".shrunk.json"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(repro)}\n`);
      output.push(`shrank ${shrunk.before} -> ${shrunk.after} inputs in ${(shrunk.elapsedMs / 1000).toFixed(3)} s (${shrunk.attempts} replays); wrote ${target}`);
    } else {
      const runtime = installHeadless(project.map);
      try {
        const result = playSoakMatch(runtime, game, project, repro.match, repro.inputs);
        const kind = repro.findings[0]?.kind;
        if (kind === undefined || !result.findings.some(finding => finding.kind === kind)) throw new Error(`the repro no longer fails with ${kind ?? "a recorded kind"}`);
      } finally {
        runtime.restore();
      }
    }
    output.push(`${soakInputCount(repro.inputs)} inputs; failure ${repro.findings[0]?.kind}`);
    if (options.name !== undefined) {
      const target = join(declaration.tests, `${options.name}.test.ts`);
      if (existsSync(target)) throw new Error(`${target} already exists`);
      mkdirSync(declaration.tests, { recursive: true });
      writeFileSync(target, [
        'import { test } from "bun:test";',
        'import { assertSoakReproFixed } from "wisp/scripts/wisp/reproShrink";',
        `import project from "${importFrom(declaration.tests, declaration.project)}";`,
        `import game from "${importFrom(declaration.tests, project.game)}";`,
        `const REPRO = ${JSON.stringify(repro)} as const;`,
        `test("repro ${options.name}", () => assertSoakReproFixed(project, game, REPRO));`, "",
      ].join("\n"));
      output.push(`wrote ${target}; the test passes when the recorded failure is fixed`);
    }
    return { output: output.join("\n"), failureKind: repro.findings[0]?.kind, inputs: soakInputCount(repro.inputs) };
  }, catch: cause => new SoakReplayFailure({ problem: describeCause(cause) }) });
