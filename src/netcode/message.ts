import { at } from "../runtime/lookup";
import { type RowCodec, holds } from "./codec";
import { WIRE_MAX_VALUE, atEnd, readVarint, varint, wireReader } from "./wire";

// BlzSendSyncData carries about 255 bytes of prefix and data together; 200 leaves room for the prefix.
export const MESSAGE_MAX_BYTES = 200;
export const MESSAGE_MAX_FRAMES = 64;

export interface EncodedMessage {
  readonly wire: string;
  readonly lastFrame: number;
}

export interface DecodedMessage {
  readonly firstFrame: number;
  readonly count: number;
}

export function encodeMessage<Row>(codec: RowCodec<Row>, firstFrame: number, lastFrame: number, rowAt: (this: void, frame: number) => Readonly<Row>): EncodedMessage {
  const head = varint(firstFrame);
  const scratch = codec.neutral();
  let previous = rowAt(firstFrame);
  let body = codec.write(previous, codec.neutral());
  let skipped = 0;
  let last = firstFrame;
  const fits = (frames: number, extra: number) => head.length + varint(frames).length + body.length + extra <= MESSAGE_MAX_BYTES;
  for (let frame = firstFrame + 1; frame <= lastFrame && frame - firstFrame < MESSAGE_MAX_FRAMES; frame++) {
    const row = rowAt(frame);
    const frames = frame - firstFrame + 1;
    if (holds(codec, row, previous, scratch)) {
      if (!fits(frames, 0)) break;
      skipped++;
    } else {
      const record = varint(skipped) + codec.write(row, previous);
      if (!fits(frames, record.length)) break;
      body += record;
      skipped = 0;
      previous = row;
    }
    last = frame;
  }
  return { wire: `${head}${varint(last - firstFrame + 1)}${body}`, lastFrame: last };
}

export function decodeMessage<Row>(codec: RowCodec<Row>, wire: string, rows: readonly Row[]): DecodedMessage | undefined {
  if (wire.length > MESSAGE_MAX_BYTES || rows.length < MESSAGE_MAX_FRAMES) return undefined;
  const reader = wireReader(wire, 0);
  const firstFrame = readVarint(reader, WIRE_MAX_VALUE);
  const count = readVarint(reader, MESSAGE_MAX_FRAMES);
  if (firstFrame === undefined || count === undefined || firstFrame < 1 || count < 1 || firstFrame > WIRE_MAX_VALUE - (count - 1)) return undefined;
  const scratch = codec.neutral();
  if (!codec.read(reader, codec.neutral(), at(rows, 0))) return undefined;
  let previous = at(rows, 0);
  let filled = 1;
  while (!atEnd(reader)) {
    const skipped = readVarint(reader, MESSAGE_MAX_FRAMES);
    if (skipped === undefined || filled + skipped >= count) return undefined;
    for (let index = 0; index < skipped; index++) codec.hold(at(rows, filled++), previous);
    const row = at(rows, filled);
    if (!codec.read(reader, previous, row) || holds(codec, row, previous, scratch)) return undefined;
    filled++;
    previous = row;
  }
  while (filled < count) codec.hold(at(rows, filled++), previous);
  return { firstFrame, count };
}
