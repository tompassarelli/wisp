import { expect, test } from "bun:test";
import { baseMapEntryNames } from "../host/compile/mapBuild";

test("[property seed 85] archive replacement preserves unrelated entries and removes every case alias", () => {
  expect(baseMapEntryNames("war3mapMap.blp\nwar3map.w3i\nwar3map.mmp\n", [
    { entry: "war3mapmap.blp", source: "lineup.blp" },
    { entry: "war3map.w3i", source: "generated-info" },
  ])).toEqual(["war3map.mmp"]);
  let seed = 85;
  for (let count = 1; count <= 32; count++) {
    const list: string[] = [], kept: string[] = [], replacements: { entry: string; source: string }[] = [];
    for (let index = 0; index < count; index++) {
      const entry = `Import-${index}.mdx`;
      list.push(entry);
      seed = Math.imul(seed, 1664525) + 1013904223;
      if ((seed & 4) === 0) kept.push(entry);
      else replacements.push({ entry: entry.toUpperCase(), source: "authored" });
    }
    const actual = baseMapEntryNames(list.join("\r\n"), replacements);
    expect(actual).toEqual(kept);
    expect(baseMapEntryNames(actual.join("\n"), replacements)).toEqual(actual);
  }
});
