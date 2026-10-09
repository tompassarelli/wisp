import { abilityData, encodeObjectData, type Modification, type ObjectDefinition, UnitObject } from "../../scripts/objectData";
import { SHADOW_CONFIGS, SUBJECT_ID } from "./configs";

const field = (id: string, value: number, level = 1, dataColumn = 0): Modification => ({
  field: id, value: { kind: "unreal", value }, level, dataColumn,
});

export function shadowStrikeObjects() {
  const abilities: ObjectDefinition[] = SHADOW_CONFIGS.map(config => ({
    base: "AEsh", id: config.id,
    modifications: [
      { field: "anam", value: { kind: "string", value: `Wisp ${config.name}` } },
      { field: "aher", value: { kind: "int", value: 0 } },
      { field: "alev", value: { kind: "int", value: 1 } },
      { field: "amcs", value: { kind: "int", value: 0 }, level: 1 },
      { field: "atar", value: { kind: "string", value: "ground,enemy,organic" }, level: 1 },
      field("acas", config.cast), field("adur", 6), field("ahdu", 6),
      field("acdn", 0), field("aran", 1000),
      field("Esh1", 10, 1, 1), field("Esh2", 0, 1, 2),
      field("Esh3", 0, 1, 3), field("Esh4", 0, 1, 4), field("Esh5", 40, 1, 5),
    ],
  }));
  const subject = new UnitObject(SUBJECT_ID, "hfoo").name("Wisp strike subject")
    .hitPoints(1000).movementSpeed(0).build();
  const unit: ObjectDefinition = { ...subject, modifications: [
    ...subject.modifications,
    { field: "uaen", value: { kind: "int", value: 0 } },
    { field: "uhpr", value: { kind: "unreal", value: 0 } },
  ] };
  return [
    { entry: "war3map.w3u", contents: encodeObjectData([unit], false) },
    { entry: "war3map.w3a", contents: abilityData(abilities) },
  ];
}
