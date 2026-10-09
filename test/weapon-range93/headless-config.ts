import type { LuaHeadlessMap } from "../../src/headless/lua";
import { ATTACKER_TYPES, TARGET_TYPE } from "./cases";

const state = { life: 1000, maxLife: 1000, mana: 0, maxMana: 0 };

export const weaponRangeHeadless: LuaHeadlessMap = {
  filePrefix: "weapon-range93",
  unitStates: {
    [ATTACKER_TYPES[0]]: state,
    [ATTACKER_TYPES[1]]: state,
    [TARGET_TYPE]: state,
  },
};
