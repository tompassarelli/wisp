// The sample as a standalone game (wisp:docs/play.md): its TypeScript in one simulated client, shown by the player's window.
import { installHeadless } from "wisp/scripts/wisp/headless";
import type { StandaloneGame } from "wisp/scripts/wisp/standalone";
import { install, start } from "../src/main";
import { WALKER_ID, WALKER_MODEL } from "../src/objectIds";
import { SAMPLE_MAP } from "../test/journey";

export const sampleGame: StandaloneGame = {
  title: "Wisp Sample",
  render: { readAsset: async () => undefined, unitModels: { [WALKER_ID]: WALKER_MODEL }, preloadModels: [WALKER_MODEL] },
  create: async () => {
    const runtime = installHeadless(SAMPLE_MAP);
    const clients = runtime.clients({ start, install }, [0]);
    clients.start();
    const client = clients.client(0);
    return { client, step: () => clients.frames(1), checksum: () => client.checksum(), close: () => runtime.restore() };
  },
};
