import type { Handle } from "./types";
import { f32 } from "../../sim/f32";

export interface Frame extends Handle {

  readonly type: string;
  readonly name: string;
  readonly context: number;
  readonly parent: Frame | undefined;
  text: string;
  texture: string;
  color: number;
  textColor: number;
  alpha: number;
  visible: boolean;
  enabled: boolean;
  level: number;
  textLimit: number;

  font: { readonly file: string; readonly height: number; readonly flags: number };

  alignment: { readonly vertical: unknown; readonly horizontal: unknown } | undefined;

  /** Made by `BlzCreateFrameByType` with no template: Classic gives its text a fixed base size, so only its scale sizes it. */
  plain: boolean;
  scale: number;
  width: number;
  height: number;
  /** The model a SPRITE frame shows (`BlzFrameSetModel`), its camera index and the sequence `BlzFrameSetSpriteAnimate` picks. */
  model: string;
  modelCamera: number;
  spriteAnimation: number;
  /** Seconds into the model's timeline a game that scrubs sets with `WispFrameSetSpriteTime`; negative while the sprite loops its sequence. */
  spriteTime: number;

  readonly points: Map<unknown, { readonly x: number; readonly y: number }>;

  readonly anchors: Anchor[];
  destroyed: boolean;
}

export const FRAME_POINTS: readonly (readonly [name: string, fromLeft: number, fromTop: number])[] = [
  ["FRAMEPOINT_TOPLEFT", 0, 0],
  ["FRAMEPOINT_TOP", 0.5, 0],
  ["FRAMEPOINT_TOPRIGHT", 1, 0],
  ["FRAMEPOINT_LEFT", 0, 0.5],
  ["FRAMEPOINT_CENTER", 0.5, 0.5],
  ["FRAMEPOINT_RIGHT", 1, 0.5],
  ["FRAMEPOINT_BOTTOMLEFT", 0, 1],
  ["FRAMEPOINT_BOTTOM", 0.5, 1],
  ["FRAMEPOINT_BOTTOMRIGHT", 1, 1],
];

interface FrameTemplateNode {
  readonly key: string;
  readonly type: string;
  readonly width?: number;
  readonly height?: number;
  readonly text?: string;
  readonly texture?: string;

  readonly font?: TemplateFont;

  readonly justify?: TemplateJustify;
  readonly points?: readonly { readonly point: string; readonly relative?: string; readonly relativePoint?: string; readonly x: number; readonly y: number }[];
  readonly children?: readonly FrameTemplateNode[];
}

export interface FrameTemplate {
  readonly name: string;
  readonly type?: string;
  readonly texture?: string;

  readonly text?: string;
  readonly font?: TemplateFont;
  readonly justify?: TemplateJustify;
  readonly width: number;
  readonly height: number;
  readonly children: readonly FrameTemplateNode[];
}

interface TemplateFont { readonly file: string; readonly size: number; readonly flags?: number }
interface TemplateJustify { readonly horizontal: "LEFT" | "CENTER" | "RIGHT"; readonly vertical: "TOP" | "MIDDLE" | "BOTTOM" }
interface FrameFont { readonly file: string; readonly height: number; readonly flags: number }
interface TextAlignment { readonly vertical: "top" | "middle" | "bottom"; readonly horizontal: "left" | "center" | "right" }

function textJustify(value: unknown): string {
  if (typeof value === "number") return ["top", "middle", "bottom", "left", "center", "right"][value] ?? "";
  return typeof value === "string" ? (value.startsWith("TEXT_JUSTIFY_") ? value.slice("TEXT_JUSTIFY_".length) : value).toLowerCase() : "";
}

function textAlignment(alignment: NonNullable<Frame["alignment"]>): TextAlignment {
  const vertical = textJustify(alignment.vertical), horizontal = textJustify(alignment.horizontal);
  return { vertical: vertical === "middle" || vertical === "bottom" ? vertical : "top", horizontal: horizontal === "center" || horizontal === "right" ? horizontal : "left" };
}

