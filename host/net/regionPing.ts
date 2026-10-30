import { Effect } from "effect";
import type { RelayRegions } from "./joinCode";
import type { Endpoint } from "./link";
import { decodeControl, encodeControl } from "./relayControl";

const PROBES = 5;
const PROBE_TIMEOUT_MS = 1000;
const PROBE_SPACING_MS = 40;

export interface RegionPing {
  readonly name: string;
  readonly relay: Endpoint;
  /** The median round trip of the probes the relay answered, or undefined when it answered none. */
  readonly rttMs: number | undefined;
}

const median = (values: readonly number[]): number | undefined => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * The round trip to a relay in ms. A join without a cookie is answered with a Challenge before the relay looks at the room,
 * so a probe costs the relay no room and no state, and the answer's delay is the path's round trip.
 */
export const pingRelay = (relay: Endpoint, probes: number = PROBES) => Effect.promise(async () => {
  const samples: number[] = [];
  let answered: (() => void) | undefined;
  let sentAt = 0;
  const socket = await Bun.udpSocket({
    hostname: "0.0.0.0",
    socket: {
      data: (_udp, data, port, address) => {
        if (answered === undefined || port !== relay.port || address !== relay.address) return;
        try {
          if (decodeControl(new Uint8Array(data)).type !== "challenge") return;
        } catch {
          return;
        }
        samples.push(performance.now() - sentAt);
        answered();
      },
      error: () => undefined,
    },
  });
  try {
    for (let probe = 0; probe < probes; probe++) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, PROBE_TIMEOUT_MS);
        answered = () => {
          clearTimeout(timer);
          answered = undefined;
          resolve();
        };
        sentAt = performance.now();
        socket.send(encodeControl({ type: "join", cookie: 0n, request: BigInt(probe + 1), room: 0n }), relay.port, relay.address);
      });
      answered = undefined;
      if (probe + 1 < probes) await Bun.sleep(PROBE_SPACING_MS);
    }
  } finally {
    socket.close();
  }
  return median(samples);
});

/** Every region's round trip, probed at once. A region's address must be an IP, as in the published list. */
export const pingRegions = (regions: RelayRegions) => Effect.forEach(
  [...regions],
  ([name, relay]) => pingRelay(relay).pipe(Effect.map((rttMs): RegionPing => ({ name, relay, rttMs }))),
  { concurrency: "unbounded" },
);

/** The answering region with the lowest round trip: the host's default pick. */
export const nearest = (pings: readonly RegionPing[]): RegionPing | undefined =>
  pings.filter((ping) => ping.rttMs !== undefined).sort((a, b) => (a.rttMs ?? 0) - (b.rttMs ?? 0))[0];

export function describeRegions(pings: readonly RegionPing[]): string {
  const best = nearest(pings);
  return pings.map((ping) => {
    const where = `${ping.relay.address}:${ping.relay.port}`;
    return `${ping.name.padEnd(8)}${where.padEnd(24)}${ping.rttMs === undefined ? "no answer" : `${ping.rttMs.toFixed(1)} ms${ping === best ? "  nearest" : ""}`}`;
  }).join("\n");
}
