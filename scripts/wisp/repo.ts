// Wisp's own commands, for work on this repository.
// Usage (from the Wisp checkout): bun wisp COMMAND [ARGUMENTS]
import { runCli } from "./cli";

process.exit(await runCli("bun wisp", {
  farm: { usage: "test [--ref REF] [--wait]   (the full suites on GitHub's free runners: docs/farm.md)", load: async () => (await import("./commands/farm")).farm },
  headless: {
    usage: "audio-acceptance [--sound-cues FILE] [--json]   (map sound/music calls: docs/audio.md)",
    load: async () => (await import("./commands/headless")).makeHeadless(async () => ({
      map: { filePrefix: "audio80", globalPrefixes: [] },
      entry: new URL("../../test/audio80/main.ts", import.meta.url).pathname,
      journeys: { "audio-acceptance": { frames: 48, events: [] } },
    })),
  },
}, process.argv.slice(2)));
