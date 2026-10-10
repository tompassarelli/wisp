import { runMainCli } from "./cli";

runMainCli("bun wisp", {
  native: { usage: "remote --host HOST --project DIR --map FILE --pads DIR --clients-file FILE --run RUN [--dry-run] -- WISP_ARGS", load: async () => (await import("./commands/nativeRemote")).nativeRemote },
  fidelity: { usage: "check LEVER --reference DIR --candidate DIR   (docs/fidelity.md)", load: async () => (await import("./commands/fidelity")).fidelity },
  map: { usage: "preview MAP.w3x --out IMAGE.ppm [--packager PATH] [--assets DIR]", load: async () => (await import("./commands/map")).map },
  farm: { usage: "test [--ref REF] [--wait]   (the full suites on GitHub's free runners: docs/farm.md)", load: async () => (await import("./commands/farm")).farm },
  headless: {
    usage: "audio-acceptance [--sound-cues FILE] [--json]   (map sound/music calls: docs/audio.md)",
    load: async () => (await import("./commands/headless")).makeHeadless(async () => ({
      map: { filePrefix: "audio80", globalPrefixes: [] },
      entry: new URL("../../test/audio80/main.ts", import.meta.url).pathname,
      journeys: { "audio-acceptance": { frames: 48, events: [] } },
    })),
  },
}, process.argv.slice(2));
