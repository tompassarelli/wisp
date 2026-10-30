import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { join } from "node:path";
import type { LinkEvent } from "../src/headless/lockstep";
import type { TurnPacket } from "../src/headless/turnLedger";
import { joinCode, joinTarget, relayChoice, relayCode, relayRegions } from "../host/net/joinCode";
import { relayBinary } from "./headless/relayBinary";
import { MAX_DATAGRAM, decodeDatagram, encodeDatagram, fitTurns } from "../host/net/wire";

const root = join(import.meta.dir, "..");

const events: readonly LinkEvent[] = [
  { sender: 1, kind: "sync", prefix: "ν", data: "d".repeat(300) },
  { sender: 0, kind: "key", key: 65, meta: 1, down: true },
  { sender: 0, kind: "key", key: 32, meta: 0, down: false },
  { sender: 1, kind: "mouse", mouse: { x: -12.5, y: 0.1 + 0.2, button: "right", down: true } },
  { sender: 1, kind: "mouse", mouse: { x: 3e-9, y: 1e9 } },
  { sender: 0, kind: "chat", text: "-ping ✓" },
  { sender: 1, kind: "click", frame: 2 ** 40 },
];

const packet = (turnFrames: readonly number[], overrides: Partial<TurnPacket> = {}): TurnPacket => ({
  from: 1, frontier: (turnFrames.at(-1) ?? 0) + 3, acks: [70000, 65000], done: false,
  turns: turnFrames.map((frame, index) => ({ frame, at: 1_793_300_000_123.456 + index * 16.7, events })),
  checks: [[60, "0x1f2e3d4c"], [120, "0x5a6b7c8d"]],
  ...overrides,
});

describe("compact turns packet", () => {
  test("[boundary] a turns packet and a control datagram decode to what was encoded, every event field exact and a turn's time to the microsecond", () => {
    const sent = packet([100, 101, 105, 70100]);
    const decoded = decodeDatagram(encodeDatagram({ t: "turns", ...sent }));
    if (Option.isNone(decoded) || decoded.value.t !== "turns") throw new Error("the packet did not decode");
    const { turns, ...rest } = decoded.value;
    expect(rest).toEqual({ t: "turns", ...sent, turns: undefined });
    expect(turns.map(({ at, ...turn }) => turn)).toEqual(sent.turns.map(({ at, ...turn }) => turn));
    turns.forEach((turn, index) => expect(Math.abs(turn.at - sent.turns[index]!.at)).toBeLessThanOrEqual(0.0005));
    expect(turns[0]?.at).toBe(sent.turns[0]!.at);
    for (const control of [{ t: "hello", game: "Sample map abc" }, { t: "delay", delay: 6, rtts: [0, 170, 90] }, { t: "bye", reason: "its match ended" }, { t: "ready" }] as const) {
      expect(decodeDatagram(encodeDatagram(control))).toEqual(Option.some(control));
    }
  });

  test("[boundary] a truncated, extended or foreign datagram decodes to nothing", () => {
    const bytes = encodeDatagram({ t: "turns", ...packet([100, 101]) });
    for (let length = 1; length < bytes.length; length++) expect(Option.isNone(decodeDatagram(bytes.slice(0, length))), `cut to ${length}`).toBe(true);
    expect(Option.isNone(decodeDatagram(Uint8Array.from([...bytes, 0])))).toBe(true);
    expect(Option.isNone(decodeDatagram(Uint8Array.from([9, 1, 2])))).toBe(true);
    expect(Option.isNone(decodeDatagram(new Uint8Array(0)))).toBe(true);
  });

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

describe("relay codes", () => {
  const regions = relayRegions({ WISP_RELAYS: "sgp=203.0.113.9:7457, eu=198.51.100.4:7000" });

  test("[boundary] a relay code names the region and the room, reads back through the region list, and tells apart from a LAN code and a direct address", () => {
    const sgp = relayChoice("sgp", regions);
    if (typeof sgp === "string") throw new Error(sgp);
    for (const room of [1n, 0x3cbe60ce850100ccn, 2n ** 64n - 1n]) {
      const code = relayCode(sgp, room);
      expect(code).toMatch(/^sgp-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
      expect(joinTarget(code, regions)).toEqual({ relay: { address: "203.0.113.9", port: 7457 }, room });
      expect(joinTarget(code.toLowerCase(), regions)).toEqual({ relay: { address: "203.0.113.9", port: 7457 }, room });
    }
    const unlisted = relayChoice("127.0.0.1:9301", regions);
    if (typeof unlisted === "string") throw new Error(unlisted);
    expect(joinTarget(relayCode(unlisted, 77n), regions)).toEqual({ relay: { address: "127.0.0.1", port: 9301 }, room: 77n });
    expect(joinTarget(joinCode("192.168.1.20", 6112, "0123abcd"), regions)).toEqual({ address: "192.168.1.20", port: 6112, mapHash: "0123abcd" });
    expect(joinTarget("192.168.1.20:6112", regions)).toEqual({ address: "192.168.1.20", port: 6112 });
  });

  test("[boundary] an unlisted region, a short room and a room past 64 bits are refused with the reason", () => {
    expect(joinTarget("tyo-0000-0000-0001-0", regions)).toContain("no relay region");
    expect(joinTarget("sgp-0000-0001", regions)).toContain("neither a join code");
    expect(joinTarget("sgp-ZZZZ-ZZZZ-ZZZZ-Z", regions)).not.toHaveProperty("relay");
    expect(relayChoice("nowhere", relayRegions({}))).toContain("sgp");
    expect(relayChoice("sgp", relayRegions({ WISP_RELAYS: "sgp=203.0.113.9:7000" }))).toEqual({ name: "sgp", relay: { address: "203.0.113.9", port: 7000 } });
  });
});

const freePort = async () => {
  const probe = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
  const { port } = probe;
  probe.close();
  return port;
};

const sample = ["bun", join(root, "examples/sample/scripts/sample.ts"), "net"];

async function lineMatching(stream: ReadableStream<Uint8Array>, pattern: RegExp, what: string): Promise<RegExpMatchArray> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`${what} ended before it printed ${pattern}: ${seen}`);
    seen += decoder.decode(value, { stream: true });
    const found = pattern.exec(seen);
    if (found !== null) {
      reader.releaseLock();
      return found;
    }
  }
}

