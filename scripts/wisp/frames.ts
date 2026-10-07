// Declarative Warcraft frames: a typed definition of one frame tree generates
// a static FDF file, the TOC that loads it, and a map-side TypeScript module
// that creates the tree with Warcraft's own natives (BlzLoadTOCFile,
// BlzCreateFrame by name, BlzGetFrameByName for children). See wisp:docs/ui.md.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArchiveEntry } from "./mapBuild";

/** Frame types the generator writes; each is a native FDF frame type. */
export const FRAME_TYPES = ["FRAME", "BACKDROP", "TEXT", "GLUETEXTBUTTON"] as const;
export type FrameType = (typeof FRAME_TYPES)[number];

export const FRAME_POINTS = ["TOPLEFT", "TOP", "TOPRIGHT", "LEFT", "CENTER", "RIGHT", "BOTTOMLEFT", "BOTTOM", "BOTTOMRIGHT"] as const;
export type FramePoint = (typeof FRAME_POINTS)[number];

/** Warcraft templates a definition may inherit without defining them: loaded by the game before any map script. */
export const WARCRAFT_TEMPLATES = ["ScriptDialogButton", "EscMenuBackdrop"] as const;

export interface FrameAnchor {
  readonly point: FramePoint;
  /** Key of another frame in this definition, or "root"; the parent when absent. */
  readonly relative?: string;
  readonly relativePoint?: FramePoint;
  readonly x: number;
  readonly y: number;
}

export interface FrameNode {
  /** The binding's field name; the frame's FDF name is the definition name plus this key, capitalized. */
  readonly key: string;
  readonly type: FrameType;
  /** A template from this definition's frame names, `templates`, or WARCRAFT_TEMPLATES; inherited with its children. */
  readonly inherits?: string;
  readonly width?: number;
  readonly height?: number;
  readonly points?: readonly FrameAnchor[];
  /** TEXT: static text written into the FDF. GLUETEXTBUTTON: the label the generated create function sets. */
  readonly text?: string;
  /** TEXT only; required for text to render. */
  readonly font?: { readonly file: string; readonly size: number };
  readonly justify?: { readonly horizontal: "LEFT" | "CENTER" | "RIGHT"; readonly vertical: "TOP" | "MIDDLE" | "BOTTOM" };
  /** BACKDROP only: a texture stretched over the whole frame. */
  readonly texture?: string;
  /** False disables the frame after creation, so art and labels never take a click from the buttons under them. */
  readonly enabled?: false;
  readonly children?: readonly FrameNode[];
}

export interface FrameDefinition {
  /** The root frame's FDF name and the prefix of every child's name; also names the generated files. */
  readonly name: string;
  readonly type: FrameType;
  readonly width: number;
  readonly height: number;
  /** Where the generated create function places the root on the screen (BlzFrameSetAbsPoint). */
  readonly at?: { readonly point: FramePoint; readonly x: number; readonly y: number };
  readonly texture?: string;
  /** Frame level the create function applies to the root, above other menus. */
  readonly level?: number;
  /** Other loaded templates this definition may inherit, such as ones from another TOC the map loads first. */
  readonly templates?: readonly string[];
  readonly children: readonly FrameNode[];
}

export interface GeneratedFrames {
  /** Archive path of the FDF file, in war3mapImported\. */
  readonly fdfEntry: string;
  readonly tocEntry: string;
  readonly fdf: string;
  readonly toc: string;
  /** Map-side TypeScript: the typed handles and their create function. */
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

/** Every problem in a definition, in source order; empty when it generates. */
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

/** FDF numbers in fixed notation: Warcraft's parser reads no exponents. */
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
    // Module state would be shared by a headless run's clients; loading a TOC again is harmless.
    `  if (!BlzLoadTOCFile(${definition.name.toUpperCase()}_TOC)) return undefined;`,
    `  const root = BlzCreateFrame(${escaped(definition.name)}, parent, 0, context);`,
  ];
  if (definition.at !== undefined) lines.push(`  BlzFrameSetAbsPoint(root, FRAMEPOINT_${definition.at.point}, ${fdfNumber(definition.at.x)}, ${fdfNumber(definition.at.y)});`);
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

/** The FDF, TOC and bindings for one definition; throws FrameDefinitionError listing every problem. */
export function generateFrames(definition: FrameDefinition): GeneratedFrames {
  const problems = frameDefinitionProblems(definition);
  if (problems.length > 0) throw new FrameDefinitionError(problems);
  const fdfEntry = `war3mapImported\\${definition.name}.fdf`;
  const tocEntry = `war3mapImported\\${definition.name}.toc`;
  const root: FrameNode = { key: "root", type: definition.type, width: definition.width, height: definition.height, children: definition.children, ...(definition.texture === undefined ? {} : { texture: definition.texture }) };
  const rootLines = fdfFrame(definition, root, definition.name, definition.name, 0);
  // A TOC lists one FDF per line and needs a line break after the last.
  return { fdfEntry, tocEntry, fdf: `${rootLines.join("\n")}\n`, toc: `${fdfEntry}\r\n\r\n`, bindings: bindingsSource(definition, tocEntry) };
}

/**
 * Writes a definition's FDF and TOC into `importDir` and its bindings to
 * `bindingsFile`, and returns the archive entries a MapBuild's `imports` takes.
 */
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
