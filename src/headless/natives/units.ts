import { addFloat32, subtractFloat32 } from "../../sim/binary32";
import { f32 } from "../../sim/f32";
import { type Bodies, type Body, DEATH_CUTOFF } from "../../game/native/bodyStore";
import type { Handle, HandleFactory } from "../../game/native/types";
import type { NativeBehavior } from "../clientTypes";
import { isHandle } from "../jassFormat";
import type { Warcraft3Abilities } from "../warcraft3Abilities";

export type Unit = Body;

export class Units {
  private readonly passiveAlliances = new Map<string, boolean>();
  private readonly groups = new Set<Handle>();
  private allPlayers: Handle | undefined;

  constructor(private readonly bodies: Bodies, private readonly handle: HandleFactory, private readonly abilities: Warcraft3Abilities) {}

  liveHandleCounts(): { readonly locations: number; readonly groups: number } {
    return { locations: this.bodies.liveLocations(), groups: this.groups.size };
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
    if (this.bodies.live.has(target) && !target.dead) this.setLife(target, subtractFloat32(this.value(target, "life"), damage));
  }

  engageable(caster: Unit, target: Unit, range: number): boolean {
    if (!this.bodies.live.has(caster) || !this.bodies.live.has(target) || caster.dead || target.dead || caster.owner === target.owner || this.passiveAlliances.get(`${caster.owner} ${target.owner}`) === true) return false;
    const dx = target.x - caster.x;
    const dy = target.y - caster.y;
    return !(dx * dx + dy * dy > range * range);
  }

  playerBehaviors(): Readonly<Record<string, NativeBehavior>> {
    return {
      GetHandleId: (handle: unknown) => (isHandle(handle) ? handle.id : handle),
      Location: (x: number, y: number) => this.bodies.location(x, y),
      RemoveLocation: (handle: Handle) => { this.bodies.removeLocation(handle); },
      MoveLocation: (handle: Handle, x: number, y: number) => { this.bodies.moveLocation(handle, x, y); },
      GetLocationX: (handle: Handle) => this.bodies.locationAt(handle).x,
      GetLocationY: (handle: Handle) => this.bodies.locationAt(handle).y,
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
    const bodies = this.bodies;
    return {
            CreateUnit: (owner: number, typeId: number, x: number, y: number, facing: number) => bodies.create(owner, typeId, x, y, facing),
      CreateUnitByName: (owner: number, name: string, x: number, y: number, facing: number) => bodies.create(owner, name.length === 4 ? name.charCodeAt(0) * 0x1000000 + name.charCodeAt(1) * 0x10000 + name.charCodeAt(2) * 0x100 + name.charCodeAt(3) : 0, x, y, facing),
            RemoveUnit: (unit: Unit) => { bodies.remove(unit); this.abilities.removeUnit(unit); },
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
      ShowUnit: (unit: Unit, show: boolean) => { bodies.show(unit, show); },
      IsUnitHidden: (unit: Unit) => !unit.visible,
      GetUnitFlyHeight: (unit: Unit) => unit.z,
      SetUnitFlyHeight: (unit: Unit, height: number) => { bodies.setHeight(unit, height); },
      GetUnitFacing: (unit: Unit) => unit.facing,
      SetUnitFacing: (unit: Unit, facing: number) => { bodies.setFacing(unit, facing); },
      BlzSetUnitFacingEx: (unit: Unit, facing: number) => { bodies.setFacing(unit, facing); },
      SetUnitScale: (unit: Unit, x: number, y: number, z: number) => { bodies.setScale(unit, x, y, z); },
      SetUnitTimeScale: (unit: Unit, timeScale: number) => { bodies.setTimeScale(unit, timeScale); },
      SetUnitBlendTime: (unit: Unit, blendTime: number) => { bodies.setBlendTime(unit, blendTime); },
      SetUnitVertexColor: (unit: Unit, red: number, green: number, blue: number, alpha: number) => { bodies.setTint(unit, red, green, blue, alpha); },
      SetUnitColor: (unit: Unit, color: number | string) => { bodies.setColor(unit, color); },
      SetUnitAnimation: (unit: Unit, animation: string) => { bodies.animate(unit, animation); },
      SetUnitAnimationByIndex: (unit: Unit, animation: number) => { bodies.animate(unit, animation); },
      SetUnitAnimationWithRarity: (unit: Unit, animation: string) => { bodies.animate(unit, animation); },
      GetUnitTypeId: (unit: Unit) => bodies.kind(unit),
      GetUnitX: (unit: Unit) => unit.x,
      GetUnitY: (unit: Unit) => unit.y,
      SetUnitX: (unit: Unit, x: number) => { bodies.setX(unit, x); },
      SetUnitY: (unit: Unit, y: number) => { bodies.setY(unit, y); },
      SetUnitPosition: (unit: Unit, x: number, y: number) => { bodies.setX(unit, x); bodies.setY(unit, y); },
      SetUnitMoveSpeed: (unit: Unit, value: number) => { bodies.setMoveSpeed(unit, value); },
      GetUnitMoveSpeed: (unit: Unit) => unit.moveSpeed,
    };
  }
}
