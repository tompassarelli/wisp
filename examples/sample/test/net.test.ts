// Two one-client processes of the sample, simulated in one: each runs its own
// slot behind a TurnLedger, and their packets cross a seeded network that
// delays, drops and reorders them (wisp:docs/network-model.md).
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";
import { farmTest } from "wisp/scripts/wisp/farmTest";
import { installHeadless } from "wisp/scripts/wisp/headless";
import { Random } from "wisp/src/headless/random";
import { TurnLedger, type TurnPacket } from "wisp/src/headless/turnLedger";
import { install, start } from "../src/main";
import { SAMPLE_MAP } from "./journey";

const headless = installHeadless(SAMPLE_MAP);
afterAll(headless.restore);

function play(options: { readonly seed: number; readonly frames: number; readonly delay: number; readonly latencyMs: number; readonly loss: number; readonly unsynced?: number }) {
  const random = new Random(options.seed);
  let now = 0;
  const clock = () => now;
  const peers = [0, 1].map((slot) => {
    const ledger = new TurnLedger(slot, 1 - slot, clock);
    ledger.delay = options.delay;
    const lockstep = headless.clients({ start, install }, [slot], { humans: [0, 1], link: ledger, keepCalls: 0 });
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
      if (!random.chance(options.loss)) wire.push({ at: now + options.latencyMs * (0.5 + random.next()), to: 1 - peer.slot, packet: peer.ledger.packet() });
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

test("two one-client processes agree on every checksum through a lossy, reordering network [scenario]", () => {
  const peers = play({ seed: 3, frames: 600, delay: 5, latencyMs: 60, loss: 0.05 });
  for (const peer of peers) {
    expect(peer.lockstep.frame).toBe(600);
    expect(peer.lockstep.clients[0]?.errors).toEqual([]);
    expect(peer.ledger.mismatch).toBeUndefined();
    expect(peer.ledger.compared).toBeGreaterThanOrEqual(9);
    expect(peer.lockstep.clients[0]?.messages.filter((line) => line.startsWith("ping"))).toHaveLength(24);
  }
});

test("a ping only one client sees trips the checksum comparison at the next checkpoint [fault]", () => {
  const peers = play({ seed: 3, frames: 180, delay: 2, latencyMs: 10, loss: 0, unsynced: 70 });
  for (const peer of peers) expect(peer.ledger.mismatch?.frame).toBe(120);
});

farmTest("two sample processes play over UDP through the delay and loss proxy with equal checksums [integration]", () => {
  const run = Bun.spawnSync(["bun", join(import.meta.dir, "../scripts/sample.ts"), "net", "pair", "--frames", "240", "--rtt", "60", "--loss", "0.05"], { stdout: "pipe", stderr: "pipe" });
  const lines = run.stdout.toString().trim().split("\n");
  expect({ code: run.exitCode, lines: lines.length, stderr: run.exitCode === 0 ? "" : run.stderr.toString() }).toEqual({ code: 0, lines: 2, stderr: "" });
  for (const line of lines) expect(line).toMatch(/^(host|join): 240 frames, delay 3 .* [34] checksums compared, 0 mismatches/);
}, 60000);
