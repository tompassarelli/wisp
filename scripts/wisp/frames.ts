import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArchiveEntry } from "./mapBuild";

export const FRAME_TYPES = ["FRAME", "BACKDROP", "TEXT", "GLUETEXTBUTTON"] as const;
export type FrameType = (typeof FRAME_TYPES)[number];

export const FRAME_POINTS = ["TOPLEFT", "TOP", "TOPRIGHT", "LEFT", "CENTER", "RIGHT", "BOTTOMLEFT", "BOTTOM", "BOTTOMRIGHT"] as const;
export type FramePoint = (typeof FRAME_POINTS)[number];

export const WARCRAFT_TEMPLATES = ["ScriptDialogButton", "EscMenuBackdrop"] as const;
const WARCRAFT_TEMPLATE_FDFS = new Map<string, string>([
  ["ScriptDialogButton", "UI\\FrameDef\\UI\\ScriptDialog.fdf"],
  ["EscMenuBackdrop", "UI\\FrameDef\\UI\\EscMenuTemplates.fdf"],
]);

export interface FrameAnchor {
  readonly point: FramePoint;

  readonly relative?: string;
  readonly relativePoint?: FramePoint;
  readonly x: number;
  readonly y: number;
}

export interface FrameNode {

  readonly key: string;
  readonly type: FrameType;

  readonly inherits?: string;
  readonly width?: number;
  readonly height?: number;
  readonly points?: readonly FrameAnchor[];

  readonly text?: string;

  readonly font?: { readonly file: string; readonly size: number };
  readonly justify?: { readonly horizontal: "LEFT" | "CENTER" | "RIGHT"; readonly vertical: "TOP" | "MIDDLE" | "BOTTOM" };

  readonly texture?: string;

  readonly enabled?: false;
  readonly children?: readonly FrameNode[];
}

export interface FrameDefinition {

  readonly name: string;
  readonly type: FrameType;
  readonly width: number;
  readonly height: number;

  readonly at?: { readonly point: FramePoint; readonly x: number; readonly y: number };
  readonly texture?: string;

  readonly level?: number;

  readonly templates?: readonly string[];
  readonly children: readonly FrameNode[];
}

export interface GeneratedFrames {

  readonly fdfEntry: string;
  readonly tocEntry: string;
  readonly fdf: string;
  readonly toc: string;

  readonly bindings: string;
}

