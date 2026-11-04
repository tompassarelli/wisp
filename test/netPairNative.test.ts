import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Option } from "effect";
import { UsageFailure } from "../host/cli/command";
import { decodeNativeOutcome, pairPlayers } from "../host/commands/net";
import { dueIndex, runProxy } from "../host/net/proxy";

const PLAY = ["play", "--standalone", "--window", "native"];
const RELAY = { address: "127.0.0.1", port: 4100 };

const report = {
  slot: 1, humans: 2, delay: 2, rttMs: 300, frames: 600, checksumsCompared: 10, mismatches: 0, deliveries: 600,
  deliveryMs: { p50: 150, p95: 160, p99: 161, max: 170 }, stepMs: { p50: 2, p95: 3, max: 9 }, slips: 0, lateFrames: 0, waitMs: 0,
  packetsSent: 1, packetsReceived: 1, bytesSent: 1, bytesReceived: 1, largestSent: 1, largestReceived: 1, wallMs: 10000,
};

describe("pair --relay local --window native", () => {
  test("starts both windows from the game's native player with their own --out and keeps their logs, the pair's own flags left out", () => {
    const rest = ["--relay", "local", "--humans", "2", "--window", "native", "--out", "/tmp/pair", "--rtt", "300", "--jitter", "10", "--frames", "4500", "--four-fighters"];
    const players = pairPlayers(rest, 2, PLAY);
    if (players instanceof UsageFailure) throw new Error(players.problem);
    expect(players.host(RELAY, 2)).toEqual([...PLAY, "--host", "--relay", "127.0.0.1:4100", "--frames", "4500", "--four-fighters", "--out", "/tmp/pair/host"]);
    expect(players.join("127.0.0.1:4101/ABCD-EFGH", "join")).toEqual([...PLAY, "--join", "127.0.0.1:4101/ABCD-EFGH", "--frames", "4500", "--four-fighters", "--out", "/tmp/pair/join"]);
    expect(players.log?.("join")).toBe("/tmp/pair/join.log");
  });

  test("refuses a native pair without --out, above two humans, or for a game without a native player", () => {
    const native = ["--relay", "local", "--window", "native"];
    const problem = (rest: readonly string[], humans: number, play: readonly string[] | undefined) => {
      const players = pairPlayers(rest, humans, play);
      return players instanceof UsageFailure ? players.problem : "accepted";
    };
    expect(problem(native, 2, PLAY)).toContain("needs --out");
    expect(problem([...native, "--out", "/tmp/pair"], 4, PLAY)).toContain("2 humans");
    expect(problem([...native, "--out", "/tmp/pair"], 2, undefined)).toContain("no native window player");
    expect(problem(["--relay", "local", "--out", "/tmp/pair"], 2, PLAY)).toContain("goes with --window native");
  });

  test("headless players keep the room's humans and drop the proxy's flags", () => {
    const players = pairPlayers(["--relay", "local", "--humans", "4", "--rtt", "150", "--frames", "600"], 4, PLAY);
    if (players instanceof UsageFailure) throw new Error(players.problem);
    expect(players.host(RELAY, 4)).toEqual(["host", "--relay", "127.0.0.1:4100", "--humans", "4", "--frames", "600"]);
    expect(players.log).toBeUndefined();
  });

  test("reads a window's summary line as the peer's report, or as what ended it", () => {
    const figures = { fps: 59.1, frameMs: { p50: 3, p99: 5, max: 7 } };
    expect(decodeNativeOutcome(`loading\n${JSON.stringify({ ...figures, net: report })}\n`)).toEqual(Option.some({ report }));
    const left = decodeNativeOutcome(JSON.stringify({ ...figures, netEnded: "the other player left; the session ended" }));
    expect(Option.map(left, (outcome) => "failure" in outcome ? outcome.failure.message : "report")).toEqual(Option.some("the other player left; the session ended"));
    expect(decodeNativeOutcome("no summary")).toEqual(Option.none());
  });
});

describe("delay proxy jitter", () => {
  test("keeps pending datagrams in due order, a tie after those already queued", () => {
    const pending = [{ at: 10 }, { at: 20 }, { at: 20 }, { at: 30 }];
    expect(dueIndex(pending, 5)).toBe(0);
    expect(dueIndex(pending, 20)).toBe(3);
    expect(dueIndex(pending, 25)).toBe(3);
    expect(dueIndex(pending, 40)).toBe(4);
    expect(dueIndex([], 1)).toBe(0);
  });

  test("holds each datagram its one-way wait give or take half the jitter, and spreads them", async () => {
    const oneWayMs = 40, jitterMs = 30, count = 40;
    const arrivals: number[] = [];
    const sentAt = new Map<number, number>();
    const bound = Promise.withResolvers<void>();
    const target = await Bun.udpSocket({ hostname: "127.0.0.1", socket: { data: (_socket, data) => { const id = data[0] ?? 0; arrivals.push(performance.now() - (sentAt.get(id) ?? 0)); } } });
    const probe = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
    const listen = probe.port;
    probe.close();
    const proxy = Effect.runFork(runProxy({ listen, to: { address: "127.0.0.1", port: target.port }, oneWayMs, loss: 0, seed: 7, jitterMs }, () => bound.resolve()));
    const sender = await Bun.udpSocket({ hostname: "127.0.0.1" });
    await bound.promise;
    for (let id = 0; id < count; id++) {
      sentAt.set(id, performance.now());
      sender.send(new Uint8Array([id]), listen, "127.0.0.1");
      await Bun.sleep(2);
    }
    await Bun.sleep(oneWayMs + jitterMs + 100);
    await Effect.runPromise(Fiber.interrupt(proxy));
    sender.close();
    target.close();
    expect(arrivals.length).toBe(count);
    expect(Math.min(...arrivals)).toBeGreaterThanOrEqual(oneWayMs - jitterMs / 2 - 1);
    expect(Math.max(...arrivals)).toBeLessThan(oneWayMs + jitterMs / 2 + 25);
    expect(Math.max(...arrivals) - Math.min(...arrivals)).toBeGreaterThan(jitterMs / 2);
  });
});
