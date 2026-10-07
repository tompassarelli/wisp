import { AbilityObject, UnitObject } from "../../scripts/objectData";
const unit = new UnitObject(0x75303031, "hfoo");
const ability = new AbilityObject(0x41303031, "AHbz").levels(2);
// @ts-expect-error name takes text
unit.name(12);
// @ts-expect-error model takes a path
unit.model(false);
// @ts-expect-error hit points take a number
unit.hitPoints("420");
// @ts-expect-error cooldown takes a number
ability.cooldown(1, "three");
// @ts-expect-error targets are supported target words
ability.targets(1, ["something"]);
// @ts-expect-error data damage takes a number
ability.blizzardDamage(2, false);
