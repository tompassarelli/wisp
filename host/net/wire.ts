import { Option, Schema } from "effect";
import type { LinkEvent } from "../../src/headless/lockstep";
import type { TurnPacket } from "../../src/headless/turnLedger";
import { NetFailure } from "./failure";

/** The most bytes one datagram carries on any link, a relay's cap and a size every path's MTU takes. */
export const MAX_DATAGRAM = 1200;

const Whole = Schema.Finite;
const Control = Schema.Union([
  Schema.Struct({ t: Schema.Literal("hello"), game: Schema.String }),
  Schema.Struct({ t: Schema.Literal("refuse"), problem: Schema.String }),
  Schema.Struct({ t: Schema.Literal("ping"), id: Whole, at: Whole }),
  Schema.Struct({ t: Schema.Literal("pong"), id: Whole, at: Whole }),
  Schema.Struct({ t: Schema.Literal("delay"), delay: Whole, rttMs: Whole }),
  Schema.Struct({ t: Schema.Literal("ready") }),
  Schema.Struct({ t: Schema.Literal("go"), inMs: Whole }),
  Schema.Struct({ t: Schema.Literal("bye"), reason: Schema.String }),
]);
const ControlJson = Schema.fromJsonString(Control);
const decodeControl = Schema.decodeUnknownOption(ControlJson);
const encodeControl = Schema.encodeSync(ControlJson);

export type Datagram = typeof Control.Type | ({ readonly t: "turns" } & TurnPacket);

const CONTROL = 0;
const TURNS = 1;
const EVENT_KINDS = ["sync", "key", "mouse", "mouseMove", "chat", "click"] as const;
const BUTTONS = ["left", "middle", "right"] as const;

class Writer {
  readonly bytes: number[] = [];
  private readonly scratch = new DataView(new ArrayBuffer(8));
  u8(value: number): this {
    this.bytes.push(value);
    return this;
  }
  varint(value: number): this {
    let rest = value;
    while (rest >= 128) {
      this.bytes.push((rest % 128) | 128);
      rest = Math.floor(rest / 128);
    }
    this.bytes.push(rest);
    return this;
  }
  zigzag(value: number): this {
    return this.varint(value < 0 ? -2 * value - 1 : 2 * value);
  }
  f64(value: number): this {
    this.scratch.setFloat64(0, value);
    for (let at = 0; at < 8; at++) this.bytes.push(this.scratch.getUint8(at));
    return this;
  }
  text(value: string): this {
    const encoded = new TextEncoder().encode(value);
    this.varint(encoded.length);
    for (const byte of encoded) this.bytes.push(byte);
    return this;
  }
}

class Reader {
  at = 0;
  private readonly view: DataView;
  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8(): number {
    const value = this.buf[this.at];
    if (value === undefined) throw new Error("short");
    this.at += 1;
    return value;
  }
  varint(): number {
    let value = 0, scale = 1;
    for (let byte = this.u8(); ; byte = this.u8()) {
      value += (byte & 127) * scale;
      if (byte < 128) return value;
      scale *= 128;
      if (scale > 2 ** 49) throw new Error("long");
    }
  }
  zigzag(): number {
    const value = this.varint();
    return value % 2 === 1 ? -(value + 1) / 2 : value / 2;
  }
  f64(): number {
    if (this.at + 8 > this.buf.length) throw new Error("short");
    const value = this.view.getFloat64(this.at);
    this.at += 8;
    return value;
  }
  text(): string {
    const length = this.varint();
    if (this.at + length > this.buf.length) throw new Error("short");
    const value = new TextDecoder("utf-8", { fatal: true }).decode(this.buf.subarray(this.at, this.at + length));
    this.at += length;
    return value;
  }
  get done(): boolean {
    return this.at === this.buf.length;
  }
}

function writeEvent(out: Writer, event: LinkEvent): void {
  if (event.kind === "mouse") {
    const { mouse } = event;
    if ("button" in mouse) out.u8(EVENT_KINDS.indexOf("mouse")).varint(event.sender).f64(mouse.x).f64(mouse.y).u8(BUTTONS.indexOf(mouse.button) * 2 + (mouse.down ? 1 : 0));
    else out.u8(EVENT_KINDS.indexOf("mouseMove")).varint(event.sender).f64(mouse.x).f64(mouse.y);
    return;
  }
  out.u8(EVENT_KINDS.indexOf(event.kind)).varint(event.sender);
  if (event.kind === "sync") out.text(event.prefix).text(event.data);
  else if (event.kind === "key") out.varint(event.key).u8(event.meta * 2 + (event.down ? 1 : 0));
  else if (event.kind === "chat") out.text(event.text);
  else out.varint(event.frame);
}

