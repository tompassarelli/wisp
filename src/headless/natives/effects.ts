import type { Effects } from "../../game/native/effectStore";
import type { Lightnings } from "../../game/native/lightnings";
import type { TextTags } from "../../game/native/textTags";
import type { Handle } from "../../game/native/types";
import type { NativeBehavior } from "../clientTypes";

export function effectNatives(effects: Effects): Readonly<Record<string, NativeBehavior>> {
  return {
    AddSpecialEffect: (model: string, x: number, y: number) => effects.create(model, x, y),
    AddSpecialEffectLoc: (model: string) => effects.create(model, 0, 0),
    // Local position getters read attached effects at 0, 0 regardless of the unit position.
    AddSpecialEffectTarget: (model: string) => effects.create(model, 0, 0),
    DestroyEffect: (effect: Handle) => effects.destroy(effect),
    BlzRemoveEffect: (effect: Handle) => effects.remove(effect),
    BlzSetSpecialEffectAnimationBlendTime: (effect: Handle, time: number) => effects.setAnimationBlendTime(effect, time),
    BlzSetSpecialEffectAnimation: (effect: Handle, animation: string) => effects.setAnimation(effect, animation),
    BlzQueueSpecialEffectAnimation: (effect: Handle, animation: string) => effects.queueAnimation(effect, animation),
    BlzSetSpecialEffectTimeScale: (effect: Handle, timeScale: number) => effects.setTimeScale(effect, timeScale),
    BlzSetSpecialEffectTime: (effect: Handle, time: number) => effects.setTime(effect, time),
    BlzPlaySpecialEffect: (effect: Handle, animation: string | number) => effects.play(effect, animation),
    BlzPlaySpecialEffectWithTimeScale: (effect: Handle, animation: string | number, timeScale: number) => effects.play(effect, animation, timeScale),
    BlzSpecialEffectClearSubAnimations: (effect: Handle) => effects.clearSubAnimations(effect),
    BlzSpecialEffectAddSubAnimation: (effect: Handle, animation: string | number) => effects.addSubAnimation(effect, animation),
    BlzSpecialEffectRemoveSubAnimation: (effect: Handle, animation: string | number) => effects.removeSubAnimation(effect, animation),
    BlzGetLocalSpecialEffectX: (effect: Handle) => effects.x(effect),
    BlzGetLocalSpecialEffectY: (effect: Handle) => effects.y(effect),
    BlzGetLocalSpecialEffectZ: (effect: Handle) => effects.z(effect),
    BlzGetSpecialEffectScale: (effect: Handle) => effects.scale(effect),
    BlzSetSpecialEffectPosition: (effect: Handle, x: number, y: number, z: number) => effects.setPosition(effect, x, y, z),
    BlzSetSpecialEffectX: (effect: Handle, x: number) => effects.setX(effect, x),
    BlzSetSpecialEffectY: (effect: Handle, y: number) => effects.setY(effect, y),
    BlzSetSpecialEffectZ: (effect: Handle, z: number) => effects.setZ(effect, z),
    BlzSetSpecialEffectAlpha: (effect: Handle, alpha: number) => effects.setAlpha(effect, alpha),
    BlzSetSpecialEffectScale: (effect: Handle, scale: number) => effects.setScale(effect, scale),
    BlzSetSpecialEffectOrientation: (effect: Handle, yaw: number, pitch: number, roll: number) => effects.setOrientation(effect, yaw, pitch, roll),
    BlzSetSpecialEffectYaw: (effect: Handle, yaw: number) => effects.setYaw(effect, yaw),
    BlzSetSpecialEffectPitch: (effect: Handle, pitch: number) => effects.setPitch(effect, pitch),
    BlzSetSpecialEffectRoll: (effect: Handle, roll: number) => effects.setRoll(effect, roll),
    BlzSetSpecialEffectColor: (effect: Handle, r: number, g: number, b: number) => effects.setColor(effect, r, g, b),
    BlzSetSpecialEffectColorByPlayer: (effect: Handle, player: number) => effects.setTeamColor(effect, player),
    BlzSetSpecialEffectMatrixScale: (effect: Handle, x: number, y: number, z: number) => effects.setMatrixScale(effect, x, y, z),
    BlzResetSpecialEffectMatrix: (effect: Handle) => effects.resetMatrix(effect),
  };
}

export function lightningNatives(bolts: Lightnings): Readonly<Record<string, NativeBehavior>> {
  return {
    AddLightning: (codeName: string, _visible: boolean, x1: number, y1: number, x2: number, y2: number) => bolts.add(codeName, x1, y1, 0, x2, y2, 0),
    AddLightningEx: (codeName: string, _visible: boolean, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => bolts.add(codeName, x1, y1, z1, x2, y2, z2),
    DestroyLightning: (bolt: Handle) => bolts.destroy(bolt),
    MoveLightning: (bolt: Handle, _visible: boolean, x1: number, y1: number, x2: number, y2: number) => bolts.move(bolt, x1, y1, 0, x2, y2, 0),
    MoveLightningEx: (bolt: Handle, _visible: boolean, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => bolts.move(bolt, x1, y1, z1, x2, y2, z2),
    SetLightningColor: (bolt: Handle, red: number, green: number, blue: number, alpha: number) => bolts.setColor(bolt, red, green, blue, alpha),
    GetLightningColorR: (bolt: Handle) => bolts.channel(bolt, 0),
    GetLightningColorG: (bolt: Handle) => bolts.channel(bolt, 1),
    GetLightningColorB: (bolt: Handle) => bolts.channel(bolt, 2),
    GetLightningColorA: (bolt: Handle) => bolts.channel(bolt, 3),
  };
}

export interface TextTagContext {
  unitPosition(this: void, unit: unknown): { readonly x: number; readonly y: number; readonly z: number } | undefined;
}

export function textTagNatives(tags: TextTags, context: TextTagContext): Readonly<Record<string, NativeBehavior>> {
  return {
    CreateTextTag: () => tags.create(),
    DestroyTextTag: (tag: Handle) => tags.destroy(tag),
    SetTextTagText: (tag: Handle, text: string, height: number) => tags.setText(tag, text, height),
    SetTextTagPos: (tag: Handle, x: number, y: number, heightOffset: number) => tags.setPosition(tag, x, y, heightOffset),
    SetTextTagPosUnit: (tag: Handle, unit: unknown, heightOffset: number) => {
      const at = context.unitPosition(unit);
      if (at !== undefined) tags.setPosition(tag, at.x, at.y, at.z + heightOffset);
    },
    SetTextTagColor: (tag: Handle, red: number, green: number, blue: number, alpha: number) => tags.setColor(tag, red, green, blue, alpha),
    SetTextTagVelocity: (tag: Handle, xVelocity: number, yVelocity: number) => tags.setVelocity(tag, xVelocity, yVelocity),
    SetTextTagVisibility: (tag: Handle, visible: boolean) => tags.setVisible(tag, visible),
    SetTextTagSuspended: (tag: Handle, suspended: boolean) => tags.setSuspended(tag, suspended),
    SetTextTagPermanent: (tag: Handle, permanent: boolean) => tags.setPermanent(tag, permanent),
    SetTextTagAge: (tag: Handle, age: number) => tags.setAge(tag, age),
    SetTextTagLifespan: (tag: Handle, lifespan: number) => tags.setLifespan(tag, lifespan),
    SetTextTagFadepoint: (tag: Handle, fadepoint: number) => tags.setFadepoint(tag, fadepoint),
  };
}
