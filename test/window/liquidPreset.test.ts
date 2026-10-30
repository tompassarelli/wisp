import { expect, test } from "bun:test";
import { liquidPreset } from "../../host/window/drawScene";

test("a scene's models pick the liquid the water pass draws", () => {
  expect(liquidPreset(["units\\human\\footman.mdx", "war3mapImported\\StageLava-ab12.mdx"])).toBe("lava");
  expect(liquidPreset(["war3mapImported\\StagePlague.mdx"])).toBe("poison");
  expect(liquidPreset(["war3mapImported\\StageTombWater.mdx"])).toBe("water");
  expect(liquidPreset([])).toBe("water");
});
