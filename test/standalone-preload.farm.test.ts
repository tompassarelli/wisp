import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { installHeadless } from "../scripts/wisp/headless";
import { runStandalone } from "../scripts/wisp/standalone";
import { farmTest } from "../scripts/wisp/farmTest";

farmTest("[invariant] hidden pooled scenery does not load an unused missing model before the first standalone frame", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wisp-preload-"));
  const runtime = installHeadless({ filePrefix: "preload-fixture", globalPrefixes: [] });
  const reads: string[] = [];
  try {
    const clients = runtime.clients({ install() {}, start() {
      const hidden = AddSpecialEffect("unused-stage.mdx", 0, 0);
      BlzSetSpecialEffectAlpha(hidden, 0);
      AddSpecialEffect("parked-stage.mdx", 100000, 100000);
    } }, [0]);
    clients.start();
    await Effect.runPromise(runStandalone({
      title: "Preload fixture", render: { width: 64, height: 64, readAsset: async (path) => { reads.push(path); return undefined; } },
      create: async () => ({ client: clients.client(0), step: () => clients.frames(1), checksum: () => "fixture", close() {} }),
    }, { headless: true, frames: 1, out: directory }));
    const result = await Bun.file(join(directory, "standalone.json")).json();
    expect(result.frames).toBe(1);
    expect(result.prepared.models).toBe(0);
    expect(reads).toEqual([]);
  } finally { runtime.restore(); await rm(directory, { recursive: true, force: true }); }
}, 30_000);