type Piped = Bun.Subprocess<"ignore", "pipe", "pipe">;

const outcome = async (child: Piped) => {
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  const last = stdout.trim().split("\n").at(-1) ?? "";
  return { code, outcome: JSON.parse(last || "{}") as { report?: Record<string, number>; failure?: { message: string } } };
};

const FRAMES = 600;

/** One match through a fresh local relay, the joiner behind a 170 ms round trip, each frame adding `chatter` chat lines per player. */
async function relayedMatch(binary: string, chatter: number) {
  const [relayPort, proxyPort] = [await freePort(), await freePort()];
  const children: { kill(): void }[] = [];
  const quiet = (argv: string[]) => {
    children.push(Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }));
  };
  const player = (argv: string[]): Piped => {
    const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    children.push(child);
    return child;
  };
  try {
    quiet([binary, "--bind", `127.0.0.1:${relayPort}`]);
    const flags = ["--frames", String(FRAMES), "--chatter", String(chatter)];
    const host = player([...sample, "host", "--relay", `127.0.0.1:${relayPort}`, ...flags]);
    const [hostLines, hostStderr] = host.stderr.tee();
    const code = (await lineMatching(hostLines, /net: join code (\S+)/, "the host"))[1] ?? "";
    expect(code).toMatch(/^127\.0\.0\.1:\d+\/[0-9A-Z-]+$/);
    quiet([...sample, "proxy", "--listen", String(proxyPort), "--to", `127.0.0.1:${relayPort}`, "--rtt", "170"]);
    await Bun.sleep(500);
    const joiner = player([...sample, "join", code.replace(`:${relayPort}/`, `:${proxyPort}/`), ...flags]);
    const [hosted, joined] = await Promise.all([outcome(host), outcome(joiner)]);
    expect(hosted.outcome.failure).toBeUndefined();
    expect(joined.outcome.failure).toBeUndefined();
    const [hostLog, joinLog] = await Promise.all([new Response(hostStderr).text(), new Response(joiner.stderr).text()]);
    expect(hostLog).toMatch(/net: hosting through 127\.0\.0\.1:\d+, round trip to it \d+ ms/);
    expect(joinLog).toMatch(/net: joining through 127\.0\.0\.1:\d+, round trip to it 1[67]\d ms/);
    for (const log of [hostLog, joinLog]) expect(log).toMatch(/net: slot \d, map input delay [1-9]\d* frames/);
    return [hosted.outcome.report, joined.outcome.report];
  } finally {
    for (const child of children) child.kill();
  }
}

describe("standalone host and join through the relay", () => {
  test("[scenario] two peers play 600 frames through a local relay, one of them behind a 170 ms round trip, with equal checksums and no datagram over 1200 bytes, lightly and with six chat lines a frame each, and the bytes per match are printed", async () => {
    const binary = await relayBinary();
    const matches = await Promise.all([1, 6].map(async (chatter) => ({ chatter, sides: await relayedMatch(binary, chatter) })));
    for (const { chatter, sides } of matches) {
      for (const report of sides) {
        expect(report?.frames).toBe(FRAMES);
        expect(report?.delay).toBe(6);
        expect(report?.mismatches).toBe(0);
        expect(report?.checksumsCompared).toBeGreaterThanOrEqual(9);
        expect(report?.largestSent).toBeLessThanOrEqual(MAX_DATAGRAM);
        expect(report?.largestReceived).toBeLessThanOrEqual(MAX_DATAGRAM);
        expect(report?.rttMs).toBeGreaterThan(160);
      }
      const bytes = sides.reduce((total, report) => total + (report?.bytesSent ?? 0), 0);
      console.log(`bytes per match, ${chatter} chat line${chatter === 1 ? "" : "s"} a frame each: ${bytes} on the wire from both players in ${FRAMES} frames at 170 ms, ${(bytes / FRAMES).toFixed(0)} per frame, ${(bytes / (FRAMES / 60)).toFixed(0)} per second; largest datagram ${Math.max(...sides.map((report) => report?.largestSent ?? 0))} bytes`);
    }
  }, 120_000);
});

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
