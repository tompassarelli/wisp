import { at } from "../runtime/lookup";
import { floorMod } from "../sim/intMath";
import type { RowCodec } from "./codec";

const VACANT = -1;

export interface FrameRing<Row> {
  readonly frames: number[];
  readonly rows: readonly Row[];
}

export function frameRing<Row>(codec: RowCodec<Row>, capacity: number): FrameRing<Row> {
  const frames: number[] = [];
  const rows: Row[] = [];
  for (let slot = 0; slot < capacity; slot++) {
    frames.push(VACANT);
    rows.push(codec.neutral());
  }
  return { frames, rows };
}

export function ringRow<Row>(ring: FrameRing<Row>, frame: number): Readonly<Row> | undefined {
  const slot = floorMod(frame, ring.frames.length);
  return ring.frames[slot] === frame ? ring.rows[slot] : undefined;
}

export function ringVacant<Row>(ring: FrameRing<Row>, frame: number): boolean {
  return at(ring.frames, floorMod(frame, ring.frames.length)) === VACANT;
}

export function ringStore<Row>(codec: RowCodec<Row>, ring: FrameRing<Row>, frame: number, row: Readonly<Row>): void {
  const slot = floorMod(frame, ring.frames.length);
  codec.copy(at(ring.rows, slot), row);
  ring.frames[slot] = frame;
}

export function ringRelease<Row>(ring: FrameRing<Row>, frame: number): void {
  ring.frames[floorMod(frame, ring.frames.length)] = VACANT;
}

export function ringClear<Row>(ring: FrameRing<Row>): void {
  for (let slot = 0; slot < ring.frames.length; slot++) ring.frames[slot] = VACANT;
}
