import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArchiveEntry } from "./mapBuild";

const FRAME_TYPES = ["FRAME", "BACKDROP", "TEXT", "GLUETEXTBUTTON"] as const;
type FrameType = (typeof FRAME_TYPES)[number];

const SIMPLE_LAYERS = ["BACKGROUND", "BORDER", "ARTWORK", "OVERLAY"] as const;
type SimpleLayer = (typeof SIMPLE_LAYERS)[number];
const ALPHA_MODES = ["BLEND", "ALPHAKEY"] as const;

const FRAME_POINTS = ["TOPLEFT", "TOP", "TOPRIGHT", "LEFT", "CENTER", "RIGHT", "BOTTOMLEFT", "BOTTOM", "BOTTOMRIGHT"] as const;
type FramePoint = (typeof FRAME_POINTS)[number];

const WARCRAFT_TEMPLATES = ["ScriptDialogButton", "EscMenuBackdrop"] as const;
export const WARCRAFT_TEMPLATE_FDFS = new Map<string, string>([
  ["ScriptDialogButton", "UI\\FrameDef\\UI\\ScriptDialog.fdf"],
  ["EscMenuBackdrop", "UI\\FrameDef\\UI\\EscMenuTemplates.fdf"],
]);

interface FrameAnchor {
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

/** A texture of a SIMPLEFRAME: with no width, height or anchor it fills the frame; texCoord is [left, right, top, bottom] of the file, each 0..1. */
export interface SimpleTexture {
  readonly key: string;
  readonly layer: SimpleLayer;
  readonly file?: string;
  readonly texCoord?: readonly [left: number, right: number, top: number, bottom: number];
  readonly alphaMode?: (typeof ALPHA_MODES)[number];
  readonly width?: number;
  readonly height?: number;
  readonly anchor?: { readonly point: FramePoint; readonly x: number; readonly y: number };
}

export interface FrameDefinition {

  readonly name: string;
  readonly type: FrameType | "SIMPLEFRAME";
  readonly width: number;
  readonly height: number;

  readonly at?: { readonly point: FramePoint; readonly x: number; readonly y: number };
  readonly texture?: string;

  readonly level?: number;

  readonly templates?: readonly string[];
  readonly children?: readonly FrameNode[];

  /** A SIMPLEFRAME's textures, bound by key like children; a SIMPLEFRAME has no children. */
  readonly textures?: readonly SimpleTexture[];
}

interface GeneratedFrames {

  readonly fdfEntry: string;
  readonly tocEntry: string;
  readonly fdf: string;
  readonly toc: string;

