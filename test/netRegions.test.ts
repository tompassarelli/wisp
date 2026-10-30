import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "node:path";
import { relayRegions } from "../host/net/joinCode";
import { relayBinary } from "./headless/relayBinary";
import { describeRegions, nearest, pingRegions, pingRelay } from "../host/net/regionPing";

const root = join(import.meta.dir, "..");
const sample = ["bun", join(root, "examples/sample/scripts/sample.ts"), "net"];

const freePort = async () => {
  const probe = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
  const { port } = probe;
  probe.close();
  return port;
};

describe("relay region ping", () => {
  test("[scenario] a relay behind a 120 ms round trip measures 120 ms and one behind none measures under 30, the nearest is the lower, and a port nobody listens on answers no ping", async () => {
    const binary = await relayBinary();
    const [relayPort, farPort, deadPort] = [await freePort(), await freePort(), await freePort()];
    const children: { kill(): void }[] = [];
    try {
      children.push(Bun.spawn([binary, "--bind", `127.0.0.1:${relayPort}`], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }));
      children.push(Bun.spawn([...sample, "proxy", "--listen", String(farPort), "--to", `127.0.0.1:${relayPort}`, "--rtt", "120"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }));
      await Bun.sleep(600);
      const regions = relayRegions({ WISP_RELAYS: `near=127.0.0.1:${relayPort},far=127.0.0.1:${farPort},dead=127.0.0.1:${deadPort}` });
      const pings = await Effect.runPromise(pingRegions(regions));
      const by = (name: string) => pings.find((ping) => ping.name === name)?.rttMs;
      expect(by("far")).toBeGreaterThan(115);
      expect(by("far")).toBeLessThan(160);
      expect(by("near")).toBeLessThan(30);
      expect(by("dead")).toBeUndefined();
      expect(nearest(pings)?.name).toBe("near");
      const table = describeRegions(pings);
      expect(table).toMatch(/near +127\.0\.0\.1:\d+ +\d+\.\d ms {2}nearest/);
      expect(table).toMatch(/dead +127\.0\.0\.1:\d+ +no answer/);
      expect(await Effect.runPromise(pingRelay({ address: "127.0.0.1", port: deadPort }, 1))).toBeUndefined();
    } finally {
      for (const child of children) child.kill();
    }
  }, 60_000);

  test("[boundary] no region answering leaves no nearest", () => {
    expect(nearest([{ name: "a", relay: { address: "127.0.0.1", port: 1 }, rttMs: undefined }])).toBeUndefined();
    expect(nearest([])).toBeUndefined();
  });
});
