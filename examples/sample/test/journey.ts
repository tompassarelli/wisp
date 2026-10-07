// The sample's headless journey, declared once for Bun and 32-bit Lua: start,
// `-ping`, a hot reload, another `-ping` and more frames.
import type { Journey } from "wisp/src/headless/journey";

/** What a headless run needs to know about the map: src/main.ts's configureRuntime() prefixes. */
export const SAMPLE_MAP = {
  filePrefix: "sample", globalPrefixes: ["__sample"],
  // The sample's playable rectangle is centered at the origin.
  natives: () => ({ GetRectCenterX: () => 0, GetRectCenterY: () => 0 }),
};

export const SAMPLE_JOURNEY: Journey = {
  frames: 120,
  events: [
    { frame: 30, player: 0, chat: "-ping" },
    { frame: 60, reload: true },
    { frame: 90, player: 1, chat: "-ping" },
  ],
};
