// The sample as one client per process for `sample.ts net`: each player types -ping every two seconds, and `--chatter N` adds N chat lines every frame to fill the packets a busy game sends.
import { installHeadless } from "wisp/scripts/wisp/headless";
import type { NetGame } from "wisp/scripts/wisp/net/peer";
import { install, start } from "../src/main";
import { SAMPLE_MAP } from "./journey";

const CHATTER_LINE = "chatter chatter chatter";

export const sampleNet = (chatter: number): NetGame => ({
  create: async (link, slot) => {
    const runtime = installHeadless(SAMPLE_MAP);
    const lockstep = runtime.clients({ start, install }, [slot], { humans: [0, 1], link, keepCalls: 0 });
    const client = lockstep.client(slot);
    return {
      start: () => lockstep.start(),
      step: () => {
        if (lockstep.frame % 120 === 17 + 40 * slot) lockstep.chat(slot, "-ping");
        for (let line = 0; line < chatter; line++) lockstep.chat(slot, CHATTER_LINE);
        lockstep.frames(1);
        if (client.errors.length > 0) throw new Error(client.errors.join("\n"));
      },
      frame: () => lockstep.frame,
      checksum: () => client.checksum(),
      close: () => runtime.restore(),
    };
  },
});

export const SAMPLE_NET: NetGame = sampleNet(0);
