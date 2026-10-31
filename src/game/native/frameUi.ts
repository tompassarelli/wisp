import { FRAME_POINTS, type Frame, type Frames } from "./frameStore";
import type { Handle, HandleFactory } from "./types";

export const isFrame = (value: unknown): value is Frame => typeof value === "object" && value !== null && "points" in value;

// Engine: a JASS integer is signed, so BlzConvertColor gives white as -1; the native window reads a frame colour as an unsigned ARGB word.
const argb = (color: number) => (color < 0 ? color + 4294967296 : color);

const pointName = (value: unknown): string => typeof value === "number" ? FRAME_POINTS[value]?.[0] ?? "" : typeof value === "string" ? value : "";

/** The frame calls of one running game on top of its frame tree: what the native backend and the emulated Warcraft natives both run. */
export class FrameUi {
  private readonly memo = new Map<string, Frame>();

  constructor(
    private readonly tree: (this: void) => Frames,
    private readonly handle: HandleFactory,
    private readonly gameUiOrigin: (this: void) => unknown,
    readonly screen: { readonly width: number; readonly height: number },
  ) {}

  private memoized(key: string, name = ""): Frame {
    const known = this.memo.get(key);
    if (known !== undefined) return known;
    const created = this.tree().add(this.handle("framehandle"), "", name, undefined, 0);
    this.memo.set(key, created);
    return created;
  }

  private made(type: string, name: string, owner: unknown, context: number): Frame {
    return this.tree().add(this.handle("framehandle"), type, name, isFrame(owner) ? owner : undefined, context);
  }

  originFrame(type: unknown, index: number): Frame {
    const frame = this.memoized(`origin ${String(type)} ${index}`);
    if (type === this.gameUiOrigin()) this.tree().gameUi.add(frame);
    return frame;
  }

  named(name: string, context: number): Frame {
    return this.tree().named(name, context) ?? this.memoized(`name ${name} ${context}`, name);
  }

  childCount(frame: unknown): number {
    return isFrame(frame) ? this.tree().children(frame).length : 0;
  }

  child(frame: Handle, index: number): Frame {
    return (isFrame(frame) ? this.tree().children(frame)[index] : undefined) ?? this.memoized(`child ${frame.id} ${index}`);
  }

  create(template: string, owner: unknown, context: number): Frame {
    return this.tree().create(() => this.handle("framehandle"), template, isFrame(owner) ? owner : undefined, context);
  }

  createSimple(template: string, owner: unknown, context: number): Frame {
    return this.made(template, template, owner, context);
  }

  createByType(type: string, name: string, owner: unknown, inherits: string, context: number): Frame {
    const frame = this.made(type, name, owner, context);
    frame.plain = inherits === "";
    return frame;
  }

  destroy(frame: unknown): void {
    if (isFrame(frame)) this.tree().destroy(frame);
  }

  name(frame: unknown): string {
    return isFrame(frame) ? frame.name : "";
  }

  parent(frame: unknown): Frame | undefined {
    return isFrame(frame) ? frame.parent : undefined;
  }

  setText(frame: unknown, text: string): void {
    if (isFrame(frame)) frame.text = frame.textLimit >= 0 ? text.slice(0, frame.textLimit) : text;
  }

  text(frame: unknown): string {
    return isFrame(frame) ? frame.text : "";
  }

  setTexture(frame: unknown, texture: string): void {
    if (isFrame(frame)) frame.texture = texture;
  }

  setModel(frame: unknown, model: string, camera: number): void {
    if (isFrame(frame)) {
      frame.model = model;
      frame.modelCamera = camera;
    }
  }

  setSpriteAnimation(frame: unknown, animation: number): void {
    if (isFrame(frame)) frame.spriteAnimation = animation;
  }

  setSpriteTime(frame: unknown, seconds: number): void {
    if (isFrame(frame)) frame.spriteTime = seconds;
  }

  setVertexColor(frame: unknown, color: number): void {
    if (isFrame(frame)) frame.color = argb(color);
  }

  setTextColor(frame: unknown, color: number): void {
    if (isFrame(frame)) frame.textColor = argb(color);
  }

  setAlpha(frame: unknown, alpha: number): void {
    if (isFrame(frame)) frame.alpha = alpha;
  }

  alpha(frame: unknown): number {
    return isFrame(frame) ? frame.alpha : 0;
  }

  setTextLimit(frame: unknown, size: number): void {
    if (isFrame(frame)) frame.textLimit = size;
  }

  textLimit(frame: unknown): number {
    return isFrame(frame) ? frame.textLimit : 0;
  }

  setFont(frame: unknown, file: string, height: number, flags: number): void {
    if (isFrame(frame)) frame.font = { file, height, flags };
  }

  setTextAlignment(frame: unknown, vertical: unknown, horizontal: unknown): void {
    if (isFrame(frame)) frame.alignment = { vertical, horizontal };
  }

  setScale(frame: unknown, scale: number): void {
    if (isFrame(frame)) frame.scale = scale;
  }

  setVisible(frame: unknown, visible: boolean): void {
    if (isFrame(frame)) frame.visible = visible;
  }

  visible(frame: unknown): boolean {
    return isFrame(frame) ? this.tree().shown(frame) : false;
  }

  setEnabled(frame: unknown, enabled: boolean): void {
    if (isFrame(frame)) frame.enabled = enabled;
  }

  enabled(frame: unknown): boolean {
    return isFrame(frame) ? frame.enabled : false;
  }

  setFocus(frame: unknown, focused: boolean): void {
    if (isFrame(frame)) this.tree().focus(frame, focused);
  }

  setLevel(frame: unknown, level: number): void {
    if (isFrame(frame)) frame.level = level;
  }

  setSize(frame: unknown, width: number, height: number): void {
    if (isFrame(frame)) {
      frame.width = width;
      frame.height = height;
    }
  }

  setAbsPoint(frame: unknown, point: unknown, x: number, y: number): void {
    if (isFrame(frame)) frame.points.set(point, { x, y });
  }

  clearPoints(frame: unknown): void {
    if (isFrame(frame)) {
      frame.points.clear();
      frame.anchors.length = 0;
    }
  }

  setPoint(frame: unknown, point: unknown, relative: unknown, relativePoint: unknown, x: number, y: number): void {
    if (!isFrame(frame) || !isFrame(relative)) return;
    const ownPoint = pointName(point).replace("FRAMEPOINT_", "");
    for (let index = frame.anchors.length - 1; index >= 0; index--) if (frame.anchors[index]?.point === ownPoint) frame.anchors.splice(index, 1);
    frame.anchors.push({ point: ownPoint, relative, relativePoint: pointName(relativePoint).replace("FRAMEPOINT_", ""), x, y });
  }

  setAllPoints(frame: unknown, relative: unknown): boolean {
    if (!isFrame(frame) || !isFrame(relative)) return false;
    frame.points.clear();
    frame.anchors.length = 0;
    for (const point of ["TOPLEFT", "BOTTOMRIGHT"]) frame.anchors.push({ point, relative, relativePoint: point, x: 0, y: 0 });
    return true;
  }
}
