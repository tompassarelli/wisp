import type { Body, Location } from "../bodies";
import type { Player } from "../players";
import { asBody } from "./bodyStore";
import { asHandle, asNumber, fromHandle } from "./types";
import { boundWorld } from "./world";

const stored = asBody;

export function mapCenter(): Location {
  const world = boundWorld();
  world.log?.("GetPlayableMapRect", []);
  const center = world.bodies.mapCenter();
  world.log?.("GetRectCenter", [center.rect]);
  return fromHandle<Location>(center.location);
}

export function locationX(location: Location): number {
  const world = boundWorld();
  world.log?.("GetLocationX", [location]);
  return world.bodies.locationAt(asHandle(location)).x;
}

export function locationY(location: Location): number {
  const world = boundWorld();
  world.log?.("GetLocationY", [location]);
  return world.bodies.locationAt(asHandle(location)).y;
}

export function removeLocation(location: Location): void {
  const world = boundWorld();
  world.log?.("RemoveLocation", [location]);
  world.bodies.removeLocation(asHandle(location));
}

export function createBody(player: Player, kind: number, x: number, y: number, facing: number): Body {
  const world = boundWorld();
  world.log?.("CreateUnit", [player, kind, x, y, facing]);
  return fromHandle<Body>(world.bodies.create(asNumber(player), kind, x, y, facing));
}

export function removeBody(body: Body): void {
  const world = boundWorld();
  world.log?.("RemoveUnit", [body]);
  world.bodies.remove(stored(body));
}

export function setBodyX(body: Body, x: number): void {
  const world = boundWorld();
  world.log?.("SetUnitX", [body, x]);
  world.bodies.setX(stored(body), x);
}

export function setBodyY(body: Body, y: number): void {
  const world = boundWorld();
  world.log?.("SetUnitY", [body, y]);
  world.bodies.setY(stored(body), y);
}

export function setBodyHeight(body: Body, height: number, rate: number): void {
  const world = boundWorld();
  world.log?.("SetUnitFlyHeight", [body, height, rate]);
  world.bodies.setHeight(stored(body), height);
}

export function setBodyFacing(body: Body, degrees: number): void {
  const world = boundWorld();
  world.log?.("BlzSetUnitFacingEx", [body, degrees]);
  world.bodies.setFacing(stored(body), degrees);
}

export function setBodyColor(body: Body, color: number): void {
  const world = boundWorld();
  world.log?.("ConvertPlayerColor", [color]);
  world.log?.("SetUnitColor", [body, color]);
  world.bodies.setColor(stored(body), color);
}

export function setBodyTint(body: Body, red: number, green: number, blue: number, alpha: number): void {
  const world = boundWorld();
  world.log?.("SetUnitVertexColor", [body, red, green, blue, alpha]);
  world.bodies.setTint(stored(body), red, green, blue, alpha);
}

export function setBodyScale(body: Body, x: number, y: number, z: number): void {
  const world = boundWorld();
  world.log?.("SetUnitScale", [body, x, y, z]);
  world.bodies.setScale(stored(body), x, y, z);
}

export function setBodyTimeScale(body: Body, scale: number): void {
  const world = boundWorld();
  world.log?.("SetUnitTimeScale", [body, scale]);
  world.bodies.setTimeScale(stored(body), scale);
}

export function setBodyAnimation(body: Body, name: string): void {
  const world = boundWorld();
  world.log?.("SetUnitAnimation", [body, name]);
  world.bodies.animate(stored(body), name);
}

export function setBodyAnimationIndex(body: Body, index: number): void {
  const world = boundWorld();
  world.log?.("SetUnitAnimationByIndex", [body, index]);
  world.bodies.animate(stored(body), index);
}

export function showBody(body: Body, show: boolean): void {
  const world = boundWorld();
  world.log?.("ShowUnit", [body, show]);
  world.bodies.show(stored(body), show);
}

export function setBodyTeamGlow(body: Body, show: boolean): void {
  boundWorld().log?.("BlzShowUnitTeamGlow", [body, show]);
}

export function bodyHidden(body: Body): boolean {
  boundWorld().log?.("IsUnitHidden", [body]);
  return !stored(body).visible;
}

export function bodyKind(body: Body): number {
  const world = boundWorld();
  world.log?.("GetUnitTypeId", [body]);
  return world.bodies.kind(stored(body));
}

export function bodyMoveSpeed(body: Body): number {
  boundWorld().log?.("GetUnitMoveSpeed", [body]);
  return stored(body).moveSpeed;
}

export function bodyAttackCooldown(body: Body): number {
  boundWorld().log?.("BlzGetUnitAttackCooldown", [body, 0]);
  return stored(body).attackCooldown;
}

export function setBodyName(body: Body, name: string): void {
  boundWorld().log?.("BlzSetUnitName", [body, name]);
}

export function setBodySelectionScale(body: Body, scale: number): void {
  boundWorld().log?.("BlzSetUnitRealField", [body, "UNIT_RF_SELECTION_SCALE", scale]);
}

export function setBodyMoveSpeed(body: Body, speed: number): void {
  const world = boundWorld();
  world.log?.("SetUnitMoveSpeed", [body, speed]);
  world.bodies.setMoveSpeed(stored(body), speed);
}

export function setBodyAttackCooldown(body: Body, cooldown: number): void {
  const world = boundWorld();
  world.log?.("BlzSetUnitAttackCooldown", [body, cooldown, 0]);
  world.bodies.setAttackCooldown(stored(body), cooldown);
}

export function setBodyBlendTime(body: Body, seconds: number): void {
  const world = boundWorld();
  world.log?.("SetUnitBlendTime", [body, seconds]);
  world.bodies.setBlendTime(stored(body), seconds);
}

export function setBodyInvulnerable(body: Body, invulnerable: boolean): void {
  boundWorld().log?.("SetUnitInvulnerable", [body, invulnerable]);
}

export function setBodyPathing(body: Body, pathing: boolean): void {
  boundWorld().log?.("SetUnitPathing", [body, pathing]);
}

export function pauseBody(body: Body, paused: boolean): void {
  boundWorld().log?.("PauseUnit", [body, paused]);
}

export function addBodyAbility(body: Body, ability: number): void {
  boundWorld().log?.("UnitAddAbility", [body, ability]);
}

export function removeBodyAbility(body: Body, ability: number): void {
  boundWorld().log?.("UnitRemoveAbility", [body, ability]);
}

export function setAbilityTooltip(ability: number, tooltip: string, level: number): void {
  boundWorld().log?.("BlzSetAbilityTooltip", [ability, tooltip, level]);
}
