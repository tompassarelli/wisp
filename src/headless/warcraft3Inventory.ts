import type { Handle, NativeBehavior } from "./client";
import { f32 } from "../sim/f32";

export interface Warcraft3ItemFixture {
  readonly itemType: number;
  readonly level: number;
  readonly equipmentType: number;
  readonly tag: number;
  readonly validMorph: boolean;
  readonly pickRandom: boolean;
}

export interface Warcraft3InventoryUnitFixture {
  readonly bagSize: number;
  readonly inventorySize: number;
  readonly extendedInventorySize: number;
  readonly loadout: Readonly<Record<number, readonly number[]>>;
  readonly heroGlowAllowed?: boolean;
  readonly animations?: Readonly<Record<string, number>>;
  readonly animationIndices?: Readonly<Record<number, number>>;
  readonly healMultiplier?: number;
  readonly itemHealMultiplier?: number;
  readonly talents?: Readonly<Record<string, number>>;
}

export interface Warcraft3InventoryFixtures {
  readonly items?: Readonly<Record<number, Warcraft3ItemFixture>>;
  readonly units?: Readonly<Record<number, Warcraft3InventoryUnitFixture>>;

  readonly chooseRandom?: (this: void, candidates: readonly number[]) => number;
}

export type InventoryEventKind = "equip" | "unequip";
export interface Warcraft3InventoryContext {
  handle(this: void, kind: string): Handle;
  getUnitTypeId(this: void, unit: Handle): number;
  readLife(this: void, unit: Handle): number;
  readMaxLife(this: void, unit: Handle): number;
  writeLife(this: void, unit: Handle, life: number): void;
  inventoryEvent?(this: void, unit: Handle, item: Handle, kind: InventoryEventKind): void;
}

export interface InventoryItemState {
  readonly handle: Handle;
  readonly typeId: number;
  x: number;
  y: number;
  color: number | string | undefined;
  holder: Handle | undefined;
  equipped: boolean;
  removed: boolean;
}

export interface InventoryUnitState {
  readonly bag: Map<number, Handle>;
  readonly equipment: Map<number, Handle>;
  readonly talents: Map<string, number>;
  heroGlowAllowed: boolean | undefined;
}

const EQUIPMENT_NAMES = ["NONE", "HEAD", "CHEST", "GLOVES", "BOOTS", "RING", "PRIMARY", "OFFHAND", "TRINKET", "ANY"];
const TAG_NAMES = ["UNDEFINED", "DROPPABLE", "QUESTREWARD", "BOSSDROP", "SECRET", "PUZZLE", "WORLD", "SHOP", "ANY"];
const SLOT_NAMES = ["HEAD", "CHEST", "GLOVES", "BOOTS", "RING", "RINGALT", "PRIMARY", "OFFHAND", "TRINKET"];
const ITEM_NAMES = ["PERMANENT", "CHARGED", "POWERUP", "ARTIFACT", "PURCHASABLE", "CAMPAIGN", "MISCELLANEOUS", "EQUIPMENT", "UNKNOWN", "ANY"];

function enumIndex(value: number | string, prefix: string, names: readonly string[]): number {
  if (typeof value === "number") return value;
  const index = names.indexOf(value.slice(prefix.length));
  if (!value.startsWith(prefix) || index < 0) throw new Error(`unsupported inventory constant ${value}`);
  return index;
}

export class Warcraft3Inventory {
  readonly items = new Map<Handle, InventoryItemState>();
  readonly units = new Map<Handle, InventoryUnitState>();
  readonly playerRaceSkins = new Map<number, number | string>();
  private event: { readonly unit: Handle; readonly item: Handle; readonly kind: InventoryEventKind } | undefined;

  constructor(private readonly context: Warcraft3InventoryContext, private readonly fixtures: Warcraft3InventoryFixtures = {}) {}

  withInventoryEvent<T>(unit: Handle, item: Handle, kind: InventoryEventKind, callback: (this: void) => T): T {
    const previous = this.event;
    this.event = { unit, item, kind };
    try { return callback(); } finally { this.event = previous; }
  }

