import { readdir } from "node:fs/promises";

import { expect } from "bun:test";
import { join, relative } from "node:path";
import ts from "typescript";
import { parseConfigFileWithSystem, transpileFiles } from "typescript-to-lua";
import { NUMBER_RULE_CODE } from "../plugins/number-rules";
import { numberRuleReport } from "../scripts/numberRules";
import { farmTest } from "../scripts/wisp/farm/farmTest";

const root = join(import.meta.dir, "..");

const line = (diagnostic: ts.Diagnostic, cwd: string) => {
  const file = diagnostic.file!;
  const { line, character } = file.getLineAndCharacterOfPosition(diagnostic.start!);
  return `${relative(cwd, file.fileName)}(${line + 1},${character + 1}): ${ts.DiagnosticCategory[diagnostic.category]} TS${diagnostic.code}`;
};

farmTest("[spec #7] a number or string tested for truthiness fails compilation on its line; booleans and objects that may be undefined pass", async () => {
  const fixture = join(import.meta.dir, "traps/truthiness.ts");
  const { options } = parseConfigFileWithSystem(join(root, "test/tsconfig.traps.json"));
  const { luaBundle, luaBundleEntry, ...unbundled } = options;
  const { diagnostics } = transpileFiles([fixture], { ...unbundled, rootDir: root, noEmitOnError: false }, () => {});
  const reported = diagnostics.filter((diagnostic) => diagnostic.code === NUMBER_RULE_CODE).map((diagnostic) => line(diagnostic, root));
  const lines = (await Bun.file(fixture).text()).split("\n");
  const rejected = lines.flatMap((text, index) => {
    const form = /\/\/ rejected: (.*)$/.exec(text)?.[1];
    return form === undefined ? [] : [`test/traps/truthiness.ts(${index + 1}): Error TS${NUMBER_RULE_CODE}`];
  });
  expect(reported.map((report) => report.replace(/,\d+\)/, ")"))).toEqual(rejected);
  // Every other trap fixture fails compilation on exactly the lines marked rejected.
  const traps = join(import.meta.dir, "traps");
  const others = (await readdir(traps)).filter((name) => name !== "truthiness.ts").map((name) => join(traps, name));
  const failed = transpileFiles(others, { ...unbundled, rootDir: root, noEmitOnError: false }, () => {}).diagnostics
    .filter((diagnostic) => diagnostic.file !== undefined && diagnostic.category === ts.DiagnosticCategory.Error).map((diagnostic) => line(diagnostic, root).replace(/,\d+\).*$/, ")"));
  const marked = (await Promise.all(others.map(async (file) => (await Bun.file(file).text()).split("\n")
    .flatMap((text, index) => text.includes("// rejected") ? [`${relative(root, file)}(${index + 1})`] : [])))).flat();
  expect([...new Set(failed)].sort()).toEqual(marked.sort());
}, 120_000);

farmTest("[spec #129] the check command reports every number-rule error the Lua32 compile reports, on the same line and column", async () => {
  const cwd = join(import.meta.dir, "refused");
  // Each input Smashcraft's Autoland refused at the Lua32 compile, by line and the start of its diagnostic.
  const refused = [
    ["4,17", "`||` tests a number or string"],
    ["4,29", "`||` tests a number or string"],
    ["5,22", "`%` truncates"],
    ["6,17", "10.6 isn't a binary32 value"],
    ["7,7", "an `if` condition tests a number or string"],
  ];
  const { options } = parseConfigFileWithSystem(join(cwd, "tsconfig.json"));
  const compiled = transpileFiles([join(cwd, "inputs.ts")], { ...options, noEmitOnError: false }, () => {}).diagnostics
    .filter((diagnostic) => diagnostic.code === NUMBER_RULE_CODE)
    .map((diagnostic) => `${line(diagnostic, cwd).replace(/ Error /, " error ")}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`);
  const checked = await numberRuleReport(["tsconfig.json"], { cwd, cachePath: join(root, "build/number-rules-refused.json") });
  expect(checked).toEqual(compiled);
  expect(checked.map((report, index) => {
    const [, at, message] = /^inputs\.ts\((\d+,\d+)\): error TS9300: (.*)$/.exec(report) ?? [];
    return [at, message?.slice(0, refused[index]?.[1]?.length)];
  })).toEqual(refused);
}, 120_000);

async function tsserver(cwd: string, probe: string, requests: readonly { readonly command: string; readonly arguments: object }[]) {
  const server = Bun.spawn([process.execPath, join(root, "node_modules/typescript/lib/tsserver.js"), "--disableAutomaticTypingAcquisition", "--pluginProbeLocations", probe], {
    cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });

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
