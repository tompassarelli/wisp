import { expect, test } from "bun:test";
import { createTimer, startTimer } from "../game/native/clock";
import { connectionRoundTripMs, player } from "../game/native/players";
import { bindWorld } from "../game/native/world";
import { FRAME_MS } from "../game/native/frameRate";
import type { Player } from "../game/players";
import { parseNativeDeclarations } from "./declarations";
import { Lockstep, type LockstepLink } from "./lockstep";
import { TurnLedger, type TurnPacket } from "./turnLedger";

const declarations = parseNativeDeclarations(`
declare function CreateTimer(this: void): timer;
`);
const scope = { enter: (client: { readonly world: Parameters<typeof bindWorld>[0] }) => bindWorld(client.world), leave: () => bindWorld(undefined) };

interface Reads {
  readonly frame: number;
  readonly remote: number;
  readonly own: number;
  readonly computer: number;
}

function match(slot: number, humans: readonly number[], read: boolean, link?: LockstepLink) {
  const reads: Reads[] = [];
  let frame = 0;
  const lockstep = new Lockstep({
    declarations, players: [slot], humans, filePrefix: "round-trip", modules: { entry: "map", modules: [] }, scope,
    ...(link === undefined ? {} : { link }),
    entry: () => ({ install: () => {}, start: () => {
      const players: Player[] = [player(0), player(1), player(2)];
      startTimer(createTimer(), FRAME_MS / 1000, true, () => {
        frame++;
        player(frame % 3);
        if (read) reads.push({ frame, remote: connectionRoundTripMs(players[1 - slot]!), own: connectionRoundTripMs(players[slot]!), computer: connectionRoundTripMs(players[2]!) });
      });
    } }),
  });
  lockstep.start({ hostFolder: false });
  return { lockstep, reads };
}

type Wire = { readonly arriveMs: number; readonly to: number } & ({ readonly kind: "turns"; readonly packet: TurnPacket } | { readonly kind: "ping" | "pong"; readonly from: number; readonly atMs: number });

function linkedPair(read: boolean, oneWayMs: number, frames: number) {
  let now = 0;
  const clock = () => now;
  const ledgers = [0, 1].map((slot) => new TurnLedger(slot, [1 - slot], clock));
  for (const ledger of ledgers) ledger.delay = Math.ceil((oneWayMs + 4) / FRAME_MS);
  const sides = [0, 1].map((slot) => match(slot, [0, 1], read, ledgers[slot]));
  const wire: Wire[] = [];
  const lastSent = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const sendTurns = (slot: number) => {
    lastSent[slot] = now;
    wire.push({ arriveMs: now + oneWayMs, to: 1 - slot, kind: "turns", packet: ledgers[slot]!.packet() });
  };
  for (; now < frames * FRAME_MS + 2000 && sides.some(({ lockstep }) => lockstep.frame < frames); now++) {
    for (const item of wire.filter((sent) => sent.arriveMs <= now)) {
      wire.splice(wire.indexOf(item), 1);
      const ledger = ledgers[item.to]!;
      if (item.kind === "turns") ledger.receive(item.packet);
      else if (item.kind === "ping") wire.push({ arriveMs: now + oneWayMs, to: item.from, kind: "pong", from: item.to, atMs: item.atMs });
      else ledger.roundTrips.pong(item.from, item.atMs);
    }
    for (const slot of [0, 1]) {
      const ledger = ledgers[slot]!;
      const ping = ledger.roundTrips.ping();
      if (ping !== undefined) wire.push({ arriveMs: now + oneWayMs, to: 1 - slot, kind: "ping", from: slot, atMs: ping.atMs });
      const { lockstep } = sides[slot]!;
      while (lockstep.frame < Math.min(frames, Math.floor(now / FRAME_MS)) && ledger.ready(lockstep.frame + 1)) {
        lockstep.frames(1);
        sendTurns(slot);
      }
      if (now - (lastSent[slot] ?? 0) >= FRAME_MS / 2) sendTurns(slot);
    }
  }
  return sides.map(({ lockstep, reads }) => ({ frame: lockstep.frame, checksum: lockstep.clients[0]!.checksum(), reads }));
}

test("[integration wisp-connection-ping] over a 120 ms link client 0 reads player 1's round trip as 120 ± 30 ms, -1 for itself, a computer and offline, and the readout leaves the checksum unchanged", () => {
  const frames = 240;
  const [first, second] = linkedPair(true, 60, frames);
  const [quietFirst, quietSecond] = linkedPair(false, 60, frames);
  expect(first!.frame).toBe(frames);
  expect(quietFirst!.frame).toBe(frames);
  const warm = first!.reads.filter(({ frame }) => frame > 60);
  expect(warm.length).toBeGreaterThan(150);
  for (const { remote, own, computer } of warm) {
    expect(Math.abs(remote - 120)).toBeLessThanOrEqual(30);
    expect(own).toBe(-1);
    expect(computer).toBe(-1);
  }
  expect(second!.reads.filter(({ frame }) => frame > 60).every(({ remote }) => Math.abs(remote - 120) <= 30)).toBe(true);
  expect(first!.checksum).toBe(quietFirst!.checksum);
  expect(second!.checksum).toBe(quietSecond!.checksum);
  expect(first!.checksum).toBe(second!.checksum);

  for (const humans of [[0, 1], [0]]) {
    const offline = match(0, humans, true);
    offline.lockstep.frames(30);
    expect(offline.reads.length).toBe(30);
    for (const { remote, own, computer } of offline.reads) expect([remote, own, computer]).toEqual([-1, -1, -1]);
  }
});