  private unitFixture(unit: Handle): Warcraft3InventoryUnitFixture {
    const typeId = this.context.getUnitTypeId(unit);
    const fixture = this.fixtures.units?.[typeId];
    if (fixture === undefined) throw new Error(`inventory fixture missing for unit type ${typeId}`);
    return fixture;
  }

  private item(handle: Handle): InventoryItemState {
    const item = this.items.get(handle);
    if (item === undefined) throw new Error(`inventory item missing: ${handle.id}`);
    return item;
  }

  private itemFixture(handle: Handle): Warcraft3ItemFixture {
    const typeId = this.item(handle).typeId;
    const fixture = this.fixtures.items?.[typeId];
    if (fixture === undefined) throw new Error(`inventory fixture missing for item type ${typeId}`);
    return fixture;
  }

  unit(unit: Handle): InventoryUnitState {
    const existing = this.units.get(unit);
    if (existing !== undefined) return existing;
    const fixture = this.fixtures.units?.[this.context.getUnitTypeId(unit)];
    const talents = new Map<string, number>();
    for (const key of Object.keys(fixture?.talents ?? {})) talents.set(key, fixture?.talents?.[key] ?? 0);
    const state = { bag: new Map<number, Handle>(), equipment: new Map<number, Handle>(), talents, heroGlowAllowed: fixture?.heroGlowAllowed };
    this.units.set(unit, state);
    return state;
  }

  private detach(item: InventoryItemState): void {
    if (item.holder !== undefined) {
      const state = this.unit(item.holder);
      for (const [slot, handle] of state.bag) if (handle === item.handle) state.bag.delete(slot);
      for (const [slot, handle] of state.equipment) if (handle === item.handle) state.equipment.delete(slot);
    }
    item.holder = undefined;
    item.equipped = false;
  }

  private bagSlot(unit: Handle): number | undefined {
    const state = this.unit(unit);
    const size = this.unitFixture(unit).bagSize;
    for (let slot = 0; slot < size; slot++) if (!state.bag.has(slot)) return slot;
    return undefined;
  }

  private addItem(unit: Handle, handle: Handle): boolean {
    const item = this.item(handle);
    if (item.removed) return false;
    if (item.holder === unit && !item.equipped) return true;
    const slot = this.bagSlot(unit);
    if (slot === undefined) return false;
    this.detach(item);
    this.unit(unit).bag.set(slot, handle);
    item.holder = unit;
    return true;
  }

  private equip(unit: Handle, handle: Handle): boolean {
    const item = this.item(handle);
    if (item.removed) return false;
    if (item.holder === unit && item.equipped) return true;
    const slots = this.unitFixture(unit).loadout[this.itemFixture(handle).equipmentType] ?? [];
    const state = this.unit(unit);
    for (const slot of slots) {
      if (state.equipment.has(slot)) continue;
      this.detach(item);
      state.equipment.set(slot, handle);
      item.holder = unit;
      item.equipped = true;
      this.withInventoryEvent(unit, handle, "equip", () => this.context.inventoryEvent?.(unit, handle, "equip"));
      return true;
    }
    return false;
  }

  private unequip(unit: Handle, handle: Handle): void {
    const item = this.item(handle);
    if (item.holder !== unit || !item.equipped) return;
    const slot = this.bagSlot(unit);
    this.detach(item);
    if (slot !== undefined) {
      this.unit(unit).bag.set(slot, handle);
      item.holder = unit;
    }
    this.withInventoryEvent(unit, handle, "unequip", () => this.context.inventoryEvent?.(unit, handle, "unequip"));
  }

