import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { cleanRoom, WISP_POLICY } from "../scripts/cleanRoom";

const repo = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "clean-room-"));
  for (const [path, contents] of Object.entries(files)) writeFileSync(join(root, path), contents);
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  Bun.spawnSync(["git", "add", ...Object.keys(files)], { cwd: root });
  return root;
};
const declarations = (count: number) => Array.from({ length: count }, (_, n) => `native Native${n} takes nothing returns nothing`).join("\n");

test("[spec docs/clean-room.md] a committed .blp, a copied common.j and a stock-path entry in Wisp are refused; allowlisted own files pass", async () => {
  const root = repo({
    "Footman.blp": "BLP1....",
    "hidden.dat": "MDLX....",
    "notes.mdx": "# Markdown with JSX",
    "common.txt": declarations(21),
    "few.txt": declarations(20),
    "tone.ogg": "OggS",
    "clean-room-allowlist.tsv": "tone.ogg\tgenerated\tffmpeg sine\nnotes.mdx\tstock-path\tpath\n",
  });
  try {
    const problems = await Effect.runPromise(cleanRoom(root, WISP_POLICY));
    expect(problems.map((problem) => problem.split(/ (is|has|names) /)[0])).toEqual([
      "clean-room-allowlist.tsv: notes.mdx",
      "clean room: Footman.blp",
      "clean room: hidden.dat",
      "clean room: common.txt",
    ]);
    expect(problems[1]).toContain("wisp:docs/clean-room.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
