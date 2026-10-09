import { f32 } from "../sim/f32";
import type { Handle, NativeBehavior } from "./client";

export interface AbilityObjectFixture {
  readonly base: string;
  readonly realLevelFields: Readonly<Record<string, readonly number[]>>;
  readonly impactDelay: number;
}

export type AbilityObjectFixtures = Readonly<Record<number, AbilityObjectFixture>>;

const REAL_FIELDS: Readonly<Record<string, string>> = {
  ABILITY_RLF_CASTING_TIME: "acas", ABILITY_RLF_DURATION_NORMAL: "adur",
  ABILITY_RLF_DURATION_HERO: "ahdu", ABILITY_RLF_CAST_RANGE: "aran",
  ABILITY_RLF_DECAYING_DAMAGE: "Esh1", ABILITY_RLF_MOVEMENT_SPEED_FACTOR_ESH2: "Esh2",
  ABILITY_RLF_ATTACK_SPEED_FACTOR_ESH3: "Esh3", ABILITY_RLF_DECAY_POWER: "Esh4",
  ABILITY_RLF_INITIAL_DAMAGE_ESH5: "Esh5",
};

const realField = (which: unknown): string => {
  if (typeof which === "number") for (const field of Object.values(REAL_FIELDS)) {
    if (which === field.charCodeAt(0) * 0x1000000 + field.charCodeAt(1) * 0x10000 + field.charCodeAt(2) * 0x100 + field.charCodeAt(3)) return field;
  }
  return REAL_FIELDS[String(which)] ?? String(which);
};

interface UnitAbilities {
  readonly cooldowns: Map<string, number>;
  readonly remaining: Map<number, number>;
  readonly levels: Map<number, number>;
  readonly handles: Map<number, Handle>;
  readonly attackPeriods: Map<number, number>;
  readonly attackRemaining: Map<number, number>;
  auras: boolean;
  auraUI: boolean;
}

export class Warcraft3Abilities {
  constructor(private readonly objects: AbilityObjectFixtures = {}) {}
  private readonly units = new Map<Handle, UnitAbilities>();
  private readonly fields = new Map<Handle, Map<string, unknown>>();
  private readonly ids = new Map<Handle, number>();

  shadowStrike(unit: Handle): { interval: number; duration: number; range: number; initial: number; periodic: number; impactDelay: number } | undefined {
    const state = this.state(unit);
    for (const [id, ability] of state.handles) {
      const object = this.objects[id];
      if (object?.base !== "AEsh") continue;
      const level = (state.levels.get(id) ?? 1) - 1;
      const value = (field: string) => Number(this.fields.get(ability)?.get(`${field} ${level}`) ?? 0);
      if (value("Esh2") !== 0 || value("Esh3") !== 0 || value("Esh4") !== 0) return undefined;
      return { interval: value("acas"), duration: value("adur"), range: value("aran"), initial: value("Esh5"), periodic: value("Esh1"), impactDelay: object.impactDelay };
    }
    return undefined;
  }

  state(unit: Handle): UnitAbilities {
    let state = this.units.get(unit);
    if (state === undefined) {
      state = { cooldowns: new Map(), remaining: new Map(), levels: new Map(), handles: new Map(), attackPeriods: new Map(), attackRemaining: new Map(), auras: true, auraUI: true };
      this.units.set(unit, state);
    }
    return state;
  }

  removeUnit(unit: Handle): void {
    const state = this.units.get(unit);
    if (state === undefined) return;
    for (const ability of state.handles.values()) {
      this.fields.delete(ability);
      this.ids.delete(ability);
    }
    this.units.delete(unit);
  }

  tick(seconds: number): void {
    for (const unit of this.units.values()) {
      for (const [id, remaining] of unit.remaining) unit.remaining.set(id, f32(Math.max(0, remaining - seconds)));
      for (const [index, remaining] of unit.attackRemaining) unit.attackRemaining.set(index, f32(Math.max(0, remaining - seconds)));
    }
  }

