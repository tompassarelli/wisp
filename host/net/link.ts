import { Effect } from "effect";
import { MAX_DATAGRAM } from "./wire";
import { NetFailure } from "./failure";

export interface Endpoint {
  readonly address: string;
  readonly port: number;
}

/** What one side put on and took off the network, counted per datagram as the socket carries it (a relay's framing included). */
export class Traffic {
  bytesSent = 0;
  bytesReceived = 0;
  largestSent = 0;
  largestReceived = 0;
  datagramsSent = 0;
  datagramsReceived = 0;

  sent(bytes: number): void {
    this.bytesSent += bytes;
    this.datagramsSent++;
    this.largestSent = Math.max(this.largestSent, bytes);
  }

  received(bytes: number): void {
    this.bytesReceived += bytes;
    this.datagramsReceived++;
    this.largestReceived = Math.max(this.largestReceived, bytes);
  }
}

/** The one peer's datagrams in and out: straight to its address, or through a relay's peer room (wisp:docs/relay.md). */
export interface Link {
  readonly maxPayload: number;
  readonly traffic: Traffic;
  send(this: void, payload: Uint8Array): void;
}

export interface DirectLink extends Link {
  readonly port: number;
}

export interface DirectLinkOptions {
  readonly port: number;
  /** The host's address for a joiner; a host learns its joiner's from the first datagram `learn` accepts. */
  readonly peer?: Endpoint;
  readonly learn: (this: void, payload: Uint8Array) => boolean;
  readonly receive: (this: void, payload: Uint8Array) => void;
}

export const openDirectLink = (options: DirectLinkOptions) => Effect.acquireRelease(Effect.tryPromise({
  try: async () => {
    let peer = options.peer === undefined ? undefined : { ...options.peer };
    const traffic = new Traffic();
    const socket = await Bun.udpSocket({
      hostname: "0.0.0.0",
      port: options.port,
      socket: {
        data: (_socket, data, port, address) => {
          const payload = new Uint8Array(data);
          if (peer === undefined && options.learn(payload)) peer = { address, port };
          if (peer === undefined || peer.port !== port) return;
          traffic.received(payload.length);
          options.receive(payload);
        },
        // A peer not yet bound, or gone, answers with ICMP port unreachable; the handshake deadline and silence rules decide that.
        error: () => undefined,
      },
    });
    const link: DirectLink = {
      maxPayload: MAX_DATAGRAM,
      traffic,
      port: socket.port,
      send: (payload) => {
        if (peer === undefined) return;
        traffic.sent(payload.length);
        // A peer that has gone answers with ICMP port unreachable; silence and goodbyes decide that, not a send.
        try {
          socket.send(payload, peer.port, peer.address);
        } catch {
          return;
        }
      },
    };
    return { link, socket };
  },
  catch: (cause) => new NetFailure({ problem: `UDP socket: ${String(cause)}` }),
}), ({ socket }) => Effect.sync(() => socket.close())).pipe(Effect.map(({ link }) => link));
