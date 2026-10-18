import { expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const pattern = [["defin", "itive"].join(""), ["_de", "\\.", "w3mod"].join("")].join("|");

test("tracked files outside vendor/ and repos/ name no dropped graphics edition or its asset layer [k5 boundary repo-tree]", () => {
  const found = Bun.spawnSync(["git", "grep", "-n", "-i", "-E", "-e", pattern, "--", ".", ":(exclude)vendor/", ":(exclude)repos/"], { cwd: root });
  const lines = found.stdout.toString().trim();
  expect(found.exitCode, lines || found.stderr.toString()).toBe(1);
  expect(lines).toBe("");
});
