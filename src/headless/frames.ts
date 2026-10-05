// The frames of one simulated client (wisp:docs/headless.md): what each shows,
// where it is, and which one takes a click or the keyboard. Positions are
// Warcraft's UI coordinates, set with BlzFrameSetAbsPoint and BlzFrameSetSize.
// Runtime-neutral, like client.ts.
import type { Handle } from "./client";

export interface Frame extends Handle {
  /** BlzCreateFrameByType's type, such as "EDITBOX"; a template's name for BlzCreateFrame; "" for frames the game made. */
  readonly type: string;
  readonly name: string;
  readonly context: number;
  readonly parent: Frame | undefined;
  text: string;
  visible: boolean;
  enabled: boolean;
  level: number;
  textLimit: number;
  width: number;
  height: number;
  /** Absolute points, by framepointtype value. */
  readonly points: Map<unknown, { readonly x: number; readonly y: number }>;
  destroyed: boolean;
}

/**
 * The framepointtype constants in ConvertFramePointType order, each with its
 * place on the frame: its share of the width from the left and of the height
 * from the top.
 */
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

/** A text box's character limit until the map sets one. */
const DEFAULT_TEXT_LIMIT = 4096;

/** A frame's rectangle: left, top, right, bottom. */
type Rectangle = readonly [number, number, number, number];

export class Frames {
  private readonly all: Frame[] = [];
  private focused: Frame | undefined;

  /**
   * `points`: each framepointtype constant's value as the map's code sees it,
   * with its place on the frame.
   */
  constructor(private readonly points: ReadonlyMap<unknown, readonly [number, number]>) {}

  add(handle: Handle, type: string, name: string, parent: Frame | undefined, context: number): Frame {
    const frame: Frame = {
      ...handle, type, name, context, parent, text: "", visible: true, enabled: true, level: 0, textLimit: DEFAULT_TEXT_LIMIT,
      width: 0, height: 0, points: new Map(), destroyed: false,
    };
    this.all.push(frame);
    return frame;
  }

  /** A frame the map made by name, if one is alive. */
  named(name: string, context: number): Frame | undefined {
    for (const frame of this.all) if (!frame.destroyed && frame.name === name && frame.context === context) return frame;
    return undefined;
  }

  byId(id: number): Frame | undefined {
    for (const frame of this.all) if (frame.id === id && !frame.destroyed) return frame;
    return undefined;
  }

  /** BlzDestroyFrame: the frame and its descendants. */
  destroy(frame: Frame): void {
    frame.destroyed = true;
    if (this.focused === frame) this.focused = undefined;
    for (const child of this.all) if (child.parent === frame && !child.destroyed) this.destroy(child);
  }

  focus(frame: Frame, flag: boolean): void {
    if (flag) this.focused = frame;
    else if (this.focused === frame) this.focused = undefined;
  }

  /** Whether a player sees the frame: it and every parent are visible. */
  shown(frame: Frame): boolean {
    for (let at: Frame | undefined = frame; at !== undefined; at = at.parent) if (at.destroyed || !at.visible) return false;
    return true;
  }

  /** The text of every frame a player sees, in creation order. */
  shownText(): string[] {
    const texts: string[] = [];
    for (const frame of this.all) if (frame.text !== "" && this.shown(frame)) texts.push(frame.text);
    return texts;
  }

  /** Where the frame is, from an absolute point and its size, or two opposite corners; undefined without one. */
  private rectangle(frame: Frame): Rectangle | undefined {
    const corners: [number, number, number, number] = [0, 0, 0, 0];
    let found = 0;
    for (const [point, at] of frame.points) {
      const share = this.points.get(point);
      if (share === undefined) continue;
      const left = at.x - share[0] * frame.width;
      const top = at.y + share[1] * frame.height;
      if (found === 0) {
        corners[0] = left;
        corners[1] = top;
        corners[2] = left + frame.width;
        corners[3] = top - frame.height;
      } else {
        // A second point stretches the frame to it.
        if (share[0] === 0) corners[0] = at.x;
        if (share[0] === 1) corners[2] = at.x;
        if (share[1] === 0) corners[1] = at.y;
        if (share[1] === 1) corners[3] = at.y;
      }
      found++;
    }
    return found === 0 ? undefined : corners;
  }

  /**
   * The frame a click at (x, y) reaches: among shown, enabled frames that
   * `takes`, the highest level whose rectangle holds the point, the latest
   * created on a tie.
   */
  at(x: number, y: number, takes: (frame: Frame) => boolean): Frame | undefined {
    let found: Frame | undefined;
    for (const frame of this.all) {
      if (!frame.enabled || !takes(frame) || !this.shown(frame)) continue;
      const rectangle = this.rectangle(frame);
      if (rectangle === undefined) continue;
      const [left, top, right, bottom] = rectangle;
      if (x < left || x > right || y > top || y < bottom) continue;
      if (found === undefined || frame.level >= found.level) found = frame;
    }
    return found;
  }

  /**
   * Text the keyboard types reaches the focused edit box while a player sees
   * it, up to its character limit, as Warcraft drops the rest. False when no
   * edit box has the keyboard.
   */
  type(text: string): boolean {
    const box = this.focused;
    if (box === undefined || box.type !== "EDITBOX" || !box.enabled || !this.shown(box)) return false;
    box.text = (box.text + text).slice(0, Math.max(box.textLimit, box.text.length));
    return true;
  }
}
