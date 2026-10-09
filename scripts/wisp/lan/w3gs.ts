

// W3GS uses F7/type/u16 length/little-endian payload; layouts follow W3Champions' Flo (MPL-2.0, github.com/BogdanW3/W3C-Flo crates/w3gs) and wc3-slop-lan.



export const PACKET = {
  PingFromHost: 0x01,
  SlotInfoJoin: 0x04,
  RejectJoin: 0x05,
  PlayerInfo: 0x06,
  PlayerLeft: 0x07,
  PlayerLoaded: 0x08,
  SlotInfo: 0x09,
  CountDownStart: 0x0a,
  CountDownEnd: 0x0b,
  IncomingAction: 0x0c,
  Desync: 0x0d,
  ChatFromHost: 0x0f,
  StartLag: 0x10,
  StopLag: 0x11,
  LeaveAck: 0x1b,
  ReqJoin: 0x1e,
  LeaveReq: 0x21,
  GameLoadedSelf: 0x23,
  OutgoingAction: 0x26,
  OutgoingKeepAlive: 0x27,
  ChatToHost: 0x28,
  DropReq: 0x29,
  SearchGame: 0x2f,
  GameInfo: 0x30,
  MapCheck: 0x3d,
  MapSize: 0x42,
  PongToHost: 0x46,
  ProtoBuf: 0x59,
} as const;

export const PROTOBUF = { PlayerProfile: 0x03, PlayerSkins: 0x04, PlayerUnknown5: 0x05 } as const;


export const LEAVE_REASONS: Readonly<Record<number, string>> = {
  0x01: "disconnect",
  0x07: "lost",
  0x08: "lost buildings",
  0x09: "won",
  0x0a: "draw",
  0x0b: "observer",
  0x0d: "lobby",
};

export interface Packet {
  readonly type: number;
  readonly payload: Uint8Array;
}


export class Writer {
  private chunks: number[] = [];
  u8(value: number): this {
    this.chunks.push(value & 0xff);
    return this;
  }
  u16(value: number): this {
    return this.u8(value).u8(value >>> 8);
  }
  u32(value: number): this {
    return this.u16(value & 0xffff).u16(value >>> 16);
  }
  f32(value: number): this {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    return this.raw(new Uint8Array(view.buffer));
  }
  raw(bytes: Uint8Array | readonly number[]): this {
    for (const byte of bytes) this.chunks.push(byte & 0xff);
    return this;
  }