function readEvent(r: Reader): LinkEvent {
  const kind = EVENT_KINDS[r.u8()];
  const sender = r.varint();
  switch (kind) {
    case "sync": return { sender, kind, prefix: r.text(), data: r.text() };
    case "key": {
      const key = r.varint(), flags = r.u8();
      return { sender, kind, key, meta: flags >> 1, down: (flags & 1) === 1 };
    }
    case "mouse": {
      const x = r.f64(), y = r.f64(), flags = r.u8(), button = BUTTONS[flags >> 1];
      if (button === undefined) throw new Error("button");
      return { sender, kind, mouse: { x, y, button, down: (flags & 1) === 1 } };
    }
    case "mouseMove": return { sender, kind: "mouse", mouse: { x: r.f64(), y: r.f64() } };
    case "chat": return { sender, kind, text: r.text() };
    case "click": return { sender, kind, frame: r.varint() };
    default: throw new Error("kind");
  }
}

/**
 * A `turns` packet in bytes: the tag, the sender, frontier, acknowledgement and done flag, then each turn as its frame (the
 * first absolute, the rest from the turn before) and its time (the first as a double, the rest in microseconds from the turn
 * before) and its events, then the checksums. Events keep every field exactly; only turn times are rounded, to a microsecond.
 */
function writeTurns(packet: TurnPacket): number[] {
  const out = new Writer().u8(TURNS).varint(packet.from).varint(packet.frontier).varint(packet.ack).u8(packet.done ? 1 : 0).varint(packet.turns.length);
  let frame = 0, atUs = 0;
  packet.turns.forEach((turn, index) => {
    const turnUs = Math.round(turn.at * 1000);
    if (index === 0) out.varint(turn.frame).f64(turn.at);
    else out.varint(turn.frame - frame).zigzag(turnUs - atUs);
    frame = turn.frame;
    atUs = turnUs;
    out.varint(turn.events.length);
    for (const event of turn.events) writeEvent(out, event);
  });
  out.varint(packet.checks.length);
  for (const [at, checksum] of packet.checks) out.varint(at).text(checksum);
  return out.bytes;
}

function readTurns(r: Reader): TurnPacket {
  const from = r.varint(), frontier = r.varint(), ack = r.varint(), done = r.u8() === 1;
  const turns: TurnPacket["turns"][number][] = [];
  let frame = 0, atUs = 0;
  for (let count = r.varint(), index = 0; index < count; index++) {
    let at: number;
    if (index === 0) {
      frame = r.varint();
      at = r.f64();
      atUs = Math.round(at * 1000);
    } else {
      frame += r.varint();
      atUs += r.zigzag();
      at = atUs / 1000;
    }
    const events: LinkEvent[] = [];
    for (let events_ = r.varint(), event = 0; event < events_; event++) events.push(readEvent(r));
    turns.push({ frame, at, events });
  }
  const checks: [number, string][] = [];
  for (let count = r.varint(), index = 0; index < count; index++) checks.push([r.varint(), r.text()]);
  return { from, frontier, ack, done, turns, checks };
}

export function encodeDatagram(datagram: Datagram): Uint8Array {
  if (datagram.t === "turns") return Uint8Array.from(writeTurns(datagram));
  return Uint8Array.from([CONTROL, ...new TextEncoder().encode(encodeControl(datagram))]);
}

export const decodeDatagram = (bytes: Uint8Array): Option.Option<Datagram> => {
  try {
    if (bytes[0] === CONTROL) return decodeControl(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(1)));
    if (bytes[0] !== TURNS) return Option.none();
    const r = new Reader(bytes);
    r.u8();
    const packet = readTurns(r);
    return r.done ? Option.some({ t: "turns", ...packet }) : Option.none();
  } catch {
    return Option.none();
  }
};

/**
 * `packet` as bytes within `budget`. When its turns don't all fit, the newest are left out and the packet's frontier stops
 * before the first of them, so the peer never takes a frame as complete that it was not sent; they follow in later packets.
 */
export function fitTurns(packet: TurnPacket, budget: number): { readonly bytes: Uint8Array; readonly sent: TurnPacket } {
  for (let count = packet.turns.length; count >= 0; count--) {
    const next = packet.turns[count];
    const cut: TurnPacket = next === undefined ? packet : { ...packet, turns: packet.turns.slice(0, count), frontier: Math.min(packet.frontier, next.frame - 1), done: false };
    const bytes = encodeDatagram({ t: "turns", ...cut });
    if (bytes.length <= budget) return { bytes, sent: cut };
  }
  const first = packet.turns[0];
  throw new NetFailure({ problem: `the turn at frame ${first?.frame ?? packet.frontier} does not fit a ${budget}-byte packet` });
}
