import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { Repro, ReproInspection, ReproInspector } from "../../src/runtime/repro";
import type { HeadlessMap } from "./headless";
import { inspectClientStates } from "./commands/repro";
import { diffReproStates } from "./reproInspection";
import { panelServer } from "./panelServer";
import { REPRO_VIEWER_PAGE } from "./reproViewerPage";

export interface DeclarationSource { readonly file: string; readonly line: number }
export interface ReproViewerSources { readonly project: string; readonly file: string; readonly type: string }


export function declarationMap(config: ReproViewerSources): (path: string) => DeclarationSource | undefined {
  const parsed = ts.getParsedCommandLineOfConfigFile(resolve(config.project), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: diagnostic => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")); } });
  if (parsed === undefined) throw new Error(`can't read ${config.project}`);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(resolve(config.file));
  const declaration = file?.statements.find(statement => (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name.text === config.type);
  if (declaration === undefined) throw new Error(`no type ${config.type} in ${config.file}`);
  const root = checker.getTypeAtLocation(declaration);
  return path => {
    let type = root;
    let source: DeclarationSource | undefined;
    for (const key of path.replace(/\[(\d+)\]/g, ".$1").split(".")) {
      type = checker.getNonNullableType(type);
      if (/^\d+$/.test(key)) {
        const item = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
        if (item === undefined) return undefined;
        type = item;
        continue;
      }
      const property = checker.getPropertyOfType(type, key);
      const node = property?.valueDeclaration ?? property?.declarations?.[0];
      if (property === undefined || node === undefined) return undefined;
      const original = node.getSourceFile();
      source = { file: original.fileName, line: original.getLineAndCharacterOfPosition(node.getStart()).line + 1 };
      type = checker.getTypeOfSymbolAtLocation(property, node);
    }
    return source;
  };
}

export function createReproViewer(map: HeadlessMap, inspect: ReproInspector, repro: Repro, sources?: ReproViewerSources, scanDivergence = true) {
  const cached = new Map<number, readonly ReproInspection[]>();
  const read = (frame: number) => {
    const prior = cached.get(frame);
    if (prior !== undefined) return prior;
    const states = inspectClientStates(map, inspect, repro, frame);


    if (cached.size >= 16) cached.delete(cached.keys().next().value ?? frame);
    cached.set(frame, states);
    return states;
  };

  let low = 0;
  let high = repro.frame;
  read(high);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    try { read(middle); high = middle; } catch { low = middle + 1; }
  }
  const start = low;
  let firstDivergentFrame: number | null = null;
  for (let frame = start; scanDivergence && frame <= repro.frame; frame++) {
    const states = read(frame);
    const a = states[0];
    const b = states[1];
    if (a !== undefined && b !== undefined && (a.checksum !== b.checksum || diffReproStates(a, b).length > 0)) { firstDivergentFrame = frame; break; }
  }
  const sourceFor = sources === undefined ? () => undefined : declarationMap(sources);
  const sourceFiles = new Set<string>();
  return {
    metadata: { build: repro.build, start, end: repro.frame, firstDivergentFrame, ...(scanDivergence ? {} : { divergenceScanned: false }) },
    frame(frame: number) {
      if (!Number.isSafeInteger(frame) || frame < start || frame > repro.frame) throw new Error(`frame must be in ${start}..${repro.frame}`);
      const states = read(frame);
      const before = frame === start ? undefined : read(frame - 1);
      const clients = states.map((state, client) => ({ ...state, client, changes: before?.[client] === undefined ? [] : diffReproStates(before[client], state), fields: state.fields.map(field => {
        const source = sourceFor(field.path);
        if (source !== undefined) sourceFiles.add(source.file);
        return { ...field, ...(source === undefined ? {} : { source }) };
      }) }));
      const a = states[0];
      const b = states[1];
      return { frame, clients, differences: a === undefined || b === undefined ? [] : diffReproStates(a, b) };
    },
    source(file: string) {
      if (!sourceFiles.has(file)) throw new Error("that file is not a state declaration");
      return readFileSync(file, "utf8");
    },
  };
}

export function serveReproViewer(viewer: ReturnType<typeof createReproViewer>, port = 0) {
  return panelServer(port, request => {
    const url = new URL(request.url);
    if (request.method !== "GET") return new Response("not found", { status: 404 });
    try {
      if (url.pathname === "/") return new Response(REPRO_VIEWER_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (url.pathname === "/meta") return Response.json(viewer.metadata);
      if (url.pathname === "/frame") return Response.json(viewer.frame(Number(url.searchParams.get("frame") ?? "NaN")), { headers: { "cache-control": "no-store" } });
      if (url.pathname === "/source") {
        const text = viewer.source(url.searchParams.get("file") ?? "");
        const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        return new Response(`<html><title>TypeScript declaration</title><pre>${escaped.split("\n").map((line, index) => `<span id="L${index + 1}">${index + 1}: ${line}</span>`).join("\n")}</pre><style>:target{background:#ffe08a}</style></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response("not found", { status: 404 });
    } catch (cause) { return Response.json({ error: String(cause) }, { status: 400 }); }
  });
}