  cstring(text: string | Uint8Array): this {
    return this.raw(typeof text === "string" ? new TextEncoder().encode(text) : text).u8(0);
  }
  get length(): number {
    return this.chunks.length;
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}


export class Reader {
  offset = 0;
  private readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get remaining(): number {
    return this.bytes.length - this.offset;
  }
  private need(length: number) {
    if (this.offset + length > this.bytes.length) throw new Error(`payload ends at ${this.bytes.length}, needed ${this.offset + length}`);
  }
  u8(): number {
    this.need(1);
    return this.bytes[this.offset++] ?? 0;
  }
  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  f32(): number {
    this.need(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }
  take(length: number): Uint8Array {
    this.need(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
  cbytes(): Uint8Array {
    const end = this.bytes.indexOf(0, this.offset);
    if (end < 0) throw new Error("unterminated string");
    const slice = this.bytes.subarray(this.offset, end);
    this.offset = end + 1;
    return slice;
  }
  cstring(): string {
    return new TextDecoder().decode(this.cbytes());
  }
  rest(): Uint8Array {
    return this.take(this.remaining);
  }
}

export function encodePacket(type: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const length = payload.length + 4;
  if (length > 0xffff) throw new Error(`W3GS packet 0x${type.toString(16)} is ${length} bytes, over 65535`);
  const packet = new Uint8Array(length);
  packet.set([0xf7, type, length & 0xff, length >>> 8]);
  packet.set(payload, 4);
  return packet;
}


export function splitPackets(buffer: Uint8Array): { readonly packets: Packet[]; readonly rest: Uint8Array } {
  const packets: Packet[] = [];
  let at = 0;
  while (buffer.length - at >= 4) {
    if (buffer[at] !== 0xf7) throw new Error(`not a W3GS packet: byte 0x${(buffer[at] ?? 0).toString(16)} at ${at}`);
    const length = (buffer[at + 2] ?? 0) | ((buffer[at + 3] ?? 0) << 8);
    if (length < 4) throw new Error(`W3GS packet length ${length}`);
    if (buffer.length - at < length) break;
    packets.push({ type: buffer[at + 1] ?? 0, payload: buffer.slice(at + 4, at + length) });
    at += length;
  }
  return { packets, rest: buffer.slice(at) };
}

/** The 16-byte socket address W3GS carries: family 2, port, IPv4, eight zeros; or 16 zeros. */
export function sockAddr(writer: Writer, address?: { readonly ip: readonly number[]; readonly port: number }): Writer {
  if (address === undefined) return writer.raw(new Array(16).fill(0));
  return writer.u16(2).u16(address.port).raw(address.ip).raw(new Array(8).fill(0));
}

export const crc32 = (bytes: Uint8Array): number => Bun.hash.crc32(bytes) >>> 0;



export const SLOT_OPEN = 0;
export const SLOT_CLOSED = 1;
export const SLOT_OCCUPIED = 2;

export const RACE_RANDOM_SELECTABLE = 0x60;
export const RACE_HUMAN = 0x01;

export interface Slot {
  readonly playerId: number;
  readonly download: number;
  readonly status: number;
  readonly computer: boolean;
  readonly team: number;
  readonly color: number;
  readonly race: number;
  readonly computerType: number;
  readonly handicap: number;
}

export interface SlotTable {
  readonly slots: readonly Slot[];
  readonly randomSeed: number;
/** Flags 1|2 mean custom forces plus fixed player settings (wc3-slop-lan; Flo's enum cannot express both). */
  readonly layout: number;
  readonly players: number;
}

export function encodeSlotTable(writer: Writer, table: SlotTable): Writer {
  writer.u16(7 + 9 * table.slots.length).u8(table.slots.length);
  for (const slot of table.slots) {
    writer.u8(slot.playerId).u8(slot.download).u8(slot.status).u8(slot.computer ? 1 : 0).u8(slot.team).u8(slot.color).u8(slot.race).u8(slot.computerType).u8(slot.handicap);
  }
  return writer.u32(table.randomSeed).u8(table.layout).u8(table.players);
}

export function decodeSlotTable(reader: Reader): SlotTable {
  reader.u16();
  const count = reader.u8();
  const slots = Array.from({ length: count }, (): Slot => ({
    playerId: reader.u8(),
    download: reader.u8(),
    status: reader.u8(),
    computer: reader.u8() !== 0,
    team: reader.u8(),
    color: reader.u8(),
    race: reader.u8(),
    computerType: reader.u8(),
    handicap: reader.u8(),
  }));
  return { slots, randomSeed: reader.u32(), layout: reader.u8(), players: reader.u8() };
}

export const slotInfo = (table: SlotTable) => encodePacket(PACKET.SlotInfo, encodeSlotTable(new Writer(), table).bytes());

export const slotInfoJoin = (table: SlotTable, playerId: number, address: { readonly ip: readonly number[]; readonly port: number }) =>
  encodePacket(PACKET.SlotInfoJoin, sockAddr(encodeSlotTable(new Writer(), table).u8(playerId), address).bytes());



export interface ReqJoin {
  readonly hostCounter: number;
  readonly entryKey: number;
  readonly listenPort: number;
  readonly joinCounter: number;
  readonly name: string;
}

export function decodeReqJoin(payload: Uint8Array): ReqJoin {
  const reader = new Reader(payload);
  const hostCounter = reader.u32();
  const entryKey = reader.u32();
  reader.u8();
  const listenPort = reader.u16();
  const joinCounter = reader.u32();
  const name = reader.cstring();
  return { hostCounter, entryKey, listenPort, joinCounter, name };
}

export const playerInfo = (playerId: number, name: string) =>
  encodePacket(PACKET.PlayerInfo, sockAddr(sockAddr(new Writer().u32(1).u8(playerId).cstring(name).u8(2).u8(0).u8(0))).bytes());

export const rejectJoin = (reason: number) => encodePacket(PACKET.RejectJoin, new Writer().u32(reason).bytes());

// Protobuf messages (0x59): a type byte, a u32 length, then the message.

function varint(writer: Writer, value: number): Writer {
  let rest = value >>> 0;
  while (rest >= 0x80) {
    writer.u8((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  return writer.u8(rest);
}

function protoField(writer: Writer, field: number, value: number | string | Uint8Array): Writer {
  if (typeof value === "number") return varint(varint(writer, field << 3), value);
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return varint(varint(writer, (field << 3) | 2), bytes.length).raw(bytes);
}

const protobuf = (type: number, message: Uint8Array) => encodePacket(PACKET.ProtoBuf, new Writer().u8(type).u32(message.length).raw(message).bytes());


export const playerSkins = (playerId: number) => protobuf(PROTOBUF.PlayerSkins, protoField(new Writer(), 1, playerId).bytes());


export const playerProfile = (playerId: number, name: string) =>
  protobuf(PROTOBUF.PlayerProfile, protoField(protoField(protoField(new Writer(), 1, playerId), 2, name), 4, "p042").bytes());

export const protobufType = (payload: Uint8Array) => payload[0] ?? 0;



export interface MapCheck {
  readonly path: string;
  readonly size: number;
  readonly crc32: number;
  readonly xoro: number;
  readonly sha1: Uint8Array;
}

export const mapCheck = (map: MapCheck) =>
  encodePacket(PACKET.MapCheck, new Writer().u32(1).cstring(map.path).u32(map.size).u32(map.crc32).u32(map.xoro).raw(map.sha1).bytes());


export function decodeMapSize(payload: Uint8Array): { readonly flag: number; readonly size: number } {
  const reader = new Reader(payload);
  reader.u32();
  return { flag: reader.u8(), size: reader.u32() };
}




export const DEFAULT_GAME_FLAGS = 0x00000002 | 0x00000800 | 0x00001000 | 0x00003000 | 0x00004000 | 0x00060000;

// Stat strings encode seven bytes after an oddness mask; even bytes add one so no encoded byte is zero.



export function encodeStatString(source: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let block = 0; block < source.length; block += 7) {
    const chunk = source.subarray(block, block + 7);
    let mask = 1;
    const encoded = Array.from(chunk, (byte, index) => {
      if (byte % 2 === 0) return (byte + 1) & 0xff;
      mask |= 1 << (index + 1);
      return byte;
    });
    out.push(mask, ...encoded);
  }
  return Uint8Array.from(out);
}

export function decodeStatString(encoded: Uint8Array): Uint8Array {
  const out: number[] = [];
  let mask = 0;
  encoded.forEach((byte, index) => {
    if (index % 8 === 0) mask = byte;
    else out.push((mask & (1 << (index % 8))) === 0 ? (byte - 1) & 0xff : byte);
  });
  return Uint8Array.from(out);
}

export interface GameSettings {
  readonly flags: number;
  readonly width: number;
  readonly height: number;
  readonly xoro: number;
  readonly path: string;
  readonly hostName: string;
  readonly sha1: Uint8Array;
}


export function encodeGameSettings(settings: GameSettings): Uint8Array {
  const plain = new Writer().u32(settings.flags).u8(0).u16(settings.width).u16(settings.height).u32(settings.xoro).cstring(settings.path).cstring(settings.hostName).u8(0).raw(settings.sha1).bytes();
  return new Writer().raw(encodeStatString(plain)).u8(0).bytes();
}




export const PRODUCT = "PX3W";

export interface GameInfo {
  readonly product: string;
  readonly version: number;
  readonly hostCounter: number;
  readonly entryKey: number;
  readonly name: string;
  readonly settings: GameSettings;
  readonly slots: number;
  readonly openSlots: number;
  readonly uptimeSeconds: number;
  readonly port: number;
}


export const gameInfo = (info: GameInfo) =>
  encodePacket(PACKET.GameInfo, new Writer().raw(new TextEncoder().encode(info.product)).u32(info.version).u32(info.hostCounter).u32(info.entryKey)
    .cstring(info.name).u8(0).raw(encodeGameSettings(info.settings)).u32(info.slots).u32(0x00100000).u32(1).u32(info.openSlots).u32(info.uptimeSeconds).u16(info.port).bytes());

export function decodeSearchGame(payload: Uint8Array): { readonly product: string; readonly version: number } {
  const reader = new Reader(payload);
  return { product: new TextDecoder().decode(reader.take(4)), version: reader.u32() };
}



export const countDownStart = () => encodePacket(PACKET.CountDownStart);
export const countDownEnd = () => encodePacket(PACKET.CountDownEnd);
export const playerLoaded = (playerId: number) => encodePacket(PACKET.PlayerLoaded, new Writer().u8(playerId).bytes());
export const playerLeft = (playerId: number, reason: number) => encodePacket(PACKET.PlayerLeft, new Writer().u8(playerId).u32(reason).bytes());
export const leaveAck = () => encodePacket(PACKET.LeaveAck);
export const pingFromHost = (ticks: number) => encodePacket(PACKET.PingFromHost, new Writer().u32(ticks).bytes());

export const decodeLeaveReq = (payload: Uint8Array) => new Reader(payload).u32();



export interface PlayerAction {
  readonly playerId: number;
  readonly data: Uint8Array;
}


export function incomingAction(milliseconds: number, actions: readonly PlayerAction[]): Uint8Array {
  const writer = new Writer().u16(milliseconds);
  if (actions.length === 0) return encodePacket(PACKET.IncomingAction, writer.bytes());
  const body = new Writer();
  for (const { playerId, data } of actions) body.u8(playerId).u16(data.length).raw(data);
  const bytes = body.bytes();
  return encodePacket(PACKET.IncomingAction, writer.u16(crc32(bytes) & 0xffff).raw(bytes).bytes());
}

export function decodeIncomingAction(payload: Uint8Array): { readonly milliseconds: number; readonly actions: PlayerAction[] } {
  const reader = new Reader(payload);
  const milliseconds = reader.u16();
  const actions: PlayerAction[] = [];
  if (reader.remaining === 0) return { milliseconds, actions };
  const crc = reader.u16();
  if ((crc32(payload.subarray(4)) & 0xffff) !== crc) throw new Error("IncomingAction CRC16 mismatch");
  while (reader.remaining > 0) {
    const playerId = reader.u8();
    actions.push({ playerId, data: reader.take(reader.u16()) });
  }
  return { milliseconds, actions };
}


export function decodeOutgoingAction(payload: Uint8Array): Uint8Array {
  const reader = new Reader(payload);
  const crc = reader.u32();
  const data = reader.rest();
  if (crc32(data) !== crc) throw new Error("OutgoingAction CRC32 mismatch");
  return data;
}

export const outgoingAction = (data: Uint8Array) => encodePacket(PACKET.OutgoingAction, new Writer().u32(crc32(data)).raw(data).bytes());


export function decodeKeepAlive(payload: Uint8Array): number {
  const reader = new Reader(payload);
  reader.u8();
  return reader.u32();
}



export const CHAT = { Chat: 0x10, TeamChange: 0x11, ColorChange: 0x12, RaceChange: 0x13, HandicapChange: 0x14, Scoped: 0x20 } as const;

export interface Chat {
  readonly to: readonly number[];
  readonly from: number;
  readonly kind: number;

  readonly scope?: number;
  readonly text?: string;
  readonly value?: number;
}

export function decodeChat(payload: Uint8Array): Chat {
  const reader = new Reader(payload);
  const to = Array.from(reader.take(reader.u8()));
  const from = reader.u8();
  const kind = reader.u8();
  if (kind === CHAT.Chat) return { to, from, kind, text: reader.cstring() };
  if (kind === CHAT.Scoped) return { to, from, kind, scope: reader.u32(), text: reader.cstring() };
  return { to, from, kind, value: reader.u8() };
}


export function chatFromHost(chat: Chat): Uint8Array {
  const writer = new Writer().u8(chat.to.length).raw(chat.to).u8(chat.from).u8(chat.kind);
  if (chat.kind === CHAT.Chat) writer.cstring(chat.text ?? "");
  else if (chat.kind === CHAT.Scoped) writer.u32(chat.scope ?? 0).cstring(chat.text ?? "");
  else writer.u8(chat.value ?? 0);
  return encodePacket(PACKET.ChatFromHost, writer.bytes());
}
