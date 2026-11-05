// Two one-client processes of the sample, simulated in one: each runs its own
// slot behind a TurnLedger, and their packets cross a seeded network that
// delays, drops and reorders them (wisp:docs/network-model.md).
import { afterAll, expect, test } from "bun:test";
import { installHeadless } from "wisp/scripts/wisp/headless";
import { Random } from "wisp/src/headless/random";
import { TurnLedger, type TurnPacket } from "wisp/src/headless/turnLedger";
import { install, start } from "../src/main";
import { SAMPLE_MAP } from "./journey";

const headless = installHeadless(SAMPLE_MAP);
afterAll(headless.restore);

function play(options: { readonly seed: number; readonly frames: number; readonly delay: number; readonly latencyMs: number; readonly loss: number; readonly unsynced?: number; readonly humans?: number }) {
  const random = new Random(options.seed);
  let now = 0;
  const clock = () => now;
  const members = Array.from({ length: options.humans ?? 2 }, (_, slot) => slot);
  const peers = members.map((slot) => {
    const ledger = new TurnLedger(slot, members.filter((other) => other !== slot), clock);
    ledger.delay = options.delay;
    const lockstep = headless.clients({ start, install }, [slot], { humans: members, link: ledger, keepCalls: 0 });
    return { slot, ledger, lockstep, stalls: 0 };
  });
  const wire: { at: number; to: number; packet: TurnPacket }[] = [];
  for (const peer of peers) peer.lockstep.start();
  for (let tick = 1; tick <= options.frames * 4; tick++) {
    now = tick * (1000 / 60) / 2;
    for (let index = wire.length - 1; index >= 0; index--) {
      const sent = wire[index];
      if (sent === undefined || sent.at > now) continue;
      wire.splice(index, 1);
      peers[sent.to]?.ledger.receive(sent.packet);
    }
    for (const peer of peers) {
      const packet = peer.ledger.packet();
      for (const to of members) if (to !== peer.slot && !random.chance(options.loss)) wire.push({ at: now + options.latencyMs * (0.5 + random.next()), to, packet });
      const frame = peer.lockstep.frame + 1;
      if (frame > options.frames || frame * (1000 / 60) > now) continue;
      if (!peer.ledger.ready(frame)) {
        peer.stalls++;
        continue;
      }
      if (frame % 50 === 7 + 20 * peer.slot) peer.lockstep.chat(peer.slot, "-ping");
      if (frame === options.unsynced && peer.slot === 0) peer.lockstep.clients[0]?.chat(0, "-ping");
      peer.lockstep.frames(1);
      const client = peer.lockstep.clients[0];
      if (frame % 60 === 0 && client !== undefined) peer.ledger.check(frame, client.checksum());
    }
  }
  return peers;
}

test("[scenario] four one-client processes agree on every checksum through a lossy, reordering network, each frame running every slot's events in slot order", () => {
  const peers = play({ seed: 11, frames: 600, delay: 5, latencyMs: 60, loss: 0.05, humans: 4 });
  for (const peer of peers) {
    expect(peer.lockstep.frame).toBe(600);
    expect(peer.lockstep.clients[0]?.errors).toEqual([]);
    expect(peer.ledger.mismatch).toBeUndefined();
    expect(peer.ledger.compared).toBeGreaterThanOrEqual(27);
    expect(peer.lockstep.clients[0]?.messages.filter((line) => line.startsWith("ping"))).toHaveLength(24);
  }
});

test("[fault] a ping only one of four clients sees trips the checksum comparison at the next checkpoint on the other three", () => {
  const peers = play({ seed: 3, frames: 180, delay: 2, latencyMs: 10, loss: 0, unsynced: 70, humans: 4 });
  for (const peer of peers) expect(peer.ledger.mismatch?.frame).toBe(120);
});
