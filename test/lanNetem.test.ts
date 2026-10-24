import { describe, expect, test } from "bun:test";
import { type PortScope, burstModel, impairCommands, perSendLoss } from "../host/lan/netem";

const PRIO = ["tc", "qdisc", "add", "dev", "lo", "root", "handle", "1:", "prio", "bands", "2", "priomap", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
const filter = (direction: string, protocol: string) => ["tc", "filter", "add", "dev", "lo", "parent", "1:", "protocol", "ip", "prio", "1", "u32", "match", "ip", "protocol", protocol, "0xff", "match", "ip", direction, "6201", "0xffff", "flowid", "1:2"];
const independent = ["loss", "1.0051%"];
const bursty = ["loss", "gemodel", "0.2538%", "25%", "100%", "0%"];
const PROTOCOLS = { udp: "17", tcp: "6" } as const;

describe("lan netem", () => {
  test("[reference tc-netem(8), tc-prio(8), tc-u32(8)] each combination of --jitter, --burst and --udp-port or --tcp-port puts half the round trip and its jitter on every send, and a port scope routes only that protocol's packets to or from that port through netem while every other packet takes the plain band", () => {
    const scopes: readonly (PortScope | undefined)[] = [undefined, { protocol: "udp", port: 6201 }, { protocol: "tcp", port: 6201 }];
    const shapes = [
      { jitter: 0, burst: false, netem: ["netem", "delay", "60ms", ...independent] },
      { jitter: 20, burst: false, netem: ["netem", "delay", "60ms", "10ms", ...independent] },
      { jitter: 0, burst: true, netem: ["netem", "delay", "60ms", ...bursty] },
      { jitter: 20, burst: true, netem: ["netem", "delay", "60ms", "10ms", ...bursty] },
    ] as const;
    for (const scope of scopes) {
      for (const { netem, ...flags } of shapes) {
        const impairment = { rtt: 120, loss: 2, ...flags, ...(scope === undefined ? {} : { scope }) };
        expect(impairCommands(impairment)).toEqual(scope === undefined
          ? [["tc", "qdisc", "add", "dev", "lo", "root", ...netem]]
          : [PRIO, ["tc", "qdisc", "add", "dev", "lo", "parent", "1:2", "handle", "20:", ...netem], filter("dport", PROTOCOLS[scope.protocol]), filter("sport", PROTOCOLS[scope.protocol])]);
      }
    }
  });

  test("[spec docs/lan.md] --loss is the round trip's loss: two sends at the per-send rate lose it, and the bursty model's long-run loss equals the per-send rate", () => {
    for (const loss of [0, 0.5, 2, 10, 50, 99]) {
      const perSend = perSendLoss(loss) / 100;
      expect(1 - (1 - perSend) ** 2).toBeCloseTo(loss / 100, 12);
      const { enter, leave } = burstModel(perSend * 100);
      expect(enter / (enter + leave)).toBeCloseTo(perSend, 12);
    }
  });
});
