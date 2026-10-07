import { join } from "node:path";
import { runCli } from "../../scripts/wisp/cli";
import { makeHeadless } from "../../scripts/wisp/commands/headless";
process.exit(await runCli("coverage", {
  headless: { usage: "[--json]", load: async () => makeHeadless(async () => ({
    map: { filePrefix: "coverage", globalPrefixes: [] }, entry: join(import.meta.dir, "map.ts"),
    journeys: { missing: { frames: 1, events: [] } },
  })) },
}, process.argv.slice(2)));
