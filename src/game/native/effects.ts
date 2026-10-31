import type { Beam, Effect, EffectAnimation, FloatingText } from "../effects";
import type { Player } from "../players";
import { asAnimation, asHandle, asNumber, fromHandle } from "./types";
import { boundWorld } from "./world";

export function createEffect(model: string, x: number, y: number): Effect {
  const world = boundWorld();
  world.log?.("AddSpecialEffect", [model, x, y]);
  return fromHandle<Effect>(world.effects.create(model, x, y));
}

export function destroyEffect(effect: Effect): void {
  const world = boundWorld();
  world.log?.("DestroyEffect", [effect]);
  world.effects.destroy(asHandle(effect));
}

export function setEffectPosition(effect: Effect, x: number, y: number, z: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectPosition", [effect, x, y, z]);
  world.effects.setPosition(asHandle(effect), x, y, z);
}

export function setEffectZ(effect: Effect, z: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectZ", [effect, z]);
  world.effects.setZ(asHandle(effect), z);
}

export function setEffectScale(effect: Effect, scale: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectScale", [effect, scale]);
  world.effects.setScale(asHandle(effect), scale);
}

export function setEffectMatrixScale(effect: Effect, x: number, y: number, z: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectMatrixScale", [effect, x, y, z]);
  world.effects.setMatrixScale(asHandle(effect), x, y, z);
}

export function resetEffectMatrix(effect: Effect): void {
  const world = boundWorld();
  world.log?.("BlzResetSpecialEffectMatrix", [effect]);
  world.effects.resetMatrix(asHandle(effect));
}

export function setEffectOrientation(effect: Effect, yaw: number, pitch: number, roll: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectOrientation", [effect, yaw, pitch, roll]);
  world.effects.setOrientation(asHandle(effect), yaw, pitch, roll);
}

export function setEffectYaw(effect: Effect, yaw: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectYaw", [effect, yaw]);
  world.effects.setYaw(asHandle(effect), yaw);
}

export function setEffectPitch(effect: Effect, pitch: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectPitch", [effect, pitch]);
  world.effects.setPitch(asHandle(effect), pitch);
}

export function setEffectRoll(effect: Effect, roll: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectRoll", [effect, roll]);
  world.effects.setRoll(asHandle(effect), roll);
}

export function setEffectAlpha(effect: Effect, alpha: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectAlpha", [effect, alpha]);
  world.effects.setAlpha(asHandle(effect), alpha);
}

export function setEffectColor(effect: Effect, red: number, green: number, blue: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectColor", [effect, red, green, blue]);
  world.effects.setColor(asHandle(effect), red, green, blue);
}

export function setEffectTeamColor(effect: Effect, owner: Player): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectColorByPlayer", [effect, owner]);
  world.effects.setTeamColor(asHandle(effect), asNumber(owner));
}

export function playEffectAnimation(effect: Effect, animation: EffectAnimation): void {
  const world = boundWorld();
  world.log?.("BlzPlaySpecialEffect", [effect, animation]);
  world.effects.play(asHandle(effect), asAnimation(animation));
}

export function setEffectAnimation(effect: Effect, animation: string): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectAnimation", [effect, animation]);
  world.effects.setAnimation(asHandle(effect), animation);
}

export function setEffectTime(effect: Effect, seconds: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectTime", [effect, seconds]);
  world.effects.setTime(asHandle(effect), seconds);
}

export function setEffectTimeScale(effect: Effect, timeScale: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectTimeScale", [effect, timeScale]);
  world.effects.setTimeScale(asHandle(effect), timeScale);
}

export function setEffectBlendTime(effect: Effect, seconds: number): void {
  const world = boundWorld();
  world.log?.("BlzSetSpecialEffectAnimationBlendTime", [effect, seconds]);
  world.effects.setAnimationBlendTime(asHandle(effect), seconds);
}

export function clearEffectSubAnimations(effect: Effect): void {
  const world = boundWorld();
  world.log?.("BlzSpecialEffectClearSubAnimations", [effect]);
  world.effects.clearSubAnimations(asHandle(effect));
}

export function effectScale(effect: Effect): number {
  const world = boundWorld();
  world.log?.("BlzGetSpecialEffectScale", [effect]);
  return world.effects.scale(asHandle(effect));
}

export function effectX(effect: Effect): number {
  const world = boundWorld();
  world.log?.("BlzGetLocalSpecialEffectX", [effect]);
  return world.effects.x(asHandle(effect));
}

export function effectY(effect: Effect): number {
  const world = boundWorld();
  world.log?.("BlzGetLocalSpecialEffectY", [effect]);
  return world.effects.y(asHandle(effect));
}

export function effectZ(effect: Effect): number {
  const world = boundWorld();
  world.log?.("BlzGetLocalSpecialEffectZ", [effect]);
  return world.effects.z(asHandle(effect));
}

export function createBeam(model: string, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): Beam {
  const world = boundWorld();
  world.log?.("AddLightningEx", [model, false, x1, y1, z1, x2, y2, z2]);
  return fromHandle<Beam>(world.beams.add(model, x1, y1, z1, x2, y2, z2));
}

export function moveBeam(beam: Beam, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): boolean {
  const world = boundWorld();
  world.log?.("MoveLightningEx", [beam, false, x1, y1, z1, x2, y2, z2]);
  return world.beams.move(asHandle(beam), x1, y1, z1, x2, y2, z2);
}

export function setBeamColor(beam: Beam, red: number, green: number, blue: number, alpha: number): boolean {
  const world = boundWorld();
  world.log?.("SetLightningColor", [beam, red, green, blue, alpha]);
  return world.beams.setColor(asHandle(beam), red, green, blue, alpha);
}

export function destroyBeam(beam: Beam): boolean {
  const world = boundWorld();
  world.log?.("DestroyLightning", [beam]);
  return world.beams.destroy(asHandle(beam));
}

export function createFloatingText(): FloatingText {
  const world = boundWorld();
  world.log?.("CreateTextTag", []);
  return fromHandle<FloatingText>(world.floatingText.create());
}

export function setFloatingText(text: FloatingText, content: string, height: number): void {
  const world = boundWorld();
  world.log?.("SetTextTagText", [text, content, height]);
  world.floatingText.setText(asHandle(text), content, height);
}

export function setFloatingTextPosition(text: FloatingText, x: number, y: number, heightOffset: number): void {
  const world = boundWorld();
  world.log?.("SetTextTagPos", [text, x, y, heightOffset]);
  world.floatingText.setPosition(asHandle(text), x, y, heightOffset);
}

export function setFloatingTextColor(text: FloatingText, red: number, green: number, blue: number, alpha: number): void {
  const world = boundWorld();
  world.log?.("SetTextTagColor", [text, red, green, blue, alpha]);
  world.floatingText.setColor(asHandle(text), red, green, blue, alpha);
}

export function setFloatingTextVisible(text: FloatingText, visible: boolean): void {
  const world = boundWorld();
  world.log?.("SetTextTagVisibility", [text, visible]);
  world.floatingText.setVisible(asHandle(text), visible);
}

export function setFloatingTextPermanent(text: FloatingText, permanent: boolean): void {
  const world = boundWorld();
  world.log?.("SetTextTagPermanent", [text, permanent]);
  world.floatingText.setPermanent(asHandle(text), permanent);
}
