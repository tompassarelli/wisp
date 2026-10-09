// What a player's action block says, as one readable line per action
// (wisp:docs/lan.md, "The action log"). A block is the bytes one
// OutgoingAction carried: one or more game actions back to back, each an id
// byte and its fields. Layouts follow W3Champions' Flo (crates/w3gs
// src/actions.rs, MPL-2.0) and wc3-slop-lan's notes for the checked rollback build, where
// BlzSendSyncData is action 0x77. An id this decoder doesn't know ends the
// block's decoding; its remaining bytes are printed as hex.
import { Reader } from "./w3gs";

export interface DecodedAction {
  /** A short name: order, select, sync, chat, frame, key, ... */
  readonly kind: string;
  /** The fields, as `name=value` words. */
  readonly text: string;
  /** For sync data: its prefix and payload. */
  readonly sync?: { readonly prefix: string; readonly data: string };
}

export interface ActionRecord extends DecodedAction {
  readonly offset: number;
  readonly raw: string;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fourcc = (value: number) => {
  const text = String.fromCharCode((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  return /^[\x20-\x7e]{4}$/.test(text) ? text : `0x${value.toString(16)}`;
};
const tag = (reader: Reader) => `${reader.u32().toString(16)}:${reader.u32().toString(16)}`;
const point = (reader: Reader) => `${reader.f32().toFixed(1)},${reader.f32().toFixed(1)}`;
/** Escapes a string for one log line. */
export const quote = (text: string) => JSON.stringify(text);
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

function order(reader: Reader, id: number): string {
  const words = [`flags=0x${reader.u16().toString(16)}`, `order=${fourcc(reader.u32())}`, `unit=${tag(reader)}`];
  if (id >= 0x11) words.push(`at=${point(reader)}`);
  if (id === 0x12 || id === 0x13) words.push(`target=${tag(reader)}`);
  if (id === 0x13) words.push(`object2=${tag(reader)}`);
  if (id === 0x14 || id === 0x15) {
    words.push(`ghost=${fourcc(reader.u32())}`, `ghostFlags=0x${reader.u32().toString(16)}`, `ghostCategory=${reader.u32()}`, `ghostOwner=${reader.u8()}`, `ghostAt=${point(reader)}`);
    if (id === 0x15) words.push(`target=${tag(reader)}`);
  }
  return words.join(" ");
}

function objects(reader: Reader, count: number): string {
  return Array.from({ length: count }, () => tag(reader)).join(",");
}

function cache(reader: Reader): string {
  return `${quote(reader.cstring())}/${quote(reader.cstring())}/${quote(reader.cstring())}`;
}

/** Decodes one action at the reader; undefined when its id is unknown (the reader is left at the id). */
function decodeOne(reader: Reader): DecodedAction | undefined {
  const start = reader.offset;
  const id = reader.u8();
  switch (id) {
    case 0x01: return { kind: "pause", text: `noCommands=${reader.u8()}` };
    case 0x02: return { kind: "resume", text: "" };
    case 0x03: return { kind: "speed", text: `speed=${reader.u8()}` };
    case 0x04: return { kind: "speed", text: "faster" };
    case 0x05: return { kind: "speed", text: "slower" };
    case 0x06: return { kind: "save", text: `name=${quote(reader.cstring())} file=${quote(reader.cstring())} quick=${reader.u8()}` };
    case 0x07: return { kind: "saved", text: `success=${reader.u32()}` };
    case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15:
      return { kind: "order", text: order(reader, id) };
    case 0x16: { const mode = reader.u8(); const count = reader.u16(); return { kind: "select", text: `mode=${mode} units=${objects(reader, count)}` }; }
    case 0x17: { const group = reader.u8(); const count = reader.u16(); return { kind: "group", text: `assign=${group} units=${objects(reader, count)}` }; }
    case 0x18: return { kind: "group", text: `select=${reader.u8()} op=${reader.u8()}` };
    case 0x19: return { kind: "subgroup", text: `item=${fourcc(reader.u32())} object=${tag(reader)}` };
    case 0x1a: return { kind: "subgroup", text: "refresh" };
    case 0x1b: return { kind: "select", text: `event op=${reader.u8()} object=${tag(reader)}` };
    case 0x1c: return { kind: "select", text: `modify op=${reader.u8()} object=${tag(reader)}` };
    case 0x1d: return { kind: "revive", text: `cancel hero=${tag(reader)}` };
    case 0x1e: return { kind: "queue", text: `remove slot=${reader.u8()} item=${fourcc(reader.u32())}` };
    case 0x50: return { kind: "ally", text: `slot=${reader.u8()} flags=0x${reader.u32().toString(16)}` };
    case 0x51: return { kind: "transfer", text: `slot=${reader.u8()} gold=${reader.u32()} lumber=${reader.u32()}` };
    case 0x60: return { kind: "chat", text: `trigger=${tag(reader)} text=${quote(latin1(reader.cbytes()))}` };
    case 0x61: return { kind: "escape", text: "" };
    case 0x62: return { kind: "trigger", text: `resume=${tag(reader)} sleep=${reader.u32()}` };
    case 0x63: return { kind: "trigger", text: `syncReady=${tag(reader)}` };
    case 0x64: return { kind: "trackable", text: `hit=${tag(reader)}` };
    case 0x65: return { kind: "trackable", text: `track=${tag(reader)}` };
    case 0x66: return { kind: "menu", text: "hero skills" };
    case 0x67: return { kind: "menu", text: "build" };
    case 0x68: return { kind: "ping", text: `at=${point(reader)} seconds=${reader.f32().toFixed(2)}` };
    case 0x69: return { kind: "dialog", text: `button=${tag(reader)} ${tag(reader)}` };
    case 0x6a: return { kind: "dialog", text: `click=${tag(reader)} ${tag(reader)}` };
    case 0x6b: return { kind: "cache", text: `store integer ${cache(reader)}=${reader.u32() | 0}` };
    case 0x6c: return { kind: "cache", text: `store real ${cache(reader)}=${reader.f32()}` };
    case 0x6d: return { kind: "cache", text: `store boolean ${cache(reader)}=${reader.u32()}` };
    case 0x70: return { kind: "cache", text: `clear integer ${cache(reader)}` };
    case 0x71: return { kind: "cache", text: `clear real ${cache(reader)}` };
    case 0x72: return { kind: "cache", text: `clear boolean ${cache(reader)}` };
    case 0x73: return { kind: "cache", text: `clear unit ${cache(reader)}` };
    case 0x75: return { kind: "arrow", text: `event=${reader.u8()}` };
    case 0x76: return { kind: "mouse", text: `event=${reader.u8()} at=${point(reader)} button=${reader.u8()}` };
    case 0x77: {
      const prefix = latin1(reader.cbytes());
      const data = latin1(reader.cbytes());
      const fromServer = reader.u32();
      return { kind: "sync", text: `prefix=${quote(prefix)} bytes=${data.length} data=${quote(data)}${fromServer === 0 ? "" : ` fromServer=${fromServer}`}`, sync: { prefix, data } };
    }
    case 0x78: return { kind: "frame", text: `frame=${tag(reader)} event=${reader.u32()} value=${reader.f32()} text=${quote(latin1(reader.cbytes()))}` };
    case 0x79: return { kind: "key", text: `object=${tag(reader)} event=${reader.u32()} key=${reader.u32()} meta=${reader.u32()}` };
    case 0x7a: return { kind: "command", text: `object=${tag(reader)} ability=${fourcc(reader.u32())} order=${reader.u32()}` };
    default:
      reader.offset = start;
      return undefined;
  }
}

/** Every action in one player's block; an unknown id or a short field ends it with a `raw` action. */
export function decodeActions(block: Uint8Array): DecodedAction[] {
  return decodeActionRecords(block).map(({ offset, raw, ...action }) => action);
}

/** Byte offsets are relative to the player's original action block. */
export function decodeActionRecords(block: Uint8Array): ActionRecord[] {
  const reader = new Reader(block);
  const actions: ActionRecord[] = [];
  while (reader.remaining > 0) {
    const start = reader.offset;
    let action: DecodedAction | undefined;
    try {
      action = decodeOne(reader);
    } catch {
      reader.offset = start;
      action = undefined;
    }
    if (action === undefined) {
      actions.push({ kind: "raw", text: `id=0x${(block[start] ?? 0).toString(16)} bytes=${hex(block.subarray(start))}`, offset: start, raw: hex(block.subarray(start)) });
      break;
    }
    actions.push({ ...action, offset: start, raw: hex(block.subarray(start, reader.offset)) });
  }
  return actions;
}
