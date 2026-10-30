import { Effect } from "effect";
import { NetFailure } from "./failure";
import { type RelayChoice, type RelayRegions, relayChoice } from "./joinCode";
import type { Endpoint } from "./link";
import { describeRegions, nearest, pingRegions, pingRelay } from "./regionPing";

/** The pick `--relay nearest` makes. */
const NEAREST = "nearest";

const rttText = (rttMs: number) => `${rttMs.toFixed(0)} ms`;

/**
 * What a host's `--relay` names, with its round trip shown first: `nearest` takes the lowest of the listed regions and a region name
 * takes that one (both print every region's round trip), and a relay's `ADDRESS:PORT` is pinged alone. The choice fails when the relay it lands on answers no ping.
 */
export const chooseHostRelay = (text: string, regions: RelayRegions, log: (line: string) => void) => Effect.gen(function*() {
  const named = text.toLowerCase() === NEAREST ? undefined : relayChoice(text, regions);
  if (typeof named === "string") return yield* new NetFailure({ problem: named });
  const pings = named?.name === undefined && named !== undefined ? [] : yield* pingRegions(regions);
  if (pings.length > 0) log(`net: relay regions\n${describeRegions(pings)}`);
  const best = nearest(pings);
  const choice: RelayChoice | undefined = named ?? (best === undefined ? undefined : { name: best.name, relay: best.relay });
  if (choice === undefined) return yield* new NetFailure({ problem: `no relay region answered (${pings.map((ping) => ping.name).join(", ") || "none listed"})` });
  const where = choice.name ?? `${choice.relay.address}:${choice.relay.port}`;
  const rttMs = pings.length === 0 ? yield* pingRelay(choice.relay) : pings.find((ping) => ping.name === choice.name)?.rttMs;
  if (rttMs === undefined) return yield* new NetFailure({ problem: `the relay ${where} answered no ping` });
  log(`net: hosting through ${where}, round trip to it ${rttText(rttMs)}`);
  return choice;
});

/** The joiner's own round trip to the relay its code names, shown before it joins; a relay that answers no ping fails the join early. */
export const showJoinPing = (relay: Endpoint, regions: RelayRegions, log: (line: string) => void) => Effect.gen(function*() {
  const name = [...regions].find(([, endpoint]) => endpoint.address === relay.address && endpoint.port === relay.port)?.[0];
  const where = name ?? `${relay.address}:${relay.port}`;
  const rttMs = yield* pingRelay(relay);
  if (rttMs === undefined) return yield* new NetFailure({ problem: `the relay ${where} answered no ping` });
  log(`net: joining through ${where}, round trip to it ${rttText(rttMs)}`);
});

