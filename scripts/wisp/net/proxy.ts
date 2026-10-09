import { Effect } from "effect";
import { Random } from "../../../src/headless/random";
import { NetFailure } from "./peer";

export interface ProxyOptions {
  readonly listen: number;
  readonly to: { readonly address: string; readonly port: number };
  readonly oneWayMs: number;
  readonly loss: number;
  readonly seed: number;
}

/**
 * A delay and loss proxy between one joiner and a host, standing in for a network path on one machine:
 * every datagram waits `oneWayMs` in each direction and is dropped with probability `loss`. It runs until interrupted.
 */
export const runProxy = (options: ProxyOptions, log: (line: string) => void = console.error) => Effect.scoped(Effect.gen(function*() {
  const random = new Random(options.seed);
  const pending: { readonly at: number; readonly forward: () => void }[] = [];
  let client: { address: string; port: number } | undefined;
  const hold = (forward: () => void) => {
    if (random.chance(options.loss)) return;
    pending.push({ at: performance.now() + options.oneWayMs, forward });
  };
  const toHost = yield* Effect.acquireRelease(Effect.tryPromise({
    try: () => Bun.udpSocket({
      hostname: "0.0.0.0",
      socket: {
        data: (_socket, data) => {
          const to = client;
          const copy = new Uint8Array(data);
          if (to !== undefined) hold(() => listener.send(copy, to.port, to.address));
        },
      },
    }),
    catch: (cause) => new NetFailure({ problem: `proxy socket: ${String(cause)}` }),
  }), (socket) => Effect.sync(() => socket.close()));
  const listener = yield* Effect.acquireRelease(Effect.tryPromise({
    try: () => Bun.udpSocket({
      hostname: "0.0.0.0",
      port: options.listen,
      socket: {
        data: (_socket, data, port, address) => {
          client ??= { address, port };
          const copy = new Uint8Array(data);
          if (port === client.port) hold(() => toHost.send(copy, options.to.port, options.to.address));
        },
      },
    }),
    catch: (cause) => new NetFailure({ problem: `proxy port ${options.listen}: ${String(cause)}` }),
  }), (socket) => Effect.sync(() => socket.close()));
  log(`net: proxy on UDP port ${listener.port} to ${options.to.address}:${options.to.port}, ${options.oneWayMs} ms each way, ${options.loss * 100}% loss`);
  for (;;) {
    const now = performance.now();
    while ((pending[0]?.at ?? Infinity) <= now) {
      const due = pending.shift();
      // A peer that has gone answers with ICMP port unreachable; the peers' own silence rules decide that.
      try {
        due?.forward();
      } catch {
        continue;
      }
    }
    yield* Effect.sleep(Math.max(0, (pending[0]?.at ?? now + 1) - performance.now()));
  }
}));