  readonly bindings: string;
}

class FrameDefinitionError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`frame definition problems:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_KEYS = new Set(["root", "toc"]);

const capitalize = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
const flatten = (nodes: readonly FrameNode[]): FrameNode[] => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
function textureProblems(texture: SimpleTexture): string[] {
  const owner = `"${texture.key}"`;
  const problems: string[] = [];
  if (!SIMPLE_LAYERS.includes(texture.layer)) problems.push(`${owner}: unknown layer "${texture.layer}"`);
  if (texture.alphaMode !== undefined && !ALPHA_MODES.includes(texture.alphaMode)) problems.push(`${owner}: unknown alpha mode "${texture.alphaMode}"`);
  if (texture.file !== undefined && /["\r\n]/.test(texture.file)) problems.push(`${owner}: file contains a quote or line break`);
  if (texture.texCoord !== undefined && (texture.texCoord.length !== 4 || texture.texCoord.some((value) => !(value >= 0 && value <= 1)))) problems.push(`${owner}: texCoord needs left, right, top and bottom within 0..1`);
  if (texture.anchor !== undefined && !FRAME_POINTS.includes(texture.anchor.point)) problems.push(`${owner}: unknown point "${texture.anchor.point}"`);
  return problems;
}

function simpleProblems(definition: FrameDefinition, children: number): string[] {
  const problems: string[] = [];
  if (children > 0) problems.push(`root: a SIMPLEFRAME has textures, not children`);
  if (definition.texture !== undefined) problems.push(`root: texture needs a BACKDROP`);
  if (definition.level !== undefined) problems.push(`root: a SIMPLEFRAME has no level`);
  const keys = new Set<string>(["root"]);
  const names = new Set<string>([definition.name]);
  for (const texture of definition.textures ?? []) {
    const owner = `"${texture.key}"`;
    if (!IDENTIFIER.test(texture.key)) problems.push(`${owner}: key is not an identifier`);
    else if (RESERVED_KEYS.has(texture.key)) problems.push(`${owner}: key is reserved`);
    else if (keys.has(texture.key)) problems.push(`${owner}: duplicate key`);
    else if (names.has(definition.name + capitalize(texture.key))) problems.push(`${owner}: frame name ${definition.name + capitalize(texture.key)} is already used`);
    names.add(definition.name + capitalize(texture.key));
    keys.add(texture.key);
    problems.push(...textureProblems(texture));
  }
  return problems;
}

export function frameDefinitionProblems(definition: FrameDefinition): string[] {
  const problems: string[] = [];
  if (!IDENTIFIER.test(definition.name)) problems.push(`definition name "${definition.name}" is not an identifier`);
  const simple = definition.type === "SIMPLEFRAME";
  if (!simple && !FRAME_TYPES.includes(definition.type as FrameType)) problems.push(`root: unknown frame type "${definition.type}"`);
  const nodes = flatten(definition.children ?? []);
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
  if (simple) problems.push(...simpleProblems(definition, nodes.length));
  else if (definition.textures !== undefined) problems.push(`root: textures need a SIMPLEFRAME`);
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

function fdfSimple(definition: FrameDefinition): string[] {
  const lines = [`Frame "SIMPLEFRAME" "${definition.name}" {`, `    Width ${fdfNumber(definition.width)},`, `    Height ${fdfNumber(definition.height)},`];
  for (const layer of SIMPLE_LAYERS) {
    const textures = (definition.textures ?? []).filter((texture) => texture.layer === layer);
    if (textures.length === 0) continue;
    lines.push(`    Layer "${layer}" {`);
    for (const texture of textures) {
      lines.push(`        Texture "${definition.name + capitalize(texture.key)}" {`);
      if (texture.file !== undefined) lines.push(`            File "${texture.file}",`);
      if (texture.texCoord !== undefined) lines.push(`            TexCoord ${texture.texCoord.map(fdfNumber).join(", ")},`);
      if (texture.alphaMode !== undefined) lines.push(`            AlphaMode "${texture.alphaMode}",`);
      if (texture.width !== undefined) lines.push(`            Width ${fdfNumber(texture.width)},`);
      if (texture.height !== undefined) lines.push(`            Height ${fdfNumber(texture.height)},`);
      if (texture.anchor !== undefined) lines.push(`            Anchor ${texture.anchor.point}, ${fdfNumber(texture.anchor.x)}, ${fdfNumber(texture.anchor.y)},`);
      if (texture.width === undefined && texture.height === undefined && texture.anchor === undefined) lines.push(`            SetAllPoints,`);
      lines.push("        }");
    }
    lines.push("    }");
  }
  lines.push("}");
  return lines;
}

const scriptNumber = (value: number) => {
  if (!Number.isFinite(value)) throw new FrameDefinitionError([`number ${value} is not finite`]);
  return String(Math.fround(value));
};

const POINT_NAMES: Readonly<Record<FramePoint, string>> = {
  TOPLEFT: "topLeft", TOP: "top", TOPRIGHT: "topRight", LEFT: "left", CENTER: "center", RIGHT: "right", BOTTOMLEFT: "bottomLeft", BOTTOM: "bottom", BOTTOMRIGHT: "bottomRight",
};

// The game-API form: map code reaches Warcraft only through wisp/game/frames, never the raw Blz natives.
function bindingsSource(definition: FrameDefinition, tocEntry: string): string {
  const simple = definition.type === "SIMPLEFRAME";
  const keys = (simple ? (definition.textures ?? []) : flatten(definition.children ?? [])).map((node) => node.key);
  const type = `${definition.name}Frames`;
  const toc = `${definition.name.toUpperCase()}_TOC`;
  const escaped = (value: string) => JSON.stringify(value);
  const used = new Set<string>(["Frame", "loadFrameFile", "namedFrame", simple ? "createSimpleFrame" : "createFrame"]);
  const body = [
    `  if (!loadFrameFile(${toc})) return undefined;`,
    simple ? `  const root = createSimpleFrame(${escaped(definition.name)}, parent, context);` : `  const root = createFrame(${escaped(definition.name)}, parent, 0, context);`,
  ];
  if (definition.at !== undefined) {
    used.add("setFrameAbsPoint").add("FramePoint");
    body.push(`  setFrameAbsPoint(root, FramePoint.${POINT_NAMES[definition.at.point]}, ${scriptNumber(definition.at.x)}, ${scriptNumber(definition.at.y)});`);
  }
  if (definition.level !== undefined) {
    used.add("setFrameLevel");
    body.push(`  setFrameLevel(root, ${definition.level});`);
  }
  body.push(`  const frames: ${type} = {`, "    root,", ...keys.map((key) => `    ${key}: namedFrame(${escaped(definition.name + capitalize(key))}, context),`), "  };");
  for (const node of simple ? [] : flatten(definition.children ?? [])) {
    if (node.type === "GLUETEXTBUTTON" && node.text !== undefined) {
      used.add("setFrameText");
      body.push(`  setFrameText(frames.${node.key}, ${escaped(node.text)});`);
    }
    if (node.enabled === false) {
      used.add("setFrameEnabled");
      body.push(`  setFrameEnabled(frames.${node.key}, false);`);
    }
  }
  const imports = [...used].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return [
    `import { ${imports.join(", ")} } from "wisp/game/frames";`,
    `// Generated by wisp:host/compile/frames.ts from the ${definition.name} definition. Do not edit.`,
    `export const ${toc} = ${escaped(tocEntry)};`,
    "",
    `export interface ${type} {`,
    "  readonly root: Frame;",
    ...keys.map((key) => `  readonly ${key}: Frame;`),
    "}",
    "",
    `/** Loads the TOC, then creates the ${definition.name} tree; context tells copies apart. */`,
    `export function create${definition.name}(parent: Frame, context: number): ${type} | undefined {`,
    ...body,
    "  return frames;",
    "}",
    "",
  ].join("\n");
}

export function generateFrames(definition: FrameDefinition): GeneratedFrames {
  const problems = frameDefinitionProblems(definition);
  if (problems.length > 0) throw new FrameDefinitionError(problems);
  const fdfEntry = `war3mapImported\\${definition.name}.fdf`;
  const tocEntry = `war3mapImported\\${definition.name}.toc`;
  const rootLines = definition.type === "SIMPLEFRAME" ? fdfSimple(definition) : fdfFrame(definition, { key: "root", type: definition.type, width: definition.width, height: definition.height, ...(definition.children === undefined ? {} : { children: definition.children }), ...(definition.texture === undefined ? {} : { texture: definition.texture }) }, definition.name, definition.name, 0);
  const sources = [...new Set(flatten(definition.children ?? []).flatMap((node) => {
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
