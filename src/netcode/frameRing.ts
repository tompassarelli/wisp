import { at } from "../runtime/lookup";
import { floorMod } from "../sim/intMath";
import type { RowCodec } from "./codec";

export interface FrameRing<Row> {
  readonly frames: number[];
  readonly rows: readonly Row[];
}

export function frameRing<Row>(codec: RowCodec<Row>, capacity: number): FrameRing<Row> {
  const frames: number[] = [];
  const rows: Row[] = [];
  for (let slot = 0; slot < capacity; slot++) {
    frames.push(-1);
    rows.push(codec.neutral());
  }
  return { frames, rows };
}

export function ringRow<Row>(ring: FrameRing<Row>, frame: number): Readonly<Row> | undefined {
  const slot = floorMod(frame, ring.frames.length);
  return ring.frames[slot] === frame ? ring.rows[slot] : undefined;
}

export function ringStore<Row>(codec: RowCodec<Row>, ring: FrameRing<Row>, frame: number, row: Readonly<Row>): void {
  const slot = floorMod(frame, ring.frames.length);
  codec.copy(at(ring.rows, slot), row);
  ring.frames[slot] = frame;
}
