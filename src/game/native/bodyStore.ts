import { multiplyFloat32TowardZero, subtractFloat32TowardZero } from "../../sim/binary32";
import { f32 } from "../../sim/f32";
import { advanceAnimation, copyBlend, freshAnimation, selectAnimation } from "./animation";
import type { Handle, HandleFactory, UnitPose, UnitStateFixtures } from "./types";

export interface Body extends Handle, UnitPose {
  moveSpeed: number;
  attackCooldown: number;
  life: number | undefined;
  maxLife: number | undefined;
  mana: number | undefined;
  maxMana: number | undefined;
  dead: boolean;

  removed: boolean;
}

const PLAYER_COLORS = ["RED", "BLUE", "CYAN", "PURPLE", "YELLOW", "ORANGE", "GREEN", "PINK", "LIGHT_GRAY", "LIGHT_BLUE", "AQUA", "BROWN", "MAROON", "NAVY", "TURQUOISE", "VIOLET", "WHEAT", "PEACH", "MINT", "LAVENDER", "COAL", "SNOW", "EMERALD", "PEANUT", "BLACK"].map(name => "PLAYER_COLOR_" + name);

/** The store's view of a body handle that the contract names as a Warcraft unit. */
export const asBody = (value: unknown): Body => value as Body;

export const DEATH_CUTOFF = f32(0.405);

const RADIANS_PER_DEGREE = 0.01745329238474369;
const DEGREES_PER_RADIAN = 57.295780181884766;

const TURN = 6.2831854820251465;
/** Two ulps above the binary32 nearest 1 / TURN, as 3.0.1 multiplies by it. */
const TURNS_PER_RADIAN = 0.1591549664735794;

// Warcraft stores facing in radians with products rounded toward zero (wisp:docs/warsmash-notes.md, Unit position and facing).

export function bodyFacing(degrees: number): number {
  let radians = multiplyFloat32TowardZero(f32(degrees), RADIANS_PER_DEGREE);
  if (radians >= TURN || radians < -TURN) {
    const turns = multiplyFloat32TowardZero(radians, TURNS_PER_RADIAN);
    radians = multiplyFloat32TowardZero(f32(turns - Math.floor(turns)), TURN);
  } else if (radians < 0) radians = subtractFloat32TowardZero(TURN, -radians);
  return multiplyFloat32TowardZero(radians, DEGREES_PER_RADIAN);
}

/** The posed bodies of one running game and the locations the map asked for. */
export class Bodies {
  readonly live = new Map<Handle, Body>();
  private removals: Body[] = [];
  private readonly locations = new Map<Handle, { x: number; y: number }>();

  constructor(private readonly handle: HandleFactory, private readonly states: UnitStateFixtures) {}

  liveLocations(): number {
    return this.locations.size;
  }

  location(x: number, y: number): Handle {
    const handle = this.handle("location");
    this.locations.set(handle, { x, y });
    return handle;
  }

  locationAt(handle: Handle): { readonly x: number; readonly y: number } {
    return this.locations.get(handle) ?? { x: 0, y: 0 };
  }

  removeLocation(handle: Handle): void {
    this.locations.delete(handle);
  }

  moveLocation(handle: Handle, x: number, y: number): void {
    const location = this.locations.get(handle);
    if (location !== undefined) { location.x = x; location.y = y; }
  }

  /** The playable map's rect and its centre, which Warcraft's natives return as handles and the map reads through `locationAt`, so the centre is the origin. */
  mapCenter(): { readonly rect: Handle; readonly location: Handle } {
    return { rect: this.handle("rect"), location: this.handle("location") };
  }

  create(owner: number, typeId: number, x: number, y: number, facing: number): Body {
    const handle = this.handle("unit");
    const state = this.states[typeId];
    const body: Body = { ...handle, ...freshAnimation(), handle, typeId, owner, x, y, z: 0, facing: bodyFacing(facing), scale: [1, 1, 1], alpha: 255,
      color: [255, 255, 255], teamColor: owner, timeScale: 1,
      visible: true, moveSpeed: 0, attackCooldown: 0, life: state?.life, maxLife: state?.maxLife,
      mana: state?.mana, maxMana: state?.maxMana, dead: state !== undefined && state.life <= DEATH_CUTOFF, removed: false };
    this.live.set(body, body);
    return body;
  }

  remove(body: Body): void {
    this.removals.push(body);
    this.live.delete(body);
  }

  setX(body: Body, x: number): void {
    body.x = f32(x);
  }

  setY(body: Body, y: number): void {
    body.y = f32(y);
  }

  setHeight(body: Body, height: number): void {
    body.z = f32(height);
  }

  setFacing(body: Body, degrees: number): void {
    body.facing = bodyFacing(degrees);
  }

  setColor(body: Body, color: number | string): void {
    body.teamColor = typeof color === "number" ? color : PLAYER_COLORS.indexOf(color);
  }

  setTint(body: Body, red: number, green: number, blue: number, alpha: number): void {
    body.color = [red, green, blue];
    body.alpha = alpha;
  }

  setScale(body: Body, x: number, y: number, z: number): void {
    body.scale = [x, y, z];
  }

  setTimeScale(body: Body, timeScale: number): void {
    body.timeScale = timeScale;
  }

  setBlendTime(body: Body, seconds: number): void {
    body.animationBlendTime = seconds;
  }

  animate(body: Body, animation: string | number): void {
    selectAnimation(body, animation);
  }

  show(body: Body, show: boolean): void {
    body.visible = show;
  }

  setMoveSpeed(body: Body, speed: number): void {
    body.moveSpeed = f32(speed);
  }

  setAttackCooldown(body: Body, cooldown: number): void {
    body.attackCooldown = f32(cooldown);
  }

  kind(body: Body): number {
    return body.removed ? 0 : body.typeId;
  }

  draw(seconds: number): void {
    for (const body of this.live.values()) advanceAnimation(body, body.timeScale, f32(seconds));
  }

  settleRemovals(): void {
    for (const body of this.removals) body.removed = true;
    this.removals = [];
  }

  poses(): UnitPose[] {
    const poses: UnitPose[] = [];
    for (const unit of this.live.values()) poses.push({ handle: unit.handle, typeId: unit.typeId, owner: unit.owner,
      x: unit.x, y: unit.y, z: unit.z, facing: unit.facing, scale: [...unit.scale], alpha: unit.alpha, color: [...unit.color],
      teamColor: unit.teamColor, timeScale: unit.timeScale, visible: unit.visible, animation: unit.animation, subAnimations: [...unit.subAnimations],
      animationElapsed: unit.animationElapsed, animationClock: unit.animationClock,
      animationBlendTime: unit.animationBlendTime, animationBlend: copyBlend(unit.animationBlend) });
    return poses;
  }
}
