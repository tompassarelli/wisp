import { AbilityObject, UnitObject, abilityData, encodeObjectData } from "wisp/scripts/objectData";
import { SNOW_ID, SNOW_TOOLTIPS, WALKER_ID, WALKER_MODEL, WALKER_NAME } from "../src/objectIds";

export const walker = new UnitObject(WALKER_ID, "hfoo")
  .name(WALKER_NAME).tooltip("A rider walking the sample lap.")
  .model(WALKER_MODEL).scale(1.25).hitPoints(420).movementSpeed(180)
  .abilities([SNOW_ID]).build();
export const snow = new AbilityObject(SNOW_ID, "AHbz").name("Wisp Snow").hero(false).levels(2)
  .tooltip(1, SNOW_TOOLTIPS[0] ?? "").extendedTooltip(1, "Two waves dealing 10 damage.")
  .manaCost(1, 0).cooldown(1, 3).targets(1, ["ground", "enemy"]).blizzardWaves(1, 2).blizzardDamage(1, 10)
  .tooltip(2, SNOW_TOOLTIPS[1] ?? "").extendedTooltip(2, "Four waves dealing 20 damage.")
  .manaCost(2, 0).cooldown(2, 6).targets(2, ["ground", "enemy"]).blizzardWaves(2, 4).blizzardDamage(2, 20).build();

export function sampleObjectData() {
  return [
    { entry: "war3map.w3u", contents: encodeObjectData([walker], false) },
    { entry: "war3map.w3a", contents: abilityData([snow]) },
  ];
}
