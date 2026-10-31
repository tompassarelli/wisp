import { addFloat32, multiplyFloat32TowardZero, subtractFloat32, subtractFloat32TowardZero } from "../../sim/binary32";
import { f32 } from "../../sim/f32";
import { advanceAnimation, type AnimationBlend, copyBlend, freshAnimation, selectAnimation } from "../../game/native/animation";
import type { Handle, HandleFactory } from "../../game/native/types";
import type { NativeBehavior, UnitPose, UnitStateFixtures } from "../clientTypes";
import { isHandle } from "../jassFormat";
import type { Warcraft3Abilities } from "../warcraft3Abilities";

export interface Unit extends Handle, UnitPose {
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

const DEATH_CUTOFF = f32(0.405);

const RADIANS_PER_DEGREE = 0.01745329238474369;
const DEGREES_PER_RADIAN = 57.295780181884766;

const TURN = 6.2831854820251465;
/** Two ulps above the binary32 nearest 1 / TURN, as 3.0.1 multiplies by it. */
const TURNS_PER_RADIAN = 0.1591549664735794;

// Warcraft stores facing in radians with products rounded toward zero (wisp:docs/warsmash-notes.md, Unit position and facing).

function unitFacing(degrees: number): number {
  let radians = multiplyFloat32TowardZero(f32(degrees), RADIANS_PER_DEGREE);
  if (radians >= TURN || radians < -TURN) {
    const turns = multiplyFloat32TowardZero(radians, TURNS_PER_RADIAN);
    radians = multiplyFloat32TowardZero(f32(turns - Math.floor(turns)), TURN);
  } else if (radians < 0) radians = subtractFloat32TowardZero(TURN, -radians);
  return multiplyFloat32TowardZero(radians, DEGREES_PER_RADIAN);
}

export class Units {
  readonly live = new Map<Handle, Unit>();
  private removals: Unit[] = [];
  private readonly passiveAlliances = new Map<string, boolean>();
  private readonly locations = new Map<Handle, { x: number; y: number }>();
  private readonly groups = new Set<Handle>();
  private allPlayers: Handle | undefined;

  constructor(private readonly states: UnitStateFixtures, private readonly handle: HandleFactory, private readonly abilities: Warcraft3Abilities) {}

  liveHandleCounts(): { readonly locations: number; readonly groups: number } {
    return { locations: this.locations.size, groups: this.groups.size };
  }

  location(x: number, y: number): Handle {
    const handle = this.handle("location");
    this.locations.set(handle, { x, y });
    return handle;
  }

  create(owner: number, typeId: number, x: number, y: number, facing: number): Unit {
    const handle = this.handle("unit");
    const state = this.states[typeId];
    const unit: Unit = { ...handle, ...freshAnimation(), handle, typeId, owner, x, y, z: 0, facing: unitFacing(facing), scale: [1, 1, 1], alpha: 255,
      color: [255, 255, 255], teamColor: owner, timeScale: 1,
      visible: true, moveSpeed: 0, attackCooldown: 0, life: state?.life, maxLife: state?.maxLife,
      mana: state?.mana, maxMana: state?.maxMana, dead: state !== undefined && state.life <= DEATH_CUTOFF, removed: false };
    this.live.set(unit, unit);
    return unit;
  }

  value(unit: Unit, field: "life" | "maxLife" | "mana" | "maxMana"): number {
    if (unit.removed) return 0;
    const value = unit[field];
    if (value === undefined) throw new Error(`unit type ${unit.typeId}: declare unitStates.${unit.typeId}.${field} or set it before reading`);
    return value;
  }

  // Native life writes round halfway changes toward zero before applying the cutoff (wisp:docs/warsmash-notes.md#native-results-for-44).

  setLife(unit: Unit, life: number): void {
    if (unit.removed) return;
    const value = unit.life === undefined ? f32(life) : addFloat32(unit.life, subtractFloat32(f32(life), unit.life, true));
    if (!unit.dead && value <= DEATH_CUTOFF) {
      unit.life = 0;
      unit.dead = true;
    } else unit.life = value;
  }

  strike(target: Unit, damage: number): void {
    if (this.live.has(target) && !target.dead) this.setLife(target, subtractFloat32(this.value(target, "life"), damage));
  }

  engageable(caster: Unit, target: Unit, range: number): boolean {
    if (!this.live.has(caster) || !this.live.has(target) || caster.dead || target.dead || caster.owner === target.owner || this.passiveAlliances.get(`${caster.owner} ${target.owner}`) === true) return false;
    const dx = target.x - caster.x;
    const dy = target.y - caster.y;
    return !(dx * dx + dy * dy > range * range);
  }

  draw(seconds: number): void {
    for (const unit of this.live.values()) advanceAnimation(unit, unit.timeScale, f32(seconds));
  }

