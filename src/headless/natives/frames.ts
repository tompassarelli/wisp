import { f32 } from "../../sim/f32";
import type { Handle, HandleFactory, NativeBehavior } from "../clientTypes";
import { FRAME_POINTS, type Frame, type Frames } from "../frames";
import { describeValue } from "../jassFormat";

export const isFrame = (value: unknown): value is Frame => typeof value === "object" && value !== null && "points" in value;

export interface FrameContext {
  readonly handle: HandleFactory;
  readonly frames: (this: void) => Frames;
  readonly gameUiOrigin: (this: void) => unknown;
  readonly screen: { readonly width: number; readonly height: number };
  readonly textAreaAutoScroll: Map<Handle, boolean>;
  readonly keyPressed: (this: void, key: number) => boolean;
  readonly metaPressed: (this: void, meta: number) => boolean;
  readonly mouseButtonPressed: (this: void, button: unknown) => boolean;
  readonly mouseX: (this: void) => number;
  readonly mouseY: (this: void) => number;
}

export function inputNatives({ screen, textAreaAutoScroll, keyPressed, metaPressed, mouseButtonPressed, mouseX, mouseY }: FrameContext): Readonly<Record<string, NativeBehavior>> {
  return {
    BlzGetLocalClientWidth: () => screen.width,
    BlzGetLocalClientHeight: () => screen.height,
    BlzIsLocalClientActive: () => true,
    BlzIsKeyPressed: (key: number) => keyPressed(key),
    BlzIsMetaKeyPressed: (meta: number) => metaPressed(meta),
    BlzIsMouseButtonPressed: (button: unknown) => mouseButtonPressed(button),
    BlzGetMouseScreenPosX: () => mouseX(),
    BlzGetMouseScreenPosY: () => mouseY(),
    BlzPixelToFrameX: (pixel: number) => f32(pixel * f32(0.8) / screen.width),
    BlzPixelToFrameY: (pixel: number) => f32(pixel * f32(0.6) / screen.height),
    BlzFrameToPixelX: (frame: number) => Math.round(frame * screen.width / f32(0.8)),
    BlzFrameToPixelY: (frame: number) => Math.round(frame * screen.height / f32(0.6)),
    BlzTextAreaFrameSetAutoScroll: (frame: Handle, value: boolean) => { textAreaAutoScroll.set(frame, value); },
    BlzLoadTOCFile: () => true,
  };
}

