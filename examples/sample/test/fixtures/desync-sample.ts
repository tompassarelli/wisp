// The sample's headless command against the broken fixture in desync.ts.
// Usage: bun examples/sample/test/fixtures/desync-sample.ts headless
// It must exit non-zero: CI expects this run to fail (wisp:docs/ci.md).
import { join } from "node:path";
import { runCli } from "wisp/scripts/wisp/cli";

process.exit(await runCli("bun examples/sample/test/fixtures/desync-sample.ts", {
  headless: {
    usage: "[ping-reload] [--clients N]",
    load: async () => {
      const { makeHeadless } = await import("wisp/scripts/wisp/commands/headless");
      return makeHeadless(async () => {
        const { SAMPLE_JOURNEY, SAMPLE_MAP } = await import("../journey");
        return { map: SAMPLE_MAP, entry: join(import.meta.dir, "desync.ts"), journeys: { "ping-reload": SAMPLE_JOURNEY } };
      });
    },
  },
}, process.argv.slice(2)));