const BUTTON_ALIGNMENT: NonNullable<Frame["alignment"]> = { vertical: "MIDDLE", horizontal: "CENTER" };
const buttonTypes = new Map<string, boolean>();
const alignments = new WeakMap<NonNullable<Frame["alignment"]>, TextAlignment>();

function isButton(type: string): boolean {
  let button = buttonTypes.get(type);
  if (button === undefined) buttonTypes.set(type, button = type.toLowerCase().includes("button"));
  return button;
}

function frameAlignment(frame: Frame): TextAlignment | undefined {
  const declared = frame.alignment ?? (isButton(frame.type) ? BUTTON_ALIGNMENT : undefined);
  if (declared === undefined) return undefined;
  let aligned = alignments.get(declared);
  if (aligned === undefined) alignments.set(declared, aligned = textAlignment(declared));
  return aligned;
}

function styleText(frame: Frame, declared: { readonly font?: TemplateFont; readonly justify?: TemplateJustify }): void {
  if (declared.font === undefined) return;
  frame.font = { file: declared.font.file, height: declared.font.size, flags: declared.font.flags ?? 0 };
  const justify = declared.justify ?? { horizontal: "CENTER", vertical: "MIDDLE" };
  frame.alignment = { vertical: justify.vertical, horizontal: justify.horizontal };
}

interface Anchor {
  readonly point: string;
  readonly relative: Frame;
  readonly relativePoint: string;
  readonly x: number;
  readonly y: number;
}

const NAMED_POINTS = new Map(FRAME_POINTS.map(([name, fromLeft, fromTop]) => [name.slice("FRAMEPOINT_".length), [fromLeft, fromTop] as const]));

// Rounding slack for the 4:3 edges: a hundredth of a pixel at 1080 lines.
const EDGE = f32(1e-5);

// New edit boxes have the engine text limit; negative limits truncate nothing (wisp:docs/warsmash-notes.md).
const DEFAULT_TEXT_LIMIT = -256;

export type Rectangle = readonly [number, number, number, number];

export interface FrameSnapshot {
  readonly handle: Handle;
  readonly name: string;
  readonly type: string;
  readonly parentId: number | undefined;
  readonly rectangle: Rectangle | undefined;
  readonly text: string;
  readonly texture: string;
  readonly color: number;
  readonly textColor: number;
  readonly alpha: number;

  readonly visible: boolean;
  readonly level: number;
  readonly font: FrameFont;
  readonly alignment: TextAlignment | undefined;
  readonly scale: number;
  readonly plain: boolean;
  /** Set only on a frame that shows a model: the path, the model's camera index and the sequence index to play. */
  readonly sprite?: { readonly model: string; readonly camera: number; readonly animation: number; readonly time: number };
}

type PlacedPoint = readonly [readonly [number, number], { readonly x: number; readonly y: number }];

function fitCorners(placed: readonly PlacedPoint[], width: number, height: number): [number, number, number, number] | undefined {
  const corners: [number, number, number, number] = [0, 0, 0, 0];
  let found = 0;
  for (const [share, at] of placed) {
    const left = at.x - share[0] * width;
    const top = at.y + share[1] * height;
    if (found === 0) {
      corners[0] = left;
      corners[1] = top;
      corners[2] = left + width;
      corners[3] = top - height;
    } else {

      if (share[0] === 0) corners[0] = at.x;
      if (share[0] === 1) corners[2] = at.x;
      if (share[1] === 0) corners[1] = at.y;
      if (share[1] === 1) corners[3] = at.y;
    }
    found++;
  }
  return found === 0 ? undefined : corners;
}

class Placements {
  readonly known = new Map<Frame, Rectangle | undefined>();
  readonly ancestors = new Set<Frame>();
  cycles = 0;
}

export class Frames {
  private readonly all: Frame[] = [];
  private focused: Frame | undefined;
  private readonly templates = new Map<string, FrameTemplate>();
  /** `BlzGetOriginFrame(ORIGIN_FRAME_GAME_UI, i)`: its children are drawn only inside the 4:3 area. */
  readonly gameUi = new Set<Frame>();

  constructor(private readonly points: ReadonlyMap<unknown, readonly [number, number]>) {}

