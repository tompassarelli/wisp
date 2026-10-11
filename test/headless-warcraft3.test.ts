import { expect, test } from "bun:test";
import { join } from "node:path";
import { parseNativeDeclarations } from "../src/headless/declarations";
import { allWarcraft3Fixtures } from "./warcraft3-core/all";

test("every 3.0 and 3.0.1 added native has an executed Bun fixture and no unmodelled calls", async () => {
  allWarcraft3Fixtures(parseNativeDeclarations(await Bun.file(join(import.meta.dir, "../src/natives/warcraft.d.ts")).text()));
});