export class FrameDefinitionError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`frame definition problems:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_KEYS = new Set(["root", "toc"]);

const capitalize = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
const flatten = (nodes: readonly FrameNode[]): FrameNode[] => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);

export function frameDefinitionProblems(definition: FrameDefinition): string[] {
  const problems: string[] = [];
  if (!IDENTIFIER.test(definition.name)) problems.push(`definition name "${definition.name}" is not an identifier`);
  if (!FRAME_TYPES.includes(definition.type)) problems.push(`root: unknown frame type "${definition.type}"`);
  const nodes = flatten(definition.children);
  const keys = new Set<string>(["root"]);
  const names = new Set<string>([definition.name]);
  for (const node of nodes) {
    if (!IDENTIFIER.test(node.key)) problems.push(`"${node.key}": key is not an identifier`);
    else if (RESERVED_KEYS.has(node.key)) problems.push(`"${node.key}": key is reserved`);
    else if (keys.has(node.key)) problems.push(`"${node.key}": duplicate key`);
    else {
      const name = definition.name + capitalize(node.key);
      if (names.has(name)) problems.push(`"${node.key}": frame name ${name} is already used`);
      names.add(name);
    }
    keys.add(node.key);
  }
  const templates = new Set<string>([...WARCRAFT_TEMPLATES, ...(definition.templates ?? []), ...names]);
  const text = (owner: string, field: string, value: string | undefined) => {
    if (value !== undefined && /["\r\n]/.test(value)) problems.push(`${owner}: ${field} contains a quote or line break`);
  };
  text("root", "texture", definition.texture);
  if (definition.texture !== undefined && definition.type !== "BACKDROP") problems.push(`root: texture needs a BACKDROP`);
  for (const node of nodes) {
    const owner = `"${node.key}"`;
    if (!FRAME_TYPES.includes(node.type)) problems.push(`${owner}: unknown frame type "${node.type}"`);
    if (node.inherits !== undefined && !templates.has(node.inherits)) problems.push(`${owner}: inherits unknown template "${node.inherits}"`);
    for (const anchor of node.points ?? []) {
      if (!FRAME_POINTS.includes(anchor.point)) problems.push(`${owner}: unknown point "${anchor.point}"`);
      if (anchor.relativePoint !== undefined && !FRAME_POINTS.includes(anchor.relativePoint)) problems.push(`${owner}: unknown point "${anchor.relativePoint}"`);
      if (anchor.relative !== undefined && !keys.has(anchor.relative)) problems.push(`${owner}: anchored to unknown frame "${anchor.relative}"`);
      if (anchor.relative === node.key) problems.push(`${owner}: anchored to itself`);
    }
    text(owner, "text", node.text);
    text(owner, "texture", node.texture);
    text(owner, "font", node.font?.file);
    if (node.text !== undefined && node.type !== "TEXT" && node.type !== "GLUETEXTBUTTON") problems.push(`${owner}: text needs a TEXT or GLUETEXTBUTTON`);
    if (node.font !== undefined && node.type !== "TEXT") problems.push(`${owner}: font needs a TEXT`);
    if (node.type === "TEXT" && node.font === undefined && node.inherits === undefined) problems.push(`${owner}: a TEXT frame needs a font or a template`);
    if (node.texture !== undefined && node.type !== "BACKDROP") problems.push(`${owner}: texture needs a BACKDROP`);
  }
  return problems;
}

const fdfNumber = (value: number) => {
  if (!Number.isFinite(value)) throw new FrameDefinitionError([`number ${value} is not finite`]);
  const fixed = value.toFixed(6).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
};

function fdfFrame(definition: FrameDefinition, node: FrameNode, name: string, parentName: string, depth: number): string[] {
  const pad = "    ".repeat(depth);
  const inner = `${pad}    `;
  const inherits = node.inherits === undefined ? "" : ` INHERITS WITHCHILDREN "${node.inherits}"`;
  const lines = [`${pad}Frame "${node.type}" "${name}"${inherits} {`];
  if (node.width !== undefined) lines.push(`${inner}Width ${fdfNumber(node.width)},`);
  if (node.height !== undefined) lines.push(`${inner}Height ${fdfNumber(node.height)},`);
  for (const anchor of node.points ?? []) {
    const relative = anchor.relative === undefined ? parentName : anchor.relative === "root" ? definition.name : definition.name + capitalize(anchor.relative);
    lines.push(`${inner}SetPoint ${anchor.point}, "${relative}", ${anchor.relativePoint ?? anchor.point}, ${fdfNumber(anchor.x)}, ${fdfNumber(anchor.y)},`);
  }
  if (node.texture !== undefined) lines.push(`${inner}BackdropBackground "${node.texture}",`, `${inner}BackdropBlendAll,`);
  if (node.type === "TEXT") {
    if (node.font !== undefined) lines.push(`${inner}FrameFont "${node.font.file}", ${fdfNumber(node.font.size)}, "",`);
    const justify = node.justify ?? { horizontal: "CENTER", vertical: "MIDDLE" };
    lines.push(`${inner}FontJustificationH JUSTIFY${justify.horizontal},`, `${inner}FontJustificationV JUSTIFY${justify.vertical},`);
    if (node.text !== undefined) lines.push(`${inner}Text "${node.text}",`);
  }
  for (const child of node.children ?? []) lines.push(...fdfFrame(definition, child, definition.name + capitalize(child.key), name, depth + 1));
  lines.push(`${pad}}`);
  return lines;
}

const scriptNumber = (value: number) => {
  if (!Number.isFinite(value)) throw new FrameDefinitionError([`number ${value} is not finite`]);
  return String(Math.fround(value));
};

function bindingsSource(definition: FrameDefinition, tocEntry: string): string {
  const nodes = flatten(definition.children);
  const type = `${definition.name}Frames`;
  const escaped = (value: string) => JSON.stringify(value);
  const lines = [
    `// Generated by wisp:scripts/wisp/frames.ts from the ${definition.name} definition. Do not edit.`,
    `export const ${definition.name.toUpperCase()}_TOC = ${escaped(tocEntry)};`,
    "",
    `export interface ${type} {`,
    "  readonly root: framehandle;",
    ...nodes.map((node) => `  readonly ${node.key}: framehandle;`),
    "}",
    "",
    `/** Loads the TOC, then creates the ${definition.name} tree; context tells copies apart. */`,
    `export function create${definition.name}(parent: framehandle, context: number): ${type} | undefined {`,

    `  if (!BlzLoadTOCFile(${definition.name.toUpperCase()}_TOC)) return undefined;`,
    `  const root = BlzCreateFrame(${escaped(definition.name)}, parent, 0, context);`,
  ];
  if (definition.at !== undefined) lines.push(`  BlzFrameSetAbsPoint(root, FRAMEPOINT_${definition.at.point}, ${scriptNumber(definition.at.x)}, ${scriptNumber(definition.at.y)});`);
  if (definition.level !== undefined) lines.push(`  BlzFrameSetLevel(root, ${definition.level});`);
  lines.push(`  const frames: ${type} = {`, "    root,");
  for (const node of nodes) lines.push(`    ${node.key}: BlzGetFrameByName(${escaped(definition.name + capitalize(node.key))}, context),`);
  lines.push("  };");
  for (const node of nodes) {
    if (node.type === "GLUETEXTBUTTON" && node.text !== undefined) lines.push(`  BlzFrameSetText(frames.${node.key}, ${escaped(node.text)});`);
    if (node.enabled === false) lines.push(`  BlzFrameSetEnable(frames.${node.key}, false);`);
  }
  lines.push("  return frames;", "}", "");
  return lines.join("\n");
}