  add(handle: Handle, type: string, name: string, parent: Frame | undefined, context: number): Frame {
    const frame: Frame = {
      ...handle, type, name, context, parent, text: "", visible: true, enabled: true, level: 0, textLimit: DEFAULT_TEXT_LIMIT,
      width: 0, height: 0, points: new Map(), anchors: [], destroyed: false,
      texture: "", color: 0xffffffff, textColor: 0xffffffff, alpha: 255,
      font: { file: "", height: 0, flags: 0 }, alignment: undefined, scale: 1, plain: true,
      model: "", modelCamera: 0, spriteAnimation: 0, spriteTime: -1,
    };
    this.all.push(frame);
    return frame;
  }

  define(definitions: readonly FrameTemplate[]): void {
    for (const definition of definitions) this.templates.set(definition.name, definition);
  }

  create(handle: (this: void) => Handle, name: string, parent: Frame | undefined, context: number): Frame {
    const definition = this.templates.get(name);
    const root = this.add(handle(), definition?.type ?? name, name, parent, context);
    root.plain = false;
    if (definition === undefined) return root;
    root.width = definition.width;
    root.height = definition.height;
    root.texture = definition.texture ?? "";
    if (definition.text !== undefined) root.text = definition.text;
    styleText(root, definition);
    const byKey = new Map<string, Frame>([["root", root]]);
    const placed: (readonly [FrameTemplateNode, Frame])[] = [];
    const make = (nodes: readonly FrameTemplateNode[], owner: Frame) => {
      for (const node of nodes) {
        const frame = this.add(handle(), node.type, definition.name + node.key.charAt(0).toUpperCase() + node.key.slice(1), owner, context);
        frame.plain = false;
        frame.width = node.width ?? 0;
        frame.height = node.height ?? 0;
        if (node.type === "TEXT" && node.text !== undefined) frame.text = node.text;
        if (node.type === "TEXT") styleText(frame, node);
        frame.texture = node.texture ?? "";
        byKey.set(node.key, frame);
        placed.push([node, frame]);
        make(node.children ?? [], frame);
      }
    };
    make(definition.children, root);
    for (const [node, frame] of placed) {
      for (const anchor of node.points ?? []) {
        const relative = anchor.relative === undefined ? frame.parent : byKey.get(anchor.relative);
        if (relative === undefined) continue;
        frame.anchors.push({ point: anchor.point, relative, relativePoint: anchor.relativePoint ?? anchor.point, x: anchor.x, y: anchor.y });
      }
    }
    return root;
  }

  named(name: string, context: number): Frame | undefined {
    for (const frame of this.all) if (!frame.destroyed && frame.name === name && frame.context === context) return frame;
    return undefined;
  }

  byId(id: number): Frame | undefined {
    for (const frame of this.all) if (frame.id === id && !frame.destroyed) return frame;
    return undefined;
  }

  children(parent: Frame): Frame[] {
    const found: Frame[] = [];
    for (const frame of this.all) if (frame.parent === parent && !frame.destroyed) found.push(frame);
    return found;
  }

  destroy(frame: Frame): void {
    frame.destroyed = true;
    if (this.focused === frame) this.focused = undefined;
    for (const child of this.all) if (child.parent === frame && !child.destroyed) this.destroy(child);
  }

  focus(frame: Frame, flag: boolean): void {
    if (flag) this.focused = frame;
    else if (this.focused === frame) this.focused = undefined;
  }

  shown(frame: Frame): boolean {
    for (let at: Frame | undefined = frame; at !== undefined; at = at.parent) if (at.destroyed || !at.visible) return false;
    return true;
  }

  shownText(): string[] {
    const texts: string[] = [];
    for (const frame of this.all) if (frame.text !== "" && this.shown(frame)) texts.push(frame.text);
    return texts;
  }

