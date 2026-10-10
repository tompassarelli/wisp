import { expect, test } from "bun:test";
import { plan } from "../scripts/wisp/farmShards";

test("[invariant] the shard plan leaves out vendored repositories' tests, which bunfig.toml ignores", () => {
  const planned = plan(["test/a.test.ts", "repos/effect/packages/effect/test/Array.test.ts", "test/b.test.ts"], { bun: {}, lua: {} }, 4, 0);
  expect(planned.bun.flat().sort()).toEqual(["test/a.test.ts", "test/b.test.ts"]);
  expect(planned.bun.every((shard) => shard.length > 0)).toBe(true);
});
