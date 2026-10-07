import { HeadlessClient, type Handle } from "../../src/headless/client";
import { parseNativeDeclarations, type NativeDeclarations } from "../../src/headless/declarations";
import { Warcraft3Inventory, type Warcraft3InventoryFixtures } from "../../src/headless/warcraft3Inventory";

export const INVENTORY_FIXTURE: Warcraft3InventoryFixtures = {
  items: {
    101: { itemType: 7, level: 2, equipmentType: 1, tag: 1, validMorph: true, pickRandom: true },
    102: { itemType: 7, level: 2, equipmentType: 5, tag: 1, validMorph: true, pickRandom: true },
    103: { itemType: 7, level: 2, equipmentType: 5, tag: 1, validMorph: false, pickRandom: true },
    104: { itemType: 7, level: 2, equipmentType: 5, tag: 1, validMorph: true, pickRandom: false },
    105: { itemType: 7, level: 2, equipmentType: 5, tag: 1, validMorph: false, pickRandom: false },
    106: { itemType: 7, level: 3, equipmentType: 5, tag: 1, validMorph: true, pickRandom: true },
    107: { itemType: 7, level: 2, equipmentType: 5, tag: 2, validMorph: true, pickRandom: true },
    108: { itemType: 0, level: 2, equipmentType: 5, tag: 1, validMorph: true, pickRandom: true },
  },
  units: {
    11: {
      bagSize: 3,
      inventorySize: 2,
      extendedInventorySize: 3,
      loadout: { 1: [0], 5: [4, 5], 6: [6], 7: [7] },
      heroGlowAllowed: true,
      animations: { stand: 2, attack: 1 },
      animationIndices: { 0: 2, 1: 1 },
      healMultiplier: 2,
      itemHealMultiplier: 3,
      talents: { health: 0, speed: 0 },
    },
  },
  chooseRandom: (candidates) => candidates[candidates.length - 1] ?? 0,
};

const declarations = parseNativeDeclarations(`
declare function CreateUnit(this: void, owner: number, type: number, x: number, y: number, facing: number): unit;
declare function CreateItem(this: void, type: number, x: number, y: number): item;
declare function RemoveItem(this: void, item: item): void;
declare function GetItemTypeId(this: void, item: item): number;
declare function GetItemX(this: void, item: item): number;
declare function GetItemY(this: void, item: item): number;
declare function SetItemPosition(this: void, item: item, x: number, y: number): void;
declare function UnitAddItem(this: void, unit: unit, item: item): boolean;
declare function UnitRemoveItem(this: void, unit: unit, item: item): void;
declare function UnitRemoveItemFromSlot(this: void, unit: unit, slot: number): item;
declare function UnitHasItem(this: void, unit: unit, item: item): boolean;
declare function UnitItemInSlot(this: void, unit: unit, slot: number): item;
declare function UnitInventorySize(this: void, unit: unit): number;
declare function BlzGetEquippedItem(this: void): item;
declare function BlzGetUnequippedItem(this: void): item;
declare function BlzSetItemColor(this: void, item: item, color: playercolor): void;
declare function BlzIsItemEquipped(this: void, item: item): boolean;
declare function BlzIsItemInBag(this: void, item: item): boolean;
declare function BlzGetItemEquipmentType(this: void, item: item): equipmentType;
declare function BlzGetItemTag(this: void, item: item): itemTag;
declare function BlzUnitEquipItem(this: void, unit: unit, item: item): boolean;
declare function BlzUnitUnequipItem(this: void, unit: unit, item: item): void;
declare function BlzUnitUnequipItemFromSlot(this: void, unit: unit, slot: loadoutslot): item;
declare function BlzUnitHasItemBagged(this: void, unit: unit, item: item): boolean;
declare function BlzUnitExtendedInventorySize(this: void, unit: unit): number;
declare function BlzUnitItemInBagSlot(this: void, unit: unit, slot: number): item;
declare function BlzUnitItemInEquipmentSlot(this: void, unit: unit, slot: loadoutslot): item;
declare function BlzUnitHasItemEquipped(this: void, unit: unit, item: item): boolean;
declare function BlzUnitHasLoadoutSlotEmpty(this: void, unit: unit, slot: loadoutslot): boolean;
declare function BlzUnitHasAnyItemEquipped(this: void, unit: unit): boolean;
declare function BlzUnitHasItemEquipmentOfType(this: void, unit: unit, equipment: equipmentType): boolean;
declare function BlzUnitCanEquipItemOfEquipmentType(this: void, unit: unit, equipment: equipmentType): boolean;
declare function ChooseRandomItemExWithFilter(this: void, type: itemtype, level: number, equipment: equipmentType, tag: itemTag): number;
declare function ChooseRandomItemExWithFilterAndIncludes(this: void, type: itemtype, level: number, equipment: equipmentType, tag: itemTag, invalid: boolean, nonRandom: boolean): number;
declare function SetPlayerRaceSkin(this: void, player: player, preference: racepreference): void;
declare function AllowHeroGlowOnUnit(this: void, unit: unit): void;
declare function DisallowHeroGlowOnUnit(this: void, unit: unit): void;
declare function HeroGlowIsAllowedOnUnit(this: void, unit: unit): boolean;
declare function BlzGetUnitAnimationDuration(this: void, unit: unit, name: string): number;
declare function BlzGetUnitAnimationDurationByIndex(this: void, unit: unit, index: number): number;
declare function BlzResetUnitTalents(this: void, unit: unit): void;
declare function BlzUnitHeal(this: void, unit: unit, source: unit, life: number, item: boolean, bonuses: boolean): number;
declare function GetUnitTypeId(this: void, unit: unit): number;
declare function GetWidgetLife(this: void, unit: unit): number;
declare function BlzGetUnitMaxHP(this: void, unit: unit): number;
declare function SetWidgetLife(this: void, unit: unit, life: number): void;
`);

