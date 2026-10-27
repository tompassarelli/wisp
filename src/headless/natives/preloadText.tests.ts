import { assertEquals, test } from "../../runtime/testing";
import { preloadLine } from "./preloadText";

function repeated(unit: string, count: number): string {
  let text = "";
  for (let index = 0; index < count; index++) text += unit;
  return text;
}

test("[native] Preload keeps a line of up to 259 bytes whole and cuts a longer one to its first 259 bytes, as 3.0.0.24268 writes it", () => {
  assertEquals(preloadLine(repeated("x", 258)), repeated("x", 258));
  assertEquals(preloadLine(repeated("x", 259)), repeated("x", 259));
  assertEquals(preloadLine(repeated("x", 260)), repeated("x", 259));
  assertEquals(preloadLine(repeated("x", 2000)), repeated("x", 259));
  const wide = `W:${repeated("é", 200)}`;
  const expected = "é".length === 2 ? wide.slice(0, 259) : `W:${repeated("é", 128)}`;
  assertEquals(preloadLine(wide), expected, "a byte cut inside a character keeps the split byte in Lua and drops the character in Bun");
});
