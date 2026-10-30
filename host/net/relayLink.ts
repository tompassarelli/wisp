import { lookup } from "node:dns/promises";
import { Effect } from "effect";
import { type Endpoint, type Link, Traffic } from "./link";
import { MAX_PACKET, PEER_HEADER, decodeControl, encodeControl } from "./relayControl";
import { NetFailure } from "./failure";

const HANDSHAKE_TRIES = 20;
const HANDSHAKE_RETRY_MS = 250;

export type RelayOpening = { readonly create: true } | { readonly join: bigint };

export interface RelayLinkOptions {
  readonly relay: Endpoint;
  readonly opening: RelayOpening;
  readonly receive: (this: void, payload: Uint8Array) => void;
}

export interface RelayedLink extends Link {
  readonly room: bigint;
  readonly slot: number;
}

const randomId = () => BigInt(Math.floor(Math.random() * 2 ** 52)) + 1n;

/**
 * A peer-room member: asks the relay for a room (or to join one), answers its address challenge, and wraps each datagram
 * for the room's other member. Only the relay's own address is heard, so a stray datagram never reaches the match.
 */
export const openRelayLink = (options: RelayLinkOptions) => Effect.gen(function*() {
  const relay = yield* Effect.tryPromise({
    try: async () => ({ address: (await lookup(options.relay.address, { family: 4 })).address, port: options.relay.port }),
    catch: (cause) => new NetFailure({ problem: `finding the relay ${options.relay.address}: ${String(cause)}` }),
  });
  const traffic = new Traffic();
  let cookie = 0n, token: bigint | undefined, joined: { room: bigint; slot: number } | undefined, refusal: string | undefined;
  const request = randomId();
  const socket = yield* Effect.acquireRelease(Effect.tryPromise({
    try: () => Bun.udpSocket({
      hostname: "0.0.0.0",
      socket: {
        data: (udp, data, port, address) => {
          if (port !== relay.port || address !== relay.address) return;
          traffic.received(data.length);
          try {
            const message = decodeControl(new Uint8Array(data));
            if (message.type === "relayed") options.receive(message.payload);
            else if (message.type === "challenge") {
              cookie = message.cookie;
              if (token !== undefined) udp.send(encodeControl({ type: "verify", token, cookie }), relay.port, relay.address);
            } else if (message.type === "room" && message.request === request) {
              token = message.token;
              joined = { room: message.room, slot: message.slot };
            } else if (message.type === "refused" && message.request === request) refusal = message.reason;
          } catch {
            return;
          }
        },
        error: () => undefined,
      },
    }),
    catch: (cause) => new NetFailure({ problem: `UDP socket: ${String(cause)}` }),
  }), (udp) => Effect.sync(() => {
    try {
      if (token !== undefined) udp.send(encodeControl({ type: "leave", token }), relay.port, relay.address);
    } finally {
      udp.close();
    }
  }));
  const ask = () => encodeControl("create" in options.opening
    ? { type: "createPeer", cookie, request, players: 2 }
    : { type: "join", cookie, request, room: options.opening.join });
  for (let attempt = 0; joined === undefined; attempt++) {
    if (refusal !== undefined) return yield* new NetFailure({ problem: `the relay refused: ${refusal}` });
    if (attempt === HANDSHAKE_TRIES) return yield* new NetFailure({ problem: `the relay at ${options.relay.address}:${options.relay.port} did not answer` });
    const challenged = cookie;
    const bytes = ask();
    socket.send(bytes, relay.port, relay.address);
    for (let waited = 0; waited < HANDSHAKE_RETRY_MS && joined === undefined && refusal === undefined && cookie === challenged; waited += 2) yield* Effect.sleep(2);
  }
  const link: RelayedLink = {
    maxPayload: MAX_PACKET - PEER_HEADER,
    traffic,
    room: joined.room,
    slot: joined.slot,
    send: (payload) => {
      if (token === undefined) return;
      const bytes = encodeControl({ type: "peer", token, payload });
      traffic.sent(bytes.length);
      try {
        socket.send(bytes, relay.port, relay.address);
      } catch {
        return;
      }
    },
  };
  return link;
});
