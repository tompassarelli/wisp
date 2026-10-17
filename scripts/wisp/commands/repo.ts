import { join } from "node:path";
import { runMainCli } from "../cli/cli";

const root = join(import.meta.dir, "../../..");
/** Wisp's own soak for `ci`: the soak test's map with fault-free policies (wisp:test/soak/ci-project.ts). */
const soak = { project: join(root, "test/soak/ci-project.ts"), out: join(root, "build/soak") };

runMainCli("bun wisp", {
  native: { usage: "remote --host HOST --project DIR --map FILE --pads DIR --clients-file FILE --run RUN [--dry-run] -- WISP_ARGS", load: async () => (await import("./nativeRemote")).nativeRemote },
  fidelity: { usage: "check LEVER --reference DIR --candidate DIR   (docs/fidelity.md)", load: async () => (await import("./fidelity")).fidelity },
  map: { usage: "preview MAP.w3x --out IMAGE.ppm [--packager PATH] [--assets DIR]", load: async () => (await import("./map")).map },
  ci: {
    usage: "pre-merge --base SHA [--plan-only] | post-merge | nightly [--minutes M] | seeds --n N [--seed S]   [--json]   (docs/ci-command.md)",
    load: async () => (await import("./ci")).makeCi({
      root,
      sources: ["scripts", "src", "test", "examples", "plugins", "native"],
      typeCheck: { command: ["bun", "run", "check"] },
      tests: { files: ["test/**/*.test.ts", "src/**/*.test.ts", "examples/**/*.test.ts"], preload: ["test/lua32.preload.ts"] },
      soak,
    }),
  },
  repro: {
    usage: "FILE [--shrink] [--test NAME]   (a ci soak repro: docs/repro.md)",
    load: async () => (await import("./repro")).makeRepro(async () => ({
      map: (await import("../../../test/soak/ci-project")).default.map,
      replay: join(root, "test/fixtures/repro/replay.ts"),
      tests: join(root, "test/repros"),
      soak: { project: soak.project, tests: join(root, "test/repros") },
    })),
  },
  farm: { usage: "test [--ref REF] [--wait]   (the full suites on GitHub's free runners: docs/farm.md)", load: async () => (await import("./farm")).farm },
  headless: {
    usage: "audio-acceptance [--sound-cues FILE] [--json]   (map sound/music calls: docs/audio.md)",
    load: async () => (await import("./headless")).makeHeadless(async () => ({
      map: { filePrefix: "audio80", globalPrefixes: [] },
      entry: new URL("../../../test/audio80/main.ts", import.meta.url).pathname,
      journeys: { "audio-acceptance": { frames: 48, events: [] } },
    })),
  },
}, process.argv.slice(2));
