import type { Handle } from "../../game/native/types";
import type { NativeBehavior } from "../clientTypes";
import type { Input } from "../../game/native/inputStore";
import type { FrameUi } from "../../game/native/frameUi";
import { f32 } from "../../sim/f32";

export interface FrameContext {
  readonly ui: FrameUi;
  readonly textAreaAutoScroll: Map<Handle, boolean>;
  readonly input: Input;
}

export function inputNatives({ ui, textAreaAutoScroll, input }: FrameContext): Readonly<Record<string, NativeBehavior>> {
  const screen = ui.screen;
  return {
    BlzGetLocalClientWidth: () => screen.width,
    BlzGetLocalClientHeight: () => screen.height,
    BlzIsLocalClientActive: () => input.focused(),
    BlzIsKeyPressed: (key: number) => input.keyHeld(key),
    BlzIsMetaKeyPressed: (meta: number) => input.metaHeld(meta),
    BlzIsMouseButtonPressed: (button: unknown) => input.mouseButtonHeld(button),
    BlzGetMouseScreenPosX: () => input.pointerX,
    BlzGetMouseScreenPosY: () => input.pointerY,
    BlzPixelToFrameX: (pixel: number) => f32(pixel * f32(0.8) / screen.width),
    BlzPixelToFrameY: (pixel: number) => f32(pixel * f32(0.6) / screen.height),
    BlzFrameToPixelX: (frame: number) => Math.round(frame * screen.width / f32(0.8)),
    BlzFrameToPixelY: (frame: number) => Math.round(frame * screen.height / f32(0.6)),
    BlzTextAreaFrameSetAutoScroll: (frame: Handle, value: boolean) => { textAreaAutoScroll.set(frame, value); },
    BlzLoadTOCFile: () => true,
  };
}

export function frameNatives({ ui }: FrameContext): Readonly<Record<string, NativeBehavior>> {
  return {
    BlzGetOriginFrame: (type: unknown, index: number) => ui.originFrame(type, index),
    BlzGetFrameByName: (name: string, context: number) => ui.named(name, context),
    BlzFrameGetChildrenCount: (frame: unknown) => ui.childCount(frame),
    BlzFrameGetChild: (frame: Handle, index: number) => ui.child(frame, index),
    BlzCreateFrame: (name: string, owner: unknown, _priority: number, context: number) => ui.create(name, owner, context),
    BlzCreateSimpleFrame: (name: string, owner: unknown, context: number) => ui.createSimple(name, owner, context),
    BlzCreateFrameByType: (type: string, name: string, owner: unknown, inherits: string, context: number) => ui.createByType(type, name, owner, inherits, context),
    BlzDestroyFrame: (frame: unknown) => { ui.destroy(frame); },
    BlzFrameGetName: (frame: unknown) => ui.name(frame),
    BlzFrameGetParent: (frame: unknown) => ui.parent(frame),
    BlzFrameSetText: (frame: unknown, text: string) => { ui.setText(frame, text); },
    BlzFrameGetText: (frame: unknown) => ui.text(frame),
    BlzFrameSetTexture: (frame: unknown, texture: string) => { ui.setTexture(frame, texture); },
    BlzFrameSetModel: (frame: unknown, model: string, camera: number) => { ui.setModel(frame, model, camera); },
    BlzFrameSetSpriteAnimate: (frame: unknown, animation: number) => { ui.setSpriteAnimation(frame, animation); },
    WispFrameSetSpriteTime: (frame: unknown, seconds: number) => { ui.setSpriteTime(frame, seconds); },
    BlzFrameSetVertexColor: (frame: unknown, color: number) => { ui.setVertexColor(frame, color); },
    BlzFrameSetTextColor: (frame: unknown, color: number) => { ui.setTextColor(frame, color); },
    BlzFrameSetAlpha: (frame: unknown, alpha: number) => { ui.setAlpha(frame, alpha); },
    BlzFrameGetAlpha: (frame: unknown) => ui.alpha(frame),
    BlzFrameSetTextSizeLimit: (frame: unknown, size: number) => { ui.setTextLimit(frame, size); },
    BlzFrameGetTextSizeLimit: (frame: unknown) => ui.textLimit(frame),
    BlzFrameSetFont: (frame: unknown, file: string, height: number, flags: number) => { ui.setFont(frame, file, height, flags); },
    BlzFrameSetTextAlignment: (frame: unknown, vertical: unknown, horizontal: unknown) => { ui.setTextAlignment(frame, vertical, horizontal); },
    BlzFrameSetScale: (frame: unknown, scale: number) => { ui.setScale(frame, scale); },
    BlzFrameSetVisible: (frame: unknown, visible: boolean) => { ui.setVisible(frame, visible); },
    BlzFrameIsVisible: (frame: unknown) => ui.visible(frame),
    BlzFrameSetEnable: (frame: unknown, enabled: boolean) => { ui.setEnabled(frame, enabled); },
    BlzFrameGetEnable: (frame: unknown) => ui.enabled(frame),
    BlzFrameSetFocus: (frame: unknown, flag: boolean) => { ui.setFocus(frame, flag); },
    BlzFrameSetLevel: (frame: unknown, level: number) => { ui.setLevel(frame, level); },
    BlzFrameSetSize: (frame: unknown, width: number, height: number) => { ui.setSize(frame, width, height); },
    BlzFrameSetAbsPoint: (frame: unknown, point: unknown, x: number, y: number) => { ui.setAbsPoint(frame, point, x, y); },
    BlzFrameClearAllPoints: (frame: unknown) => { ui.clearPoints(frame); },
    BlzFrameSetPoint: (frame: unknown, point: unknown, relative: unknown, relativePoint: unknown, x: number, y: number) => { ui.setPoint(frame, point, relative, relativePoint, x, y); },
    BlzFrameSetAllPoints: (frame: unknown, relative: unknown) => ui.setAllPoints(frame, relative),
  };
}
