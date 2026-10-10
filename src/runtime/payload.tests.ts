import { floorMod } from "../sim/intMath";
import { checksum } from "./payload";
import { assertEquals, test } from "./testing";

test("[reference] payload: checksum is exact in 32-bit integers", () => {
  const bytes = Array.from({ length: 4096 }, (_, i) => floorMod(i * 167 + 255, 256));
  assertEquals(checksum(bytes.length, (index) => bytes[index] ?? 0), "144609:7323593");
});