  private randomItem(type: number | string, level: number, equipment: number | string, tag: number | string, invalid: boolean, nonRandom: boolean): number {
    const itemType = enumIndex(type, "ITEM_TYPE_", ITEM_NAMES);
    const equipmentType = enumIndex(equipment, "EQUIPMENT_TYPE_", EQUIPMENT_NAMES);
    const itemTag = enumIndex(tag, "ITEMTAG_TYPE_", TAG_NAMES);
    if (this.fixtures.items === undefined) throw new Error("random item selection requires item fixtures");
    const candidates: number[] = [];
    for (const key of Object.keys(this.fixtures.items)) {
      const id = Number(key);
      const item = this.fixtures.items[id];
      if (item === undefined || (itemType !== 9 && item.itemType !== itemType) || item.level !== level || (equipmentType !== 9 && item.equipmentType !== equipmentType) || (itemTag !== 8 && item.tag !== itemTag) || (!invalid && !item.validMorph) || (!nonRandom && !item.pickRandom)) continue;
      candidates.push(id);
    }
    candidates.sort((a, b) => a - b);
    if (candidates.length === 0) return 0;
    if (this.fixtures.chooseRandom === undefined) throw new Error("random item selection requires a synchronized chooseRandom fixture");
    const result = this.fixtures.chooseRandom(candidates);
    if (!candidates.includes(result)) throw new Error(`random item fixture selected excluded type ${result}`);
    return result;
  }

