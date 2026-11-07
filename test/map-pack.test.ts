import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { ensurePackager } from "../host/compile/mapBuild";

const build = join(import.meta.dir, "../build");
mkdirSync(build, { recursive: true });
const work = mkdtempSync(join(build, "map-pack-"));

// nix reports its downloads on stderr, so realise gcc first and assert only on gcc's own diagnostics.






test("[invariant] replacing listed entries leaves no stale bytes: the archive is as large as one created with the final entries", async () => {
  const packager = join(work, "map-pack");
  await Effect.runPromise(ensurePackager(packager));
  const noise = (seed: string) => {
    const blocks = [new Bun.CryptoHasher("sha256").update(seed).digest()];
    while (blocks.length < 1024) blocks.push(new Bun.CryptoHasher("sha256").update(blocks.at(-1)!).digest());
    const source = join(work, `noise-${seed}`);
    writeFileSync(source, Buffer.concat(blocks));
    return source;
  };
  const list = (path: string, rows: readonly (readonly [string, string])[]) => {
    writeFileSync(path, rows.map(([source, entry]) => `${source}\t${entry}\n`).join(""));
    return path;
  };
  const first = [[noise("a"), "war3mapImported\\a.mdx"], [noise("b"), "war3mapImported\\b.mdx"], [noise("c"), "war3mapImported\\c.mdx"]] as const;
  const final = [first[0], [noise("b2"), "war3mapImported\\b.mdx"], first[2]] as const;
  const replaced = join(work, "replaced.mpq");
  const created = join(work, "created.mpq");
  for (const [archive, command, rows] of [[replaced, "create", first], [replaced, "replace-list", [final[1]]], [created, "create", final]] as const) {
    const run = Bun.spawnSync([packager, command, archive, list(join(work, "noise.list"), rows)]);
    expect({ code: run.exitCode, stderr: run.stderr.toString() }).toEqual({ code: 0, stderr: "" });
  }
  expect(statSync(replaced).size).toBe(statSync(created).size);
  const extracted = join(work, "noise-b2.out");
  expect(Bun.spawnSync([packager, "extract", replaced, extracted, "war3mapImported\\b.mdx"]).exitCode).toBe(0);
  expect(readFileSync(extracted)).toEqual(readFileSync(final[1][0]));
});
