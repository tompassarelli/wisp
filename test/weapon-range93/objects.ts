import { encodeObjectData, type Modification, type ObjectDefinition } from "../../scripts/objectData";
import { ATTACKER_TYPES, TARGET_TYPE, OLD_RANGE } from "./cases";

const int = (field: string, value: number): Modification => ({ field, value: { kind: "int", value } });
const real = (field: string, value: number): Modification => ({ field, value: { kind: "unreal", value } });
const text = (field: string, value: string): Modification => ({ field, value: { kind: "string", value } });

export function weaponRangeObjects(): Uint8Array {
  const common = [text("unam", "Wisp Range Fixture"), text("umvt", ""), int("umvs", 0), real("ucol", 0), real("uhpr", 0), int("uhpm", 1000), real("uacq", 0), int("udef", 0), int("ufle", 0), text("uabi", "")];
  const weapons: Modification[] = [];
  for (const index of [1, 2]) {
    weapons.push(int(`ua${index}r`, OLD_RANGE), text(`ua${index}w`, "normal"), text(`ua${index}t`, "normal"), text(`ua${index}g`, "ground,enemy"), int(`ua${index}b`, 10), int(`ua${index}d`, 1), int(`ua${index}s`, 1), real(`ua${index}c`, 0.25), real(`udp${index}`, 0), real(`ubs${index}`, 0), real(`urb${index}`, 0));
  }
  const definitions: ObjectDefinition[] = ATTACKER_TYPES.map((id, index) => ({ base: "hfoo", id, modifications: [...common, ...weapons, int("uaen", index + 1)] }));
  definitions.push({ base: "hfoo", id: TARGET_TYPE, modifications: [...common, int("uaen", 0)] });
  return encodeObjectData(definitions, false);
}