export function frameNatives({ handle, frames, gameUiOrigin }: FrameContext): Readonly<Record<string, NativeBehavior>> {
  const memo = new Map<string, Frame>();
  const memoized = (key: string, name = ""): Frame => {
    const known = memo.get(key);
    if (known !== undefined) return known;
    const created = frames().add(handle("framehandle"), "", name, undefined, 0);
    memo.set(key, created);
    return created;
  };
  const created = (type: string, name: string, owner: unknown, context: number): Frame =>
    frames().add(handle("framehandle"), type, name, isFrame(owner) ? owner : undefined, context);
  return {
    BlzGetOriginFrame: (type: unknown, index: number) => {
      const frame = memoized(`origin ${describeValue(type)} ${index}`);
      if (type === gameUiOrigin()) frames().gameUi.add(frame);
      return frame;
    },
    BlzGetFrameByName: (name: string, context: number) => frames().named(name, context) ?? memoized(`name ${name} ${context}`, name),
    BlzFrameGetChildrenCount: (frame: unknown) => (isFrame(frame) ? frames().children(frame).length : 0),
    BlzFrameGetChild: (frame: Handle, index: number) => (isFrame(frame) ? frames().children(frame)[index] : undefined) ?? memoized(`child ${frame.id} ${index}`),
    BlzCreateFrame: (name: string, owner: unknown, _priority: number, context: number) => frames().create(() => handle("framehandle"), name, isFrame(owner) ? owner : undefined, context),
    BlzCreateSimpleFrame: (name: string, owner: unknown, context: number) => created(name, name, owner, context),
    BlzCreateFrameByType: (type: string, name: string, owner: unknown, _inherits: string, context: number) => created(type, name, owner, context),
    BlzDestroyFrame: (frame: unknown) => {
      if (isFrame(frame)) frames().destroy(frame);
    },
    BlzFrameGetName: (frame: unknown) => (isFrame(frame) ? frame.name : ""),
    BlzFrameGetParent: (frame: unknown) => (isFrame(frame) ? frame.parent : undefined),
    BlzFrameSetText: (frame: unknown, text: string) => {
      if (isFrame(frame)) frame.text = frame.textLimit >= 0 ? text.slice(0, frame.textLimit) : text;
    },
    BlzFrameGetText: (frame: unknown) => (isFrame(frame) ? frame.text : ""),
    BlzFrameSetTexture: (frame: unknown, texture: string) => {
      if (isFrame(frame)) frame.texture = texture;
    },
    BlzFrameSetVertexColor: (frame: unknown, color: number) => {
      if (isFrame(frame)) frame.color = color;
    },
    BlzFrameSetTextColor: (frame: unknown, color: number) => {
      if (isFrame(frame)) frame.textColor = color;
    },
    BlzFrameSetAlpha: (frame: unknown, alpha: number) => {
      if (isFrame(frame)) frame.alpha = alpha;
    },
    BlzFrameGetAlpha: (frame: unknown) => (isFrame(frame) ? frame.alpha : 0),
    BlzFrameSetTextSizeLimit: (frame: unknown, size: number) => {
      if (isFrame(frame)) frame.textLimit = size;
    },
    BlzFrameGetTextSizeLimit: (frame: unknown) => (isFrame(frame) ? frame.textLimit : 0),
    BlzFrameSetFont: (frame: unknown, file: string, height: number, flags: number) => {
      if (isFrame(frame)) frame.font = { file, height, flags };
    },
    BlzFrameSetTextAlignment: (frame: unknown, vertical: unknown, horizontal: unknown) => {
      if (isFrame(frame)) frame.alignment = { vertical, horizontal };
    },
    BlzFrameSetScale: (frame: unknown, scale: number) => {
      if (isFrame(frame)) frame.scale = scale;
    },
    BlzFrameSetVisible: (frame: unknown, visible: boolean) => {
      if (isFrame(frame)) frame.visible = visible;
    },
    BlzFrameIsVisible: (frame: unknown) => (isFrame(frame) ? frames().shown(frame) : false),
    BlzFrameSetEnable: (frame: unknown, enabled: boolean) => {
      if (isFrame(frame)) frame.enabled = enabled;
    },
    BlzFrameGetEnable: (frame: unknown) => (isFrame(frame) ? frame.enabled : false),
    BlzFrameSetFocus: (frame: unknown, flag: boolean) => {
      if (isFrame(frame)) frames().focus(frame, flag);
    },
    BlzFrameSetLevel: (frame: unknown, level: number) => {
      if (isFrame(frame)) frame.level = level;
    },
    BlzFrameSetSize: (frame: unknown, width: number, height: number) => {
      if (isFrame(frame)) {
        frame.width = width;
        frame.height = height;
      }
    },
    BlzFrameSetAbsPoint: (frame: unknown, point: unknown, x: number, y: number) => {
      if (isFrame(frame)) frame.points.set(point, { x, y });
    },
    BlzFrameClearAllPoints: (frame: unknown) => {
      if (isFrame(frame)) {
        frame.points.clear();
        frame.anchors.length = 0;
      }
    },
    BlzFrameSetPoint: (frame: unknown, point: unknown, relative: unknown, relativePoint: unknown, x: number, y: number) => {
      if (!isFrame(frame) || !isFrame(relative)) return;
      const name = (value: unknown) => typeof value === "number" ? FRAME_POINTS[value]?.[0] ?? "" : typeof value === "string" ? value : "";
      const ownPoint = name(point).replace("FRAMEPOINT_", "");
      for (let index = frame.anchors.length - 1; index >= 0; index--) if (frame.anchors[index]?.point === ownPoint) frame.anchors.splice(index, 1);
      frame.anchors.push({ point: ownPoint, relative, relativePoint: name(relativePoint).replace("FRAMEPOINT_", ""), x, y });
    },
    BlzFrameSetAllPoints: (frame: unknown, relative: unknown) => {
      if (!isFrame(frame) || !isFrame(relative)) return false;
      frame.points.clear();
      frame.anchors.length = 0;
      for (const point of ["TOPLEFT", "BOTTOMRIGHT"]) frame.anchors.push({ point, relative, relativePoint: point, x: 0, y: 0 });
      return true;
    },
  };
}
