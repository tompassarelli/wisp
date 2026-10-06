import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

// A command isn't done until the feature index lists it: future agents and
// map authors find Wisp's commands there, not by reading scripts/wisp/commands/.
test("every command in scripts/wisp/commands has an entry in docs/index.md", async () => {
  const root = join(import.meta.dir, "..");
  const index = await Bun.file(join(root, "docs/index.md")).text();
  const commands = (await readdir(join(root, "scripts/wisp/commands"))).filter((file) => file.endsWith(".ts")).map((file) => file.slice(0, -3));
  expect(commands.length).toBeGreaterThan(0);
  const unlisted = commands.filter((name) => !index.includes(`\`wisp ${name}`) && !index.includes(`scripts/wisp/commands/${name}.ts`));
  expect(unlisted, "add a row to docs/index.md naming `wisp NAME` or linking scripts/wisp/commands/NAME.ts, with a how-it-works page").toEqual([]);
});