export const INVENTORY_TESTED_NAMES: readonly string[] = declarations.functions.map(([name]) => name);

export function inventoryFixture(this: void, nativeDeclarations: NativeDeclarations = declarations): number {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown, label: string) => {
    checks++;
    if (actual !== expected) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  };
  let inventory: Warcraft3Inventory | undefined;
  let client: HeadlessClient | undefined;
  const call = (name: string, ...args: unknown[]): unknown => {
    if (client === undefined) throw new Error("fixture client missing");
    const native = client.natives[name] as (this: void, ...args: unknown[]) => unknown;
    return native(...args);
  };
  let nextId = 1000;
  let equipEvents = 0;
  let unequipEvents = 0;
  client = new HeadlessClient({
    slot: 0, filePrefix: "inventory", humans: [0], declarations: nativeDeclarations,
    network: [], screenWidth: 1920, localNatives: {},
    unitStates: { 11: { life: 40, maxLife: 100, mana: 0, maxMana: 0 } },
    natives: (current) => {
      const invoke = (name: string, ...args: unknown[]) => (current.natives[name] as (this: void, ...args: unknown[]) => unknown)(...args);
      inventory = new Warcraft3Inventory({
        handle: (kind) => ({ kind, id: ++nextId }),
        getUnitTypeId: (unit) => invoke("GetUnitTypeId", unit) as number,
        readLife: (unit) => invoke("GetWidgetLife", unit) as number,
        readMaxLife: (unit) => invoke("BlzGetUnitMaxHP", unit) as number,
        writeLife: (unit, life) => { invoke("SetWidgetLife", unit, life); },
        inventoryEvent: (unit, item, kind) => {
          equal(call(kind === "equip" ? "BlzGetEquippedItem" : "BlzGetUnequippedItem"), item, `${kind} event item`);
          equal(call(kind === "equip" ? "BlzGetUnequippedItem" : "BlzGetEquippedItem"), undefined, `${kind} unrelated event item`);
          if (kind === "equip") equipEvents++; else unequipEvents++;
        },
      }, INVENTORY_FIXTURE);
      return inventory.behaviors();
    },
  });
  if (inventory === undefined) throw new Error("fixture inventory missing");
  const unit = call("CreateUnit", 0, 11, 0, 0, 0) as Handle;
  const other = call("CreateUnit", 0, 11, 0, 0, 0) as Handle;
  const head = call("CreateItem", 101, 3, 4) as Handle;
  const ring = call("CreateItem", 102, 0, 0) as Handle;
  const ringAlt = call("CreateItem", 102, 0, 0) as Handle;
  const thirdRing = call("CreateItem", 102, 0, 0) as Handle;
  equal(call("BlzGetEquippedItem"), undefined, "outside equip event");
  equal(call("BlzGetUnequippedItem"), undefined, "outside unequip event");
  equal(call("GetItemX", head), 3, "item x");
  equal(call("GetItemY", head), 4, "item y");
  call("SetItemPosition", head, 5, 6);
  equal(call("GetItemX", head), 5, "moved item x");
  equal(call("GetItemY", head), 6, "moved item y");
  call("BlzSetItemColor", head, "PLAYER_COLOR_BLUE");
  equal(inventory.items.get(head)?.color, "PLAYER_COLOR_BLUE", "item color");
  equal(call("BlzGetItemEquipmentType", head), 1, "head equipment type");
  equal(call("BlzGetItemTag", head), 1, "droppable tag");
  equal(call("BlzUnitCanEquipItemOfEquipmentType", unit, "EQUIPMENT_TYPE_HEAD"), true, "unit supports head");
  equal(call("BlzUnitCanEquipItemOfEquipmentType", unit, 2), false, "unit lacks chest");
  equal(call("UnitInventorySize", unit), 2, "bag size fixture");
  equal(call("BlzUnitExtendedInventorySize", unit), 3, "extended bag size fixture");
  equal(call("BlzUnitHasAnyItemEquipped", unit), false, "empty loadout");
  equal(call("UnitAddItem", unit, head), true, "bag pickup");
  equal(call("BlzIsItemInBag", head), true, "bag flag");
  equal(call("BlzUnitHasItemBagged", unit, head), true, "holder bag flag");
  equal(call("BlzUnitHasItemBagged", other, head), false, "other unit bag flag");
  equal(call("UnitHasItem", unit, head), true, "unit owns item");
  equal(call("UnitItemInSlot", unit, 0), head, "legacy bag lookup");
  equal(call("BlzUnitItemInBagSlot", unit, 0), head, "bag lookup");
  equal(call("BlzUnitEquipItem", unit, head), true, "equip head from bag");
  equal(call("BlzIsItemEquipped", head), true, "equipped flag");
  equal(call("BlzIsItemInBag", head), false, "equipped item leaves bag");
  equal(call("BlzUnitItemInBagSlot", unit, 0), undefined, "bag cleared");
  equal(call("BlzUnitItemInEquipmentSlot", unit, "EQUIPMENT_LOADOUT_SLOT_HEAD"), head, "head slot");
  equal(call("BlzUnitHasItemEquipped", unit, head), true, "unit head flag");
  equal(call("BlzUnitHasItemEquipped", other, head), false, "other unit head flag");
  equal(call("BlzUnitHasAnyItemEquipped", unit), true, "nonempty loadout");
  equal(call("BlzUnitHasLoadoutSlotEmpty", unit, 0), false, "head occupied");
  equal(call("BlzUnitHasLoadoutSlotEmpty", unit, 4), true, "ring empty");
  equal(call("BlzUnitHasItemEquipmentOfType", unit, 1), true, "head type equipped");
  equal(call("BlzUnitHasItemEquipmentOfType", unit, 5), false, "ring type absent");
  equal(call("BlzUnitEquipItem", unit, ring), true, "first ring");
  equal(call("BlzUnitEquipItem", unit, ringAlt), true, "second ring");
  equal(call("BlzUnitItemInEquipmentSlot", unit, 4), ring, "ring slot");
  equal(call("BlzUnitItemInEquipmentSlot", unit, 5), ringAlt, "alternate ring slot");
  equal(call("BlzUnitEquipItem", unit, thirdRing), false, "ring loadout full");
  call("BlzUnitUnequipItem", other, head);
  equal(call("BlzIsItemEquipped", head), true, "wrong unit cannot unequip");
  call("BlzUnitUnequipItem", unit, head);
  equal(call("BlzIsItemEquipped", head), false, "unequipped flag");
  equal(call("BlzUnitHasItemBagged", unit, head), true, "unequip returns to bag");
  equal(call("BlzUnitUnequipItemFromSlot", unit, 4), ring, "unequip by ring slot");
  equal(call("BlzUnitUnequipItemFromSlot", unit, 4), undefined, "empty slot unequip");
  equal(call("BlzUnitItemInEquipmentSlot", unit, 5), ringAlt, "alternate ring retained");
  equal(call("UnitAddItem", other, head), true, "move item between holders");
  equal(call("BlzUnitHasItemBagged", unit, head), false, "old holder cleared");
  equal(call("UnitRemoveItemFromSlot", other, 0), head, "remove from bag slot");
  equal(call("BlzIsItemInBag", head), false, "removed from holder");
  equal(call("UnitAddItem", unit, thirdRing), true, "another bag item");
  call("UnitRemoveItem", unit, thirdRing);
  equal(call("UnitHasItem", unit, thirdRing), false, "remove item from unit");
  call("RemoveItem", ringAlt);
  equal(call("GetItemTypeId", ringAlt), 0, "removed item type");
  equal(call("BlzUnitHasAnyItemEquipped", unit), false, "removal clears equipment");
  equal(call("BlzUnitEquipItem", unit, ringAlt), false, "removed item cannot equip");
  equal(call("ChooseRandomItemExWithFilter", 7, 2, 5, 1), 102, "default random excludes invalid and disabled");
  equal(call("ChooseRandomItemExWithFilterAndIncludes", 7, 2, 5, 1, true, false), 103, "includes invalid morph");
  equal(call("ChooseRandomItemExWithFilterAndIncludes", 7, 2, 5, 1, false, true), 104, "includes nonrandom");
  equal(call("ChooseRandomItemExWithFilterAndIncludes", 7, 2, 5, 1, true, true), 105, "includes both");
  equal(call("ChooseRandomItemExWithFilter", "ITEM_TYPE_EQUIPMENT", 2, "EQUIPMENT_TYPE_HEAD", "ITEMTAG_TYPE_DROPPABLE"), 101, "head random filter");
  equal(call("ChooseRandomItemExWithFilter", 9, 2, 9, 8), 108, "any filters");
  equal(call("ChooseRandomItemExWithFilter", 7, 9, 5, 1), 0, "no candidate");
  call("SetPlayerRaceSkin", 0, "RACE_PREF_ORC");
  equal(inventory.playerRaceSkins.get(0), "RACE_PREF_ORC", "player race skin state");
  equal(call("HeroGlowIsAllowedOnUnit", unit), true, "fixture hero glow");
  call("DisallowHeroGlowOnUnit", unit);
  equal(call("HeroGlowIsAllowedOnUnit", unit), false, "hide hero glow");
  call("AllowHeroGlowOnUnit", unit);
  equal(call("HeroGlowIsAllowedOnUnit", unit), true, "show hero glow");
  equal(call("BlzGetUnitAnimationDuration", unit, "stand"), 2, "fixture named duration");
  equal(call("BlzGetUnitAnimationDurationByIndex", unit, 1), 1, "fixture indexed duration");
  inventory.unit(unit).talents.set("health", 5);
  inventory.unit(unit).talents.set("custom", 7);
  call("BlzResetUnitTalents", unit);
  equal(inventory.unit(unit).talents.get("health"), 0, "reset talent");
  equal(inventory.unit(unit).talents.has("custom"), false, "reset clears spent talents");
  equal(call("BlzUnitHeal", unit, other, 20, false, false), 20, "plain healing");
  equal(call("GetWidgetLife", unit), 60, "healing writes shared life");
  equal(call("BlzUnitHeal", unit, other, 10, false, true), 20, "source healing bonus");
  equal(call("BlzUnitHeal", unit, other, 10, true, true), 20, "item healing capped at maximum");
  equal(call("BlzUnitHeal", unit, other, 10, false, false), 0, "full health no gain");
  call("SetWidgetLife", unit, 0);
  equal(call("BlzUnitHeal", unit, other, 10, false, false), 0, "healing cannot revive dead unit");
  equal(equipEvents, 3, "equip event count");
  equal(unequipEvents, 2, "unequip event count");
  inventory.withInventoryEvent(unit, head, "equip", () => {
    inventory?.withInventoryEvent(unit, ring, "unequip", () => equal(call("BlzGetUnequippedItem"), ring, "nested unequip context"));
    equal(call("BlzGetEquippedItem"), head, "nested context restores equip");
  });
  equal(call("BlzGetEquippedItem"), undefined, "event exit restores outside context");
  let absentDuration = false;
  try { call("BlzGetUnitAnimationDuration", unit, "unknown"); } catch (error) { absentDuration = String(error).includes("fixture missing"); }
  equal(absentDuration, true, "unknown animation explicitly unsupported");
  equal(client.missingNatives.length, 0, "assigned native coverage");
  for (const [name] of declarations.functions) equal(client.log.some(row => row.name === name), true, `${name} exercised`);
  return checks;
}
