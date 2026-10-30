const MAGIC = 0x57;
const VERSION = 1;
export const MAX_PACKET = 1200;
export const PEER_HEADER = 3 + 8;

export const REFUSALS = ["rateLimited", "noRoom", "full", "players", "busy"] as const;
type Refusal = (typeof REFUSALS)[number];

export type RelayControl =
  | { readonly type: "create"; readonly cookie: bigint; readonly request: bigint; readonly players: number }
  | { readonly type: "createPeer"; readonly cookie: bigint; readonly request: bigint; readonly players: number }
  | { readonly type: "join"; readonly cookie: bigint; readonly request: bigint; readonly room: bigint }
  | { readonly type: "challenge"; readonly cookie: bigint }
  | { readonly type: "room"; readonly request: bigint; readonly room: bigint; readonly token: bigint; readonly players: number; readonly slot: number; readonly steps: Uint8Array }
  | { readonly type: "verify"; readonly token: bigint; readonly cookie: bigint }
  | { readonly type: "leave"; readonly token: bigint }
  | { readonly type: "refused"; readonly request: bigint; readonly reason: Refusal }
  | { readonly type: "peer"; readonly token: bigint; readonly payload: Uint8Array }
  | { readonly type: "relayed"; readonly from: number; readonly payload: Uint8Array }
  | { readonly type: "result"; readonly token: bigint; readonly winner: number; readonly checksum: number; readonly rtt: number };

const KINDS = { create: 3, join: 4, challenge: 5, room: 6, verify: 7, leave: 8, refused: 9, createPeer: 13, peer: 14, relayed: 15, result: 16 } as const;

class Writer {
  readonly bytes: number[] = [MAGIC, VERSION];
  u8(value: number): this {
    this.bytes.push(value);
    return this;
  }
  u16(value: number): this {
    this.bytes.push(value & 255, (value >>> 8) & 255);
    return this;
  }
  u32(value: number): this {
    return this.u16(value & 0xffff).u16(value >>> 16);
  }
  u64(value: bigint): this {
    for (let shift = 0n; shift < 64n; shift += 8n) this.bytes.push(Number((value >> shift) & 255n));
    return this;
  }
  raw(data: Uint8Array): this {
    this.bytes.push(...data);
    return this;
  }
}

export function encodeControl(message: RelayControl): Uint8Array {
  const out = new Writer().u8(KINDS[message.type]);
  switch (message.type) {
    case "create":
    case "createPeer":
      out.u64(message.cookie).u64(message.request).u8(message.players);
      break;
    case "join":
      out.u64(message.cookie).u64(message.request).u64(message.room);
      break;
    case "challenge":
      out.u64(message.cookie);
      break;
    case "room":
      out.u64(message.request).u64(message.room).u64(message.token).u8(message.players).u8(message.slot).u8(message.steps.length).raw(message.steps);
      break;
    case "verify":
      out.u64(message.token).u64(message.cookie);
      break;
    case "leave":
      out.u64(message.token);
      break;
    case "refused":
      out.u64(message.request).u8(REFUSALS.indexOf(message.reason) + 1);
      break;
    case "peer":
      out.u64(message.token).raw(message.payload);
      break;
    case "relayed":
      out.u8(message.from).raw(message.payload);
      break;
    case "result":
      out.u64(message.token).u8(message.winner).u32(message.checksum).u16(message.rtt);
      break;
  }
  return Uint8Array.from(out.bytes);
}

class Reader {
  at = 0;
  constructor(readonly buf: Uint8Array) {}
  u8(): number {
    const value = this.buf[this.at];
    if (value === undefined) throw new Error("short");
    this.at += 1;
    return value;
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  u64(): bigint {
    let value = 0n;
    for (let shift = 0n; shift < 64n; shift += 8n) value |= BigInt(this.u8()) << shift;
    return value;
  }
  take(count: number): Uint8Array {
    if (this.at + count > this.buf.length) throw new Error("short");
    const slice = this.buf.slice(this.at, this.at + count);
    this.at += count;
    return slice;
  }
  rest(): Uint8Array {
    return this.take(this.buf.length - this.at);
  }
}

function decodeBody(kind: number, r: Reader): RelayControl {
  let message: RelayControl;
  switch (kind) {
    case KINDS.create:
      message = { type: "create", cookie: r.u64(), request: r.u64(), players: r.u8() };
      break;
    case KINDS.createPeer:
      message = { type: "createPeer", cookie: r.u64(), request: r.u64(), players: r.u8() };
      break;
    case KINDS.join:
      message = { type: "join", cookie: r.u64(), request: r.u64(), room: r.u64() };
      break;
    case KINDS.challenge:
      message = { type: "challenge", cookie: r.u64() };
      break;
    case KINDS.room: {
      const request = r.u64();
      const room = r.u64();
      const token = r.u64();
      const players = r.u8();
      const slot = r.u8();
      message = { type: "room", request, room, token, players, slot, steps: r.take(r.u8()) };
      break;
    }
    case KINDS.verify:
      message = { type: "verify", token: r.u64(), cookie: r.u64() };
      break;
    case KINDS.leave:
      message = { type: "leave", token: r.u64() };
      break;
    case KINDS.refused: {
      const request = r.u64();
      const reason = REFUSALS[r.u8() - 1];
      if (reason === undefined) throw new Error("flags");
      message = { type: "refused", request, reason };
      break;
    }
    case KINDS.peer:
      message = { type: "peer", token: r.u64(), payload: r.rest() };
      break;
    case KINDS.relayed:
      message = { type: "relayed", from: r.u8(), payload: r.rest() };
      break;
    case KINDS.result:
      message = { type: "result", token: r.u64(), winner: r.u8(), checksum: r.u32(), rtt: r.u16() };
      break;
    default:
      throw new Error("kind");
  }
  return message;
}

export function decodeControl(buf: Uint8Array): RelayControl {
  if (buf.length > MAX_PACKET) throw new Error("too long");
  const r = new Reader(buf);
  if (r.u8() !== MAGIC) throw new Error("magic");
  if (r.u8() !== VERSION) throw new Error("version");
  const message = decodeBody(r.u8(), r);
  if (r.at !== buf.length) throw new Error("trailing");
  return message;
}
