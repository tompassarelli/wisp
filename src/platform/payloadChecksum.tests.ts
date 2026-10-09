import { floorMod } from "../sim/intMath";
import { checksum } from "../runtime/payload";
import { assertEquals, test } from "../runtime/testing";
import { stringChecksum } from "./payloadChecksum";


test("[invariant] payload: a Lua string's checksum equals checksum() of its bytes", () => {
  for (const length of [0, 1, 7, 8, 9, 15, 16, 17, 4096, 4099]) {
    const bytes = Array.from({ length }, (_, i) => floorMod(i * 167 + 255, 256));
    let text = "";
    for (let start = 0; start < length; start += 256) text += string.char(...bytes.slice(start, start + 256));
    assertEquals(stringChecksum(text), checksum(bytes.length, (index) => bytes[index] ?? 0), `length ${length}`);
  }
  const reference = Array.from({ length: 4096 }, (_, i) => floorMod(i * 167 + 255, 256));
  let referenceText = "";
  for (let start = 0; start < reference.length; start += 256) referenceText += string.char(...reference.slice(start, start + 256));
  assertEquals(stringChecksum(referenceText), "144609:7323593");
});
