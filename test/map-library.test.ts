import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { GameFiles } from "../scripts/wisp/gameFiles";

test("installing a test map preserves other tests and the owner's playable map", async () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-map-library-"));
  try {
    const folder = join(root, "Maps/00-Game");
    mkdirSync(join(folder, "tests"), { recursive: true });
    writeFileSync(join(folder, "Latest.w3x"), "playable");
    writeFileSync(join(folder, "tests/First.w3x"), "first test");
    const candidate = join(root, "Second.w3x");
    writeFileSync(candidate, "second test");
    await Effect.runPromise(GameFiles.use((files) => files.installMap(root, candidate)).pipe(Effect.provide(GameFiles.layer({ mapFolder: "Maps/00-Game/tests", replacedMaps: "Maps/00-Game/tests", preserveMaps: true }))));
    expect(readFileSync(join(folder, "Latest.w3x"), "utf8")).toBe("playable");
    expect(readFileSync(join(folder, "tests/First.w3x"), "utf8")).toBe("first test");
    expect(readFileSync(join(folder, "tests/Second.w3x"), "utf8")).toBe("second test");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