  snapshot(options: { readonly visibleOnly?: boolean } = {}): FrameSnapshot[] {
    const snapshots: FrameSnapshot[] = [];
    const placements = new Placements();
    for (const frame of this.all) {
      if (frame.destroyed) continue;
      const visible = this.shown(frame);
      if (options.visibleOnly && (!visible || frame.alpha <= 0)) continue;
      snapshots.push({ handle: { kind: frame.kind, id: frame.id }, name: frame.name, type: frame.type,
        parentId: frame.parent?.id, rectangle: this.rectangle(frame, placements), text: frame.text, texture: frame.texture,
        color: frame.color, textColor: frame.textColor, alpha: frame.alpha, visible, level: this.drawLevel(frame),
        font: frame.font, alignment: frameAlignment(frame), scale: frame.scale, plain: frame.plain,
        ...(frame.model === "" ? {} : { sprite: { model: frame.model, camera: frame.modelCamera, animation: frame.spriteAnimation, time: frame.spriteTime } }) });
    }
    return snapshots;
  }

  // A frame whose level was never set draws at its parent's level, as Warcraft does, so a raised panel carries its children above lower siblings.
  private drawLevel(frame: Frame): number {
    for (let at: Frame | undefined = frame; at !== undefined; at = at.parent) if (at.level !== 0) return at.level;
    return 0;
  }

  private rectangle(frame: Frame, placements: Placements = new Placements()): Rectangle | undefined {
    if (placements.known.has(frame)) return placements.known.get(frame);
    if (placements.ancestors.has(frame)) {
      placements.cycles++;
      return undefined;
    }
    const cycles = placements.cycles;
    placements.ancestors.add(frame);
    const rectangle = this.place(frame, placements);
    placements.ancestors.delete(frame);
    if (placements.cycles === cycles) placements.known.set(frame, rectangle);
    return rectangle;
  }

  private place(frame: Frame, placements: Placements): Rectangle | undefined {
    // Scale multiplies size and relative offsets, not absolute points, and children inherit it (wisp#125, test/frames125).
    let scale = 1;
    for (let at: Frame | undefined = frame; at !== undefined; at = at.parent) scale *= at.scale;
    const corners = fitCorners(this.placedPoints(frame, scale, placements), frame.width * scale, frame.height * scale);
    if (corners === undefined) return undefined;
    // A GAME_UI child leaving x 0..0.8 is not drawn, even on a wide screen (wisp#125, test/frames125).
    if (frame.parent !== undefined && this.gameUi.has(frame.parent) && (corners[0] < -EDGE || corners[2] > f32(0.8) + EDGE)) return undefined;
    return corners;
  }

  private placedPoints(frame: Frame, scale: number, placements: Placements): PlacedPoint[] {
    const placed: PlacedPoint[] = [];
    for (const [point, at] of frame.points) {
      const share = this.points.get(point);
      if (share !== undefined) placed.push([share, at]);
    }
    for (const anchor of frame.anchors) {
      const share = NAMED_POINTS.get(anchor.point);
      const relativeShare = NAMED_POINTS.get(anchor.relativePoint);
      const relative = this.rectangle(anchor.relative, placements);
      if (share === undefined || relativeShare === undefined || relative === undefined) continue;
      const [left, top, right, bottom] = relative;
      placed.push([share, { x: left + relativeShare[0] * (right - left) + anchor.x * scale, y: top - relativeShare[1] * (top - bottom) + anchor.y * scale }]);
    }
    return placed;
  }

  at(x: number, y: number, takes: (frame: Frame) => boolean): Frame | undefined {
    let found: Frame | undefined;
    const placements = new Placements();
    for (const frame of this.all) {
      if (!frame.enabled || !takes(frame) || !this.shown(frame)) continue;
      const rectangle = this.rectangle(frame, placements);
      if (rectangle === undefined) continue;
      const [left, top, right, bottom] = rectangle;
      if (x < left || x > right || y > top || y < bottom) continue;
      if (found === undefined || this.drawLevel(frame) >= this.drawLevel(found)) found = frame;
    }
    return found;
  }

  type(text: string): boolean {
    const box = this.focused;
    if (box === undefined || box.type !== "EDITBOX" || !box.enabled || !this.shown(box)) return false;
    box.text = box.textLimit >= 0 ? (box.text + text).slice(0, Math.max(box.textLimit, box.text.length)) : box.text + text;
    return true;
  }
}
