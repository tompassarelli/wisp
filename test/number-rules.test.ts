// The compiler, the check command and the editor report the same number-rule
// errors at the same positions (wisp#7).
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { parseConfigFileWithSystem, transpileFiles } from "typescript-to-lua";
import { NUMBER_RULE_CODE, programNumberRules } from "../plugins/number-rules";
import { numberRuleReport } from "../scripts/numberRules";
import { writeEditorPlugin } from "../scripts/package";

const root = join(import.meta.dir, "..");

const line = (diagnostic: ts.Diagnostic, cwd: string) => {
  const file = diagnostic.file!;
  const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start!);
  return `${relative(cwd, file.fileName)}(${line + 1},${character + 1}): error TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
};

test("the check command reports the compiler's number-rule errors, from scratch and from its cache", async () => {
  const fixtures = join(import.meta.dir, "traps");
  const files = (await readdir(fixtures)).map((name) => join(fixtures, name));
  const { options } = parseConfigFileWithSystem(join(root, "test/tsconfig.traps.json"));
  const { luaBundle, luaBundleEntry, ...unbundled } = options;
  const { diagnostics } = transpileFiles(files, { ...unbundled, rootDir: root, noEmitOnError: false }, () => {});
  const compiled = diagnostics.filter((diagnostic) => diagnostic.code === NUMBER_RULE_CODE).map((diagnostic) => line(diagnostic, root)).sort();
  expect(compiled.length).toBe(23);
  await mkdir(join(root, "build"), { recursive: true });
  const directory = await mkdtemp(join(root, "build/number-rules-"));
  try {
    const run = () => numberRuleReport(["test/tsconfig.number-rules.json"], { cwd: root, cachePath: join(directory, "cache.json") });
    expect((await run()).sort()).toEqual(compiled);
    expect((await run()).sort()).toEqual(compiled);
  } finally {
    await rm(directory, { recursive: true });
  }
}, 20_000);

/** Sends tsserver requests in order and returns the response body of each one that answers. */
async function tsserver(cwd: string, probe: string, requests: readonly { readonly command: string; readonly arguments: object }[]) {
  const server = Bun.spawn([process.execPath, join(root, "node_modules/typescript/lib/tsserver.js"), "--disableAutomaticTypingAcquisition", "--pluginProbeLocations", probe], {
    cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  // `open` sends no response.
  const awaited = requests.flatMap((request, index) => (request.command === "open" ? [] : [index + 1]));
  const responses = new Map<number, unknown>();
  requests.forEach((request, index) => server.stdin.write(`${JSON.stringify({ seq: index + 1, type: "request", ...request })}\n`));
  await server.stdin.flush();
  let pending = Buffer.alloc(0);
  for await (const chunk of server.stdout) {
    pending = Buffer.concat([pending, chunk]);
    for (let headerEnd = pending.indexOf("\r\n\r\n"); headerEnd !== -1; headerEnd = pending.indexOf("\r\n\r\n")) {
      const length = Number(/Content-Length: (\d+)/.exec(pending.subarray(0, headerEnd).toString())?.[1]);
      const start = headerEnd + 4;
      if (pending.length < start + length) break;
      const message: { readonly type: string; readonly request_seq?: number; readonly body?: unknown } = JSON.parse(pending.subarray(start, start + length).toString());
      pending = pending.subarray(start + length);
      if (message.type === "response" && message.request_seq !== undefined) responses.set(message.request_seq, message.body);
    }
    if (awaited.every((seq) => responses.has(seq))) break;
  }
  server.kill();
  return awaited.map((seq) => responses.get(seq));
}

test("the editor reports the same number-rule errors through tsserver, only in the map's files", async () => {
  await mkdir(join(root, "build"), { recursive: true });
  const directory = await mkdtemp(join(root, "build/editor-"));
  try {
    await writeEditorPlugin(join(directory, "node_modules/wisp/plugins/number-rules-service.cjs"));
    const compilerOptions = { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, noEmit: true, types: [] };
    await Bun.write(join(directory, "tsconfig.json"), JSON.stringify({
      compilerOptions: { ...compilerOptions, plugins: [{ name: "wisp/plugins/number-rules-service.cjs", project: "./tsconfig.map.json" }] },
      include: ["src/**/*.ts", "host.ts"],
    }));
    await Bun.write(join(directory, "tsconfig.map.json"), JSON.stringify({ compilerOptions, include: ["src/**/*.ts"] }));
    await Bun.write(join(directory, "src/sim/f32.ts"), "export const f32 = (value: number) => Math.fround(value);\n");
    await Bun.write(join(directory, "src/map.ts"), [
      'import { f32 } from "./sim/f32";',
      'export const tenth = ["—", 0.1];',
      "export const named = f32(0.1);",
      "export const now = Date.now();",
      "export const share = (a: number, b: number) => a % b;",
      "",
    ].join("\n"));
    await Bun.write(join(directory, "host.ts"), "export const tenth = 0.1;\n");
    const map = join(directory, "src/map.ts");
    const host = join(directory, "host.ts");
    const [mapDiagnostics, hostDiagnostics] = await tsserver(directory, directory, [
      { command: "open", arguments: { file: map } },
      { command: "open", arguments: { file: host } },
      { command: "semanticDiagnosticsSync", arguments: { file: map } },
      { command: "semanticDiagnosticsSync", arguments: { file: host } },
    ]) as [readonly { start: { line: number; offset: number }; code: number; text: string }[], readonly { code: number }[]];
    const editor = mapDiagnostics.map(({ start, code, text }) => `src/map.ts(${start.line},${start.offset}): error TS${code}: ${text}`);
    const parsed = ts.getParsedCommandLineOfConfigFile(join(directory, "tsconfig.map.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const compiler = programNumberRules(ts, program, program.getSourceFile(map)!).map((diagnostic) => line(diagnostic, directory));
    expect(compiler.length).toBe(3);
    expect(editor).toEqual(compiler);
    expect(hostDiagnostics.filter(({ code }) => code === NUMBER_RULE_CODE)).toEqual([]);
  } finally {
    await rm(directory, { recursive: true });
  }
}, 20_000);