  behaviors(handle: (this: void, kind: string) => Handle): Readonly<Record<string, NativeBehavior>> {
    const cooldown = (unit: Handle, id: number) => this.state(unit).cooldowns.get(`${id} ${(this.state(unit).levels.get(id) ?? 1) - 1}`) ?? 0;
    const remaining = (unit: Handle, id: number) => this.state(unit).remaining.get(id) ?? 0;
    const setRemaining = (unit: Handle, id: number, value: number) => { this.state(unit).remaining.set(id, f32(Math.max(0, value))); };
    const field = (ability: Handle, key: string) => this.fields.get(ability)?.get(key);
    const setField = (ability: Handle, key: string, value: unknown) => {
      const fields = this.fields.get(ability);
      if (fields === undefined) return false;
      fields.set(key, value);
      return true;
    };
    return {
      UnitAddAbility: (unit: Handle, id: number) => {
        const state = this.state(unit);
        if (state.handles.has(id)) return false;
        const ability = handle("ability");
        state.handles.set(id, ability);
        state.levels.set(id, 1);
        const fields = new Map<string, unknown>();
        const object = this.objects[id];
        if (object !== undefined) for (const [field, levels] of Object.entries(object.realLevelFields)) {
          for (let level = 0; level < levels.length; level++) fields.set(`${field} ${level}`, levels[level]);
        }
        this.fields.set(ability, fields);
        this.ids.set(ability, id);
        return true;
      },
      UnitRemoveAbility: (unit: Handle, id: number) => {
        const state = this.state(unit);
        const ability = state.handles.get(id);
        if (ability === undefined) return false;
        state.handles.delete(id);
        state.levels.delete(id);
        state.remaining.delete(id);
        this.fields.delete(ability);
        this.ids.delete(ability);
        return true;
      },
      GetUnitAbilityLevel: (unit: Handle, id: number) => this.state(unit).levels.get(id) ?? 0,
      SetUnitAbilityLevel: (unit: Handle, id: number, level: number) => {
        const state = this.state(unit);
        if (!state.handles.has(id)) return 0;
        state.levels.set(id, level);
        return level;
      },
      BlzGetUnitAbility: (unit: Handle, id: number) => this.state(unit).handles.get(id),
      BlzGetUnitAbilityByIndex: (unit: Handle, index: number) => Array.from(this.state(unit).handles.values())[index],
      BlzGetAbilityId: (ability: Handle) => this.ids.get(ability) ?? 0,
      BlzSetUnitAttackCooldown: (unit: Handle, duration: number, index: number) => { this.state(unit).attackPeriods.set(index, f32(duration)); },
      BlzGetUnitAttackCooldown: (unit: Handle, index: number) => this.state(unit).attackPeriods.get(index) ?? 0,
      BlzResetUnitAttack: (unit: Handle, index: number) => { this.state(unit).attackRemaining.set(index, 0); },
      BlzUnitEnableAuras: (unit: Handle, enable: boolean, affectsUI: boolean) => {
        const state = this.state(unit);
        state.auras = enable;
        if (affectsUI) state.auraUI = enable;
      },
      BlzSetUnitAbilityCooldown: (unit: Handle, id: number, level: number, duration: number) => { this.state(unit).cooldowns.set(`${id} ${level}`, f32(duration)); },
      BlzGetUnitAbilityCooldown: (unit: Handle, id: number, level: number) => this.state(unit).cooldowns.get(`${id} ${level}`) ?? 0,
      BlzGetUnitAbilityCooldownRemaining: remaining,
      BlzGetUnitAbilityCooldownPercent: (unit: Handle, id: number) => cooldown(unit, id) === 0 ? 0 : f32(remaining(unit, id) / cooldown(unit, id)),
      BlzSetUnitAbilityCooldownRemaining: setRemaining,
      BlzSetUnitAbilityCooldownPercent: (unit: Handle, id: number, percent: number) => setRemaining(unit, id, f32(cooldown(unit, id) * percent)),
      BlzAdjustUnitAbilityCooldownRemaining: (unit: Handle, id: number, duration: number) => setRemaining(unit, id, f32(remaining(unit, id) + duration)),
      BlzAdjustUnitAbilityCooldownPercent: (unit: Handle, id: number, percent: number) => setRemaining(unit, id, f32(remaining(unit, id) + f32(cooldown(unit, id) * percent))),
      BlzStartUnitAbilityCooldown: setRemaining,
      BlzEndUnitAbilityCooldown: (unit: Handle, id: number) => setRemaining(unit, id, 0),
      UnitResetCooldown: (unit: Handle) => this.state(unit).remaining.clear(),
      BlzGetAbilityRealLevelField: (ability: Handle, which: unknown, level: number) => field(ability, `${realField(which)} ${level}`) ?? 0,
      BlzSetAbilityRealLevelField: (ability: Handle, which: unknown, level: number, value: number) => setField(ability, `${realField(which)} ${level}`, f32(value)),
      BlzGetAbilityBooleanLevelField: (ability: Handle, which: unknown, level: number) => field(ability, `${String(which)} ${level}`) ?? false,
      BlzSetAbilityBooleanLevelField: (ability: Handle, which: unknown, level: number, value: boolean) => setField(ability, `${String(which)} ${level}`, value),
    };
  }
}