export function generateFrames(definition: FrameDefinition): GeneratedFrames {
  const problems = frameDefinitionProblems(definition);
  if (problems.length > 0) throw new FrameDefinitionError(problems);
  const fdfEntry = `war3mapImported\\${definition.name}.fdf`;
  const tocEntry = `war3mapImported\\${definition.name}.toc`;
  const root: FrameNode = { key: "root", type: definition.type, width: definition.width, height: definition.height, children: definition.children, ...(definition.texture === undefined ? {} : { texture: definition.texture }) };
  const rootLines = fdfFrame(definition, root, definition.name, definition.name, 0);
  const sources = [...new Set(flatten(definition.children).flatMap((node) => {
    const source = node.inherits === undefined ? undefined : WARCRAFT_TEMPLATE_FDFS.get(node.inherits);
    return source === undefined ? [] : [source];
  }))];
  const includes = sources.length === 0 ? [] : [...sources.map((source) => `IncludeFile "${source}",`), ""];

  return { fdfEntry, tocEntry, fdf: `${[...includes, ...rootLines].join("\n")}\n`, toc: `${fdfEntry}\r\n\r\n`, bindings: bindingsSource(definition, tocEntry) };
}

export function writeFrames(definition: FrameDefinition, importDir: string, bindingsFile: string): ArchiveEntry[] {
  const generated = generateFrames(definition);
  mkdirSync(importDir, { recursive: true });
  const fdf = join(importDir, `${definition.name}.fdf`);
  const toc = join(importDir, `${definition.name}.toc`);
  writeFileSync(fdf, generated.fdf);
  writeFileSync(toc, generated.toc);
  writeFileSync(bindingsFile, generated.bindings);
  return [{ entry: generated.fdfEntry, source: fdf }, { entry: generated.tocEntry, source: toc }];
}
