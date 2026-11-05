import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { LinkEvent } from "../src/headless/linkEvent";
import type { TurnPacket } from "../src/headless/turnLedger";
import { relayBinary } from "./headless/relayBinary";
import { MAX_DATAGRAM, fitTurns } from "../host/net/wire";

const root = join(import.meta.dir, "..");

const events: readonly LinkEvent[] = [
  { sender: 1, kind: "sync", prefix: "ν", data: "d".repeat(300) },
  { sender: 0, kind: "key", key: 65, meta: 1, down: true },
  { sender: 0, kind: "key", key: 32, meta: 0, down: false },
  { sender: 1, kind: "mouse", mouse: { x: -12.5, y: 0.1 + 0.2, button: "right", down: true } },
  { sender: 1, kind: "mouse", mouse: { x: 3e-9, y: 1e9 } },
  { sender: 0, kind: "chat", text: "-ping ✓" },
  { sender: 1, kind: "click", frame: 2 ** 40 },
  { sender: 1, kind: "wheel", frame: 2 ** 40, value: -120 },
  { sender: 0, kind: "wheel", frame: 7, value: 120 },
];

const packet = (turnFrames: readonly number[], overrides: Partial<TurnPacket> = {}): TurnPacket => ({
  from: 1, frontier: (turnFrames.at(-1) ?? 0) + 3, acks: [70000, 65000], done: false,
  turns: turnFrames.map((frame, index) => ({ frame, at: 1_793_300_000_123.456 + index * 16.7, events })),
  checks: [[60, "0x1f2e3d4c"], [120, "0x5a6b7c8d"]],
  ...overrides,
});

describe("compact turns packet", () => {
  test("[boundary] turns past the budget are left for later packets and the frontier stops before the first one left out, so a peer never takes a frame it was not sent as complete", () => {
    const backlog = packet(Array.from({ length: 40 }, (_, index) => 500 + index));
    const budget = 1000;
    const { bytes, sent } = fitTurns(backlog, budget);
    expect(bytes.length).toBeLessThanOrEqual(budget);
    expect(sent.turns.length).toBeGreaterThan(0);
    expect(sent.turns.length).toBeLessThan(40);
    const first = backlog.turns[sent.turns.length]!;
    expect(sent.frontier).toBe(first.frame - 1);
    expect(sent.done).toBe(false);
    expect(fitTurns(backlog, 100_000).sent).toEqual(backlog);
    expect(() => fitTurns(backlog, 30)).toThrow(/does not fit a 30-byte packet/);
  });
});

const sample = ["bun", join(root, "examples/sample/scripts/sample.ts"), "net"];

const FRAMES = 600;

/** One match through a fresh local relay, the joiner behind a 170 ms round trip, each frame adding `chatter` chat lines per player. */

describe("four humans through the relay's peer room", () => {
  test("[scenario] net pair --relay local --humans 4 plays 600 frames with every player's checksums equal and no datagram over 1200 bytes", async () => {
    const binary = await relayBinary();
    const run = Bun.spawn([...sample, "pair", "--relay", "local", "--humans", "4", "--frames", String(FRAMES)], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, WISP_RELAY_BIN: binary } });
    const [stdout, stderr, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(5);
    for (const line of lines.slice(0, 4)) expect(line).toMatch(new RegExp(`^(host|join\\d): ${FRAMES} frames, delay \\d+ .* [1-9]\\d* checksums compared, 0 mismatches`));
    expect(lines[4]).toMatch(/^pair: 4 humans, 600 frames, checksums match on all 4/);
    for (const line of lines.slice(0, 4)) expect(Number(/\(largest (\d+)\)/.exec(line)?.[1])).toBeLessThanOrEqual(MAX_DATAGRAM);
  }, 120_000);
});