  behaviors(): Readonly<Record<string, NativeBehavior>> {
    return {
      CreateItem: (typeId: number, x: number, y: number) => {
        const handle = this.context.handle("item");
        this.items.set(handle, { handle, typeId, x, y, color: undefined, holder: undefined, equipped: false, removed: false });
        return handle;
      },
      RemoveItem: (handle: Handle) => { const item = this.item(handle); this.detach(item); item.removed = true; },
      GetItemTypeId: (handle: Handle) => { const item = this.item(handle); return item.removed ? 0 : item.typeId; },
      GetItemX: (handle: Handle) => this.item(handle).x,
      GetItemY: (handle: Handle) => this.item(handle).y,
      SetItemPosition: (handle: Handle, x: number, y: number) => { const item = this.item(handle); item.x = x; item.y = y; },
      UnitAddItem: (unit: Handle, item: Handle) => this.addItem(unit, item),
      UnitRemoveItem: (unit: Handle, handle: Handle) => { const item = this.item(handle); if (item.holder === unit) this.detach(item); },
      UnitRemoveItemFromSlot: (unit: Handle, slot: number) => { const item = this.unit(unit).bag.get(slot); if (item !== undefined) this.detach(this.item(item)); return item; },
      UnitHasItem: (unit: Handle, handle: Handle) => this.item(handle).holder === unit,
      UnitItemInSlot: (unit: Handle, slot: number) => this.unit(unit).bag.get(slot),
      UnitInventorySize: (unit: Handle) => this.unitFixture(unit).inventorySize,
      BlzGetEquippedItem: () => this.event?.kind === "equip" ? this.event.item : undefined,
      BlzGetUnequippedItem: () => this.event?.kind === "unequip" ? this.event.item : undefined,
      BlzSetItemColor: (handle: Handle, color: number | string) => { this.item(handle).color = color; },
      BlzIsItemEquipped: (handle: Handle) => this.item(handle).equipped,
      BlzIsItemInBag: (handle: Handle) => { const item = this.item(handle); return item.holder !== undefined && !item.equipped; },
      BlzGetItemEquipmentType: (handle: Handle) => this.itemFixture(handle).equipmentType,
      BlzGetItemTag: (handle: Handle) => this.itemFixture(handle).tag,
      BlzUnitEquipItem: (unit: Handle, handle: Handle) => this.equip(unit, handle),
      BlzUnitUnequipItem: (unit: Handle, handle: Handle) => this.unequip(unit, handle),
      BlzUnitUnequipItemFromSlot: (unit: Handle, slot: number | string) => {
        const item = this.unit(unit).equipment.get(enumIndex(slot, "EQUIPMENT_LOADOUT_SLOT_", SLOT_NAMES));
        if (item !== undefined) this.unequip(unit, item);
        return item;
      },
      BlzUnitHasItemBagged: (unit: Handle, handle: Handle) => { const item = this.item(handle); return item.holder === unit && !item.equipped; },
      BlzUnitExtendedInventorySize: (unit: Handle) => this.unitFixture(unit).extendedInventorySize,
      BlzUnitItemInBagSlot: (unit: Handle, slot: number) => this.unit(unit).bag.get(slot),
      BlzUnitItemInEquipmentSlot: (unit: Handle, slot: number | string) => this.unit(unit).equipment.get(enumIndex(slot, "EQUIPMENT_LOADOUT_SLOT_", SLOT_NAMES)),
      BlzUnitHasItemEquipped: (unit: Handle, handle: Handle) => { const item = this.item(handle); return item.holder === unit && item.equipped; },
      BlzUnitHasLoadoutSlotEmpty: (unit: Handle, slot: number | string) => !this.unit(unit).equipment.has(enumIndex(slot, "EQUIPMENT_LOADOUT_SLOT_", SLOT_NAMES)),
      BlzUnitHasAnyItemEquipped: (unit: Handle) => this.unit(unit).equipment.size > 0,
      BlzUnitHasItemEquipmentOfType: (unit: Handle, equipment: number | string) => {
        const type = enumIndex(equipment, "EQUIPMENT_TYPE_", EQUIPMENT_NAMES);
        for (const item of this.unit(unit).equipment.values()) if (this.itemFixture(item).equipmentType === type) return true;
        return false;
      },
      BlzUnitCanEquipItemOfEquipmentType: (unit: Handle, equipment: number | string) => (this.unitFixture(unit).loadout[enumIndex(equipment, "EQUIPMENT_TYPE_", EQUIPMENT_NAMES)] ?? []).length > 0,
      ChooseRandomItemExWithFilter: (type: number | string, level: number, equipment: number | string, tag: number | string) => this.randomItem(type, level, equipment, tag, false, false),
      ChooseRandomItemExWithFilterAndIncludes: (type: number | string, level: number, equipment: number | string, tag: number | string, invalid: boolean, nonRandom: boolean) => this.randomItem(type, level, equipment, tag, invalid, nonRandom),
      SetPlayerRaceSkin: (player: number, preference: number | string) => { this.playerRaceSkins.set(player, preference); },
      AllowHeroGlowOnUnit: (unit: Handle) => { this.unit(unit).heroGlowAllowed = true; },
      DisallowHeroGlowOnUnit: (unit: Handle) => { this.unit(unit).heroGlowAllowed = false; },
      HeroGlowIsAllowedOnUnit: (unit: Handle) => {
        const allowed = this.unit(unit).heroGlowAllowed;
        if (allowed === undefined) throw new Error("hero glow initial value requires a unit fixture");
        return allowed;
      },
      BlzGetUnitAnimationDuration: (unit: Handle, animation: string) => {
        const duration = this.unitFixture(unit).animations?.[animation];
        if (duration === undefined) throw new Error(`animation duration fixture missing for ${animation}`);
        return f32(duration);
      },
      BlzGetUnitAnimationDurationByIndex: (unit: Handle, index: number) => {
        const duration = this.unitFixture(unit).animationIndices?.[index];
        if (duration === undefined) throw new Error(`animation duration fixture missing for index ${index}`);
        return f32(duration);
      },
      BlzResetUnitTalents: (unit: Handle) => {
        const initial = this.unitFixture(unit).talents;
        if (initial === undefined) throw new Error("talent reset requires a unit fixture");
        const talents = this.unit(unit).talents;
        talents.clear();
        for (const key of Object.keys(initial)) talents.set(key, initial[key] ?? 0);
      },
      BlzUnitHeal: (unit: Handle, source: Handle, amount: number, isItem: boolean, applyStatBonuses: boolean) => {
        const life = this.context.readLife(unit);
        if (life <= 0 || amount <= 0) return 0;
        let multiplier = 1;
        if (applyStatBonuses) {
          const fixture = this.unitFixture(source);
          const bonus = isItem ? fixture.itemHealMultiplier : fixture.healMultiplier;
          if (bonus === undefined) throw new Error("healing stat bonuses require a source unit fixture");
          multiplier = bonus;
        }
        const next = f32(Math.min(this.context.readMaxLife(unit), f32(life + f32(amount * multiplier))));
        this.context.writeLife(unit, next);
        return f32(this.context.readLife(unit) - life);
      },
    };
  }
}
