import type { AbilityObjectFixtures } from "../../src/headless/warcraft3Abilities";
import { SHADOW_CONFIGS, SUBJECT_ID } from "./configs";

const abilityObjects: Record<number, AbilityObjectFixtures[number]> = {};
for (const config of SHADOW_CONFIGS) abilityObjects[config.id] = {
  base: "AEsh", impactDelay: 0.515625,
  realLevelFields: { acas: [config.cast], adur: [6], ahdu: [6], aran: [1000], Esh1: [10], Esh2: [0], Esh3: [0], Esh4: [0], Esh5: [40] },
};

export const SHADOW_HEADLESS = {
  filePrefix: "shadow-strike94", globalPrefixes: ["__shadowStrike94"], abilityObjects,
  unitStates: { [SUBJECT_ID]: { life: 1000, maxLife: 1000, mana: 0, maxMana: 0 } },
};
