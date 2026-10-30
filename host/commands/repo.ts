import { join } from "node:path";
import { runMainCli } from "./cli";

const root = join(import.meta.dir, "../..");
/** Wisp's own soak for `ci`: the soak test's map with fault-free policies (wisp:host/soak/ci/ciProject.ts). */
const soak = { project: join(root, "host/soak/ci/ciProject.ts"), out: join(root, "build/soak") };

runMainCli("bun wisp", {
  native: { usage: "remote --host HOST --project DIR --map FILE --pads DIR --clients-file FILE --run RUN [--dry-run] -- WISP_ARGS", load: async () => (await import("./nativeRemote")).nativeRemote },
  fidelity: { usage: "check LEVER --reference DIR --candidate DIR   (docs/fidelity.md)", load: async () => (await import("./fidelity")).fidelity },
  net: { usage: "regions   (each relay region with its measured round trip: docs/network-model.md)", load: async () => (await import("./net")).regionsCommand },
  map: { usage: "preview MAP.w3x --out IMAGE.ppm [--packager PATH] [--assets DIR]", load: async () => (await import("./map")).map },
  ci: {
    usage: "pre-merge --base SHA [--plan-only] | post-merge | nightly [--minutes M] | seeds --n N [--seed S]   [--json]   (docs/ci-command.md)",
    load: async () => (await import("./ci")).makeCi({
      root,
      sources: ["host", "src", "test", "examples", "plugins", "native"],
      typeCheck: { command: ["bun", "run", "check"] },
      tests: { files: ["test/**/*.test.ts", "src/**/*.test.ts", "examples/**/*.test.ts"], preload: ["test/lua32.preload.ts"] },
      soak,
    }),
  },
  repro: {
    usage: "FILE [--shrink] [--test NAME]   (a ci soak repro: docs/repro.md)",
    load: async () => (await import("./repro")).makeRepro(async () => ({
      map: (await import("../soak/ci/ciProject")).default.map,
      replay: join(root, "test/fixtures/repro/replay.ts"),
      tests: join(root, "test/repros"),
      soak: { project: soak.project, tests: join(root, "test/repros") },
    })),
  },
  farm: { usage: "test [--ref REF] [--wait]   (the full suites on GitHub's free runners: docs/farm.md)", load: async () => (await import("./farm")).farm },
  render: { usage: "compare --reference BACKEND --candidate BACKEND --scenes FILE --out DIR   (the render bound from Chrome's two ANGLE backends: docs/render-compare.md)", load: async () => (await import("./render")).renderCommand },
  window: {
    usage: "probe [--baseline] [--frames N] [--out DIR]   (the native window's seam and pacing: docs/native-window-plan.md)",
    load: async () => (await import("./window")).makeWindow(join(root, "examples/sample/scripts/standalone.ts")),
  },
  headless: {
    usage: "audio-acceptance [--sound-cues FILE] [--json]   (map sound/music calls: docs/audio.md)",
    load: async () => (await import("./headless")).makeHeadless(async () => ({
      map: { filePrefix: "audio80", globalPrefixes: [] },
      entry: new URL("../../test/audio80/main.ts", import.meta.url).pathname,
      journeys: { "audio-acceptance": { frames: 48, events: [] } },
    })),
  },
}, process.argv.slice(2));
