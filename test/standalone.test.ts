import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHeadless } from "../scripts/wisp/headless";
import { openStandalone, type StandaloneGame, type StandaloneOptions } from "../scripts/wisp/standalone";

test("standalone records scripted checksums and skips live or explicitly disabled checksums", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wisp-checksums-"));
  try {
    const script = join(directory, "input.pad");
    await Bun.write(script, "script fixture");
    const cases: readonly [StandaloneOptions, number][] = [[{}, 0], [{ script }, 3], [{ script, recordChecksums: false }, 0]];
    for (const [index, [options, expected]] of cases.entries()) {
      let checksumCalls = 0;
      const runtime = installHeadless({ filePrefix: "checksum-fixture", globalPrefixes: [] });
      const clients = runtime.clients({ install() {}, start() {} }, [0]);
      clients.start();
      const game: StandaloneGame = {
        title: "Checksum fixture", render: { readAsset: async () => undefined },
        create: async () => ({
          client: clients.client(0), step: () => clients.frames(1),
          checksum: () => { checksumCalls++; return "fixture"; }, close: () => runtime.restore(),
        }),
      };
      const out = join(directory, String(index));
      const player = await openStandalone(game, { ...options, out });
      try {
        for (let frame = 0; frame < 3; frame++) {
          const response = await fetch(`${player.url}frame`, { method: "POST", body: JSON.stringify({ buttons: [], axisX: 0, axisY: 0 }) });
          expect(response.ok).toBe(true);
          expect((await response.json()).checksum).toBe(expected === 0 ? undefined : "fixture");
        }
        await fetch(`${player.url}complete`, { method: "POST", body: "{}" });
        await player.completed;
        expect(checksumCalls).toBe(expected);
        const rows = Bun.file(join(out, "checksums.jsonl"));
        expect(await rows.exists()).toBe(expected !== 0);
        if (expected !== 0) expect((await rows.text()).trim().split("\n")).toHaveLength(expected);
      } finally { await player.close(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
