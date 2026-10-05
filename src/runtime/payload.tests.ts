import { floorMod } from "../sim/intMath";
import { checksum } from "./payload";
import { assertEquals, test } from "./testing";

// Bun and 32-bit Lua must agree, or every hot reload is refused as a mismatch.
// The expected value comes from an exact BigInt evaluation; this input drives
// both lanes within 0.05% of their modulus.
test("payload: checksum is exact in 32-bit integers", () => {
  const bytes = Array.from({ length: 4096 }, (_, i) => floorMod(i * 167 + 255, 256));
  assertEquals(checksum(bytes.length, (index) => bytes[index] ?? 0), "144609:7323593");
});
