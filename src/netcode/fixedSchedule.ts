// Lockstep input with a fixed delay D: the sample taken while frame F is next belongs to frame F + D, and frame F runs only once every participant's row for F has arrived through the synchronized channel.
import { at } from "../runtime/lookup";
import { Capture } from "./capture";
import type { RowCodec } from "./codec";
import { type FrameRing, frameRing, ringClear, ringRelease, ringRow, ringStore, ringVacant } from "./frameRing";
import { type InputLedger, LAST_FRAME, NO_EPOCH, acceptedRow, beginEpoch, discardThrough, inputLedger, ledgerCapacity, markConsumed } from "./ledger";

export interface FixedSchedule<Row> {
  readonly codec: RowCodec<Row>;
  readonly ledger: InputLedger<Row>;
  readonly pending: FrameRing<Row>;
  readonly history: number;
  epoch: number;
  delay: number;
  next: number;
  prepared: number | undefined;
}

export function fixedSchedule<Row>(codec: RowCodec<Row>, players: number, history: number): FixedSchedule<Row> {
  return { codec, ledger: inputLedger(codec, players, history), pending: frameRing(codec, ledgerCapacity(history)), history, epoch: NO_EPOCH, delay: 0, next: 1, prepared: undefined };
}

export function beginFixedEpoch<Row>(schedule: FixedSchedule<Row>, epoch: number, delay: number, participants: number): boolean {
  if (!beginEpoch(schedule.ledger, epoch, 1, delay, participants)) return false;
  schedule.epoch = epoch;
  schedule.delay = delay;
  schedule.next = 1;
  schedule.prepared = undefined;
  ringClear(schedule.pending);
  return true;
}

// The frame a sample taken while `frame` is next belongs to, or undefined past the last frame.
export function captureTarget(frame: number, delay: number): number | undefined {
  return frame >= 1 && frame <= LAST_FRAME - delay ? frame + delay : undefined;
}

// Offer the local sample at every service opportunity, even while readNext waits. A repeat for the same target keeps the original row.
export function captureFixed<Row>(schedule: FixedSchedule<Row>, epoch: number, sample: Readonly<Row>): Capture {
  if (epoch !== schedule.epoch) return Capture.wrongEpoch;
  const target = captureTarget(schedule.next, schedule.delay);
  if (target === undefined) return Capture.frameExhausted;
  if (ringRow(schedule.pending, target) !== undefined) return Capture.alreadyCaptured;
  if (!ringVacant(schedule.pending, target)) return Capture.pendingFull;
  ringStore(schedule.codec, schedule.pending, target, sample);
  return Capture.captured;
}

export function fixedPending<Row>(schedule: FixedSchedule<Row>, epoch: number, frame: number): Readonly<Row> | undefined {
  if (epoch !== schedule.epoch || frame < schedule.ledger.retainedFrom || frame > LAST_FRAME) return undefined;
  return ringRow(schedule.pending, frame);
}

export function mayAdvanceFixed<Row>(schedule: FixedSchedule<Row>): boolean {
  return schedule.epoch !== NO_EPOCH && schedule.next <= LAST_FRAME && schedule.next <= schedule.ledger.known;
}

// Fills every slot with the next frame's accepted row. K proves every row is present before any target changes, so the read is all or nothing.
export function readFixed<Row>(schedule: FixedSchedule<Row>, epoch: number, inputs: Row[]): boolean {
  if (epoch !== schedule.epoch || !mayAdvanceFixed(schedule)) return false;
  for (let slot = 0; slot < inputs.length; slot++) {
    const row = acceptedRow(schedule.ledger, slot, schedule.next);
    if (row !== undefined) schedule.codec.copy(at(inputs, slot), row);
  }
  schedule.prepared = schedule.next;
  return true;
}

// Acknowledges common execution of the frame readFixed prepared, in order. The last `history` completed frames stay.
export function completeFixed<Row>(schedule: FixedSchedule<Row>, epoch: number, frame: number): boolean {
  if (epoch !== schedule.epoch || frame !== schedule.next || frame !== schedule.prepared) return false;
  if (!markConsumed(schedule.ledger, epoch, frame)) return false;
  schedule.prepared = undefined;
  schedule.next++;
  const expired = frame - schedule.history;
  if (expired >= schedule.ledger.retainedFrom) {
    ringRelease(schedule.pending, expired);
    discardThrough(schedule.ledger, epoch, expired);
  }
  return true;
}