  settleRemovals(): void {
    for (const unit of this.removals) unit.removed = true;
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

  playerBehaviors(): Readonly<Record<string, NativeBehavior>> {
    return {
      GetHandleId: (handle: unknown) => (isHandle(handle) ? handle.id : handle),
      Location: (x: number, y: number) => this.location(x, y),
      RemoveLocation: (handle: Handle) => { this.locations.delete(handle); },
      MoveLocation: (handle: Handle, x: number, y: number) => {
        const location = this.locations.get(handle);
        if (location !== undefined) { location.x = x; location.y = y; }
      },
      GetLocationX: (handle: Handle) => this.locations.get(handle)?.x ?? 0,
      GetLocationY: (handle: Handle) => this.locations.get(handle)?.y ?? 0,
      CreateGroup: () => {
        const handle = this.handle("group");
        this.groups.add(handle);
        return handle;
      },
      DestroyGroup: (handle: Handle) => { this.groups.delete(handle); },
      GetPlayersAll: () => {
        if (this.allPlayers === undefined) this.allPlayers = this.handle("force");
        return this.allPlayers;
      },
      SetPlayerAlliance: (source: number, target: number, which: string, allied: boolean) => {
        if (which !== "ALLIANCE_PASSIVE") throw new Error(`SetPlayerAlliance: unsupported alliance ${which}`);
        this.passiveAlliances.set(`${source} ${target}`, allied);
      },
    };
  }

  behaviors(): Readonly<Record<string, NativeBehavior>> {
    const animate = (unit: Unit, animation: string | number): void => { selectAnimation(unit, animation); };
    return {
      CreateUnit: (owner: number, typeId: number, x: number, y: number, facing: number) => this.create(owner, typeId, x, y, facing),
      CreateUnitByName: (owner: number, name: string, x: number, y: number, facing: number) => this.create(owner, name.length === 4 ? name.charCodeAt(0) * 0x1000000 + name.charCodeAt(1) * 0x10000 + name.charCodeAt(2) * 0x100 + name.charCodeAt(3) : 0, x, y, facing),
      RemoveUnit: (unit: Unit) => { this.removals.push(unit); this.live.delete(unit); this.abilities.removeUnit(unit); },
      GetOwningPlayer: (unit: Unit) => unit.owner,
      GetWidgetLife: (unit: Unit) => this.value(unit, "life"),
      SetWidgetLife: (unit: Unit, life: number) => this.setLife(unit, life),
      KillUnit: (unit: Unit) => { if (!unit.removed) { unit.life = 0; unit.dead = true; } },
      GetUnitState: (unit: Unit, state: string) => {
        if (state === "UNIT_STATE_LIFE") return this.value(unit, "life");
        if (state === "UNIT_STATE_MAX_LIFE") return this.value(unit, "maxLife");
        if (state === "UNIT_STATE_MANA") return this.value(unit, "mana");
        if (state === "UNIT_STATE_MAX_MANA") return this.value(unit, "maxMana");
        throw new Error(`GetUnitState: unsupported state ${state}`);
      },
      SetUnitState: (unit: Unit, state: string, value: number) => {
        if (unit.removed) return;
        if (state === "UNIT_STATE_LIFE") this.setLife(unit, value);
        else if (state === "UNIT_STATE_MANA") unit.mana = unit.mana === undefined ? f32(value) : addFloat32(unit.mana, subtractFloat32(f32(value), unit.mana, true));
        // Warcraft ignores maximum life and mana writes here; BlzSetUnitMaxHP and BlzSetUnitMaxMana set them.
        else if (state !== "UNIT_STATE_MAX_LIFE" && state !== "UNIT_STATE_MAX_MANA") throw new Error(`SetUnitState: unsupported state ${state}`);
      },
      BlzGetUnitMaxHP: (unit: Unit) => this.value(unit, "maxLife"),
      BlzSetUnitMaxHP: (unit: Unit, value: number) => { if (!unit.removed) unit.maxLife = value; },
      BlzGetUnitMaxMana: (unit: Unit) => this.value(unit, "maxMana"),
      BlzSetUnitMaxMana: (unit: Unit, value: number) => { if (!unit.removed) unit.maxMana = value; },
      ShowUnit: (unit: Unit, show: boolean) => { unit.visible = show; },
      IsUnitHidden: (unit: Unit) => !unit.visible,
      GetUnitFlyHeight: (unit: Unit) => unit.z,
      SetUnitFlyHeight: (unit: Unit, height: number) => { unit.z = f32(height); },
      GetUnitFacing: (unit: Unit) => unit.facing,
      SetUnitFacing: (unit: Unit, facing: number) => { unit.facing = unitFacing(facing); },
      BlzSetUnitFacingEx: (unit: Unit, facing: number) => { unit.facing = unitFacing(facing); },
      SetUnitScale: (unit: Unit, x: number, y: number, z: number) => { unit.scale = [x, y, z]; },
      SetUnitTimeScale: (unit: Unit, timeScale: number) => { unit.timeScale = timeScale; },
      SetUnitBlendTime: (unit: Unit, blendTime: number) => { unit.animationBlendTime = blendTime; },
      SetUnitVertexColor: (unit: Unit, red: number, green: number, blue: number, alpha: number) => {
        unit.color = [red, green, blue];
        unit.alpha = alpha;
      },
      SetUnitColor: (unit: Unit, color: number | string) => {
        unit.teamColor = typeof color === "number" ? color : PLAYER_COLORS.indexOf(color);
      },
      SetUnitAnimation: (unit: Unit, animation: string) => animate(unit, animation),
      SetUnitAnimationByIndex: (unit: Unit, animation: number) => animate(unit, animation),
      SetUnitAnimationWithRarity: (unit: Unit, animation: string) => animate(unit, animation),
      GetUnitTypeId: (unit: Unit) => unit.removed ? 0 : unit.typeId,
      GetUnitX: (unit: Unit) => unit.x,
      GetUnitY: (unit: Unit) => unit.y,
      SetUnitX: (unit: Unit, x: number) => {
        unit.x = f32(x);
      },
      SetUnitY: (unit: Unit, y: number) => {
        unit.y = f32(y);
      },
      SetUnitPosition: (unit: Unit, x: number, y: number) => {
        unit.x = f32(x);
        unit.y = f32(y);
      },
      SetUnitMoveSpeed: (unit: Unit, value: number) => {
        unit.moveSpeed = f32(value);
      },
      GetUnitMoveSpeed: (unit: Unit) => unit.moveSpeed,
    };
  }
}
