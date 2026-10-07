import type { NativeDeclarations } from "../../src/headless/declarations";
import { WARCRAFT3_NATIVES } from "../../src/headless/warcraft3Natives";
import { coreFixture } from "./fixture";
import { inventoryFixture, INVENTORY_TESTED_NAMES } from "../warcraft3-inventory/fixture";
import { sceneryFixture } from "../warcraft3-scenery/fixture";
import { HeadlessClient } from "../../src/headless/client";

export function allWarcraft3Fixtures(declarations: NativeDeclarations): number {
  const tested = new Set<string>();
  coreFixture(declarations, tested);
  sceneryFixture(declarations, tested);
  inventoryFixture(declarations);
  for (const name of INVENTORY_TESTED_NAMES) tested.add(name);
  const missing = WARCRAFT3_NATIVES.filter(name => !tested.has(name));
  if (missing.length > 0) throw new Error(`Warcraft 3 natives without a fixture: ${missing.join(", ")}`);
  const client = new HeadlessClient({ declarations, slot: 0, humans: [0], filePrefix: "integrated3", network: [], localNatives: {}, screenWidth: 1920,
    unitStates: { 11: { life: 40, maxLife: 100, mana: 0, maxMana: 0 } },
    inventory: { items: { 12: { itemType: 7, level: 1, equipmentType: 1, tag: 0, validMorph: true, pickRandom: true } }, units: { 11: { bagSize: 2, inventorySize: 2, extendedInventorySize: 2, loadout: { 1: [0] }, talents: { ability: 0 } } } },
    scenery: { hudScale: 1, cinematics: { "fixture.mdx": [1] } },
  });
  const call = (name: string, ...args: unknown[]) => (client.natives[name] as (this: void, ...args: unknown[]) => unknown)(...args);
  const unit = call("CreateUnit", 0, 11, 0, 0, 0);
  const item = call("CreateItem", 12, 0, 0);
  if (call("UnitAddItem", unit, item) !== true || call("BlzUnitEquipItem", unit, item) !== true || call("BlzUnitItemInEquipmentSlot", unit, 0) !== item) throw new Error("default client inventory integration failed");
  if (call("BlzUnitHeal", unit, unit, 15, false, false) !== 15 || call("GetWidgetLife", unit) !== 55) throw new Error("default client healing integration failed");
  call("BlzResetUnitTalents", unit);
  call("BlzSetCameraAllowsHotkeyTargetLock", true);
  call("SetCameraTargetController", unit, 0, 0, false);
  if (call("BlzGetCameraAllowsHotkeyTargetLock") !== false) throw new Error("old camera controller did not disable hotkey lock");
  call("BlzPlayModelCinematicGameAtPosition", "fixture.mdx", 0, 0, 0, 0);
  client.step();
  const remaining = call("BlzGetModelCinematicGameRemainingTime");
  if (typeof remaining !== "number" || remaining >= 1 || remaining <= 0 || call("BlzGetHUDScale") !== 1) throw new Error("default client scenery clock integration failed");
  if (client.missingNatives.length !== 0) throw new Error("default client reports an unmodelled integration call");
  return WARCRAFT3_NATIVES.length;
}
