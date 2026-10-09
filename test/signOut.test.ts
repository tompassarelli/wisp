
import { expect, test } from "bun:test";
import { hasSavedLogin, withoutSavedLogin } from "../scripts/warcraft/battleNet";

const REG = [
  "WINE REGISTRY Version 2",
  "",
  "[Software\\\\Blizzard Entertainment\\\\Battle.net\\\\Identity] 1790859120",
  "#time=1dc0000",
  "\"Identity\"=hex:01,02,\\",
  "  03,04",
  "",
  "[Software\\\\Blizzard Entertainment\\\\Battle.net\\\\UnifiedAuth] 1791345315",
  "#time=1dc0001",
  "\"C2CE228D\"=hex:00,01,02,\\",
  "  03,04,05,\\",
  "  06",
  "\"Other\"=\"x\"",
  "",
  "[Software\\\\Blizzard Entertainment\\\\Battle.net\\\\UnifiedAuthX] 1",
  "\"Kept\"=\"y\"",
  "",
].join("\n");

test("[native] a sign-out drops only the UnifiedAuth key's values", () => {
  const out = withoutSavedLogin(REG);
  expect(out).not.toContain("C2CE228D");
  expect(out).not.toContain("03,04,05");
  expect(out).not.toContain("\"Other\"");
  expect(out).toContain("[Software\\\\Blizzard Entertainment\\\\Battle.net\\\\UnifiedAuth] 1791345315\n#time=1dc0001\n\n");
  expect(out).toContain("\"Identity\"=hex:01,02,\\\n  03,04");
  expect(out).toContain("\"Kept\"=\"y\"");
  expect(hasSavedLogin(REG)).toBe(true);
  expect(hasSavedLogin(out)).toBe(false);
});
