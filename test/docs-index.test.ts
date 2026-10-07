import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const commandsDir = join(root, "scripts/wisp/commands");
const commandNames = async () => (await readdir(commandsDir)).filter((file) => file.endsWith(".ts")).map((file) => file.slice(0, -3));

// A command isn't done until the feature index lists it: future agents and
// map authors find Wisp's commands there, not by reading scripts/wisp/commands/.
test("every command in scripts/wisp/commands has an entry in docs/index.md", async () => {
  const index = await Bun.file(join(root, "docs/index.md")).text();
  const commands = await commandNames();
  expect(commands.length).toBeGreaterThan(0);
  const unlisted = commands.filter((name) => !index.includes(`\`wisp ${name}`) && !index.includes(`scripts/wisp/commands/${name}.ts`));
  expect(unlisted, "add a row to docs/index.md naming `wisp NAME` or linking scripts/wisp/commands/NAME.ts, with a how-it-works page").toEqual([]);
});

// A command with its own page (docs/NAME.md) documents every subcommand its
// dispatch accepts there, as `wisp NAME SUB` or within `wisp NAME a|SUB|b`.
test("every subcommand of a command with its own page appears on that page", async () => {
  const unlisted: string[] = [];
  let checked = 0;
  for (const name of await commandNames()) {
    const page = join(root, "docs", `${name}.md`);
    if (!existsSync(page)) continue;
    const source = await Bun.file(join(commandsDir, `${name}.ts`)).text();
    const text = await Bun.file(page).text();
    for (const [, sub] of source.matchAll(/case "([a-z][\w-]*)":/g)) {
      checked++;
      if (!new RegExp(`wisp ${name} ([\\w-]+\\|)*${sub}(?![\\w-])`).test(text)) unlisted.push(`wisp ${name} ${sub}`);
    }
  }
  // Guards the pattern: engine's dispatch alone has five subcommands.
  expect(checked).toBeGreaterThanOrEqual(5);
  expect(unlisted, "document each subcommand on its command's page in docs/").toEqual([]);
});
