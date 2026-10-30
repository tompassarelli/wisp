// Rollback input on top of the fixed schedule. A speculative cursor F runs on the local row and predictions of late remote rows, up to `window` frames past the last frame every remote row has arrived through. A confirmed cursor runs only on accepted rows, through min(K, F - 1), where K is the common frontier. The common ledger owns synchronized rows and the confirmed cursor; local samples and predictions stay private to this client.
import { at } from "../runtime/lookup";
import { Capture } from "./capture";
import type { RowCodec } from "./codec";
import { type FixedSchedule, beginFixedEpoch, captureTarget, completeFixed, fixedSchedule, readFixed } from "./fixedSchedule";
import { type FrameRing, frameRing, ringClear, ringRelease, ringRow, ringStore, ringVacant } from "./frameRing";
import { FUTURE_LIMIT, LAST_FRAME, NO_EPOCH, NO_FRAME, type Receipt, acceptRows, acceptedRow, isActive, isPlaying, ledgerCapacity, takeLowestAccepted } from "./ledger";

export type Resolution = "accepted" | "speculative";

export interface ShadowSchedule<Row> {
  readonly codec: RowCodec<Row>;
  readonly fixed: FixedSchedule<Row>;
  readonly pending: FrameRing<Row>;
  readonly previous: Row[];
  readonly history: number;
  readonly correction: number;
  epoch: number;
  delay: number;
  window: number;
  nextSpeculative: number;
  nextConfirmed: number;
  preparedSpeculative: number | undefined;
  preparedConfirmed: number | undefined;
  acceptedPackets: number;
}

// `correction` is the deepest rollback a schedule supports and `history` how many consumed frames it keeps.
export function shadowSchedule<Row>(codec: RowCodec<Row>, players: number, history: number, correction: number): ShadowSchedule<Row> {
  const previous: Row[] = [];
  for (let slot = 0; slot < players; slot++) previous.push(codec.neutral());
  return {
    codec, fixed: fixedSchedule(codec, players, history), pending: frameRing(codec, ledgerCapacity(history)), previous, history, correction,
    epoch: NO_EPOCH, delay: 0, window: 0, nextSpeculative: 1, nextConfirmed: 1, preparedSpeculative: undefined, preparedConfirmed: undefined, acceptedPackets: 0,
  };
}

// The input delays a schedule supports: any the ledger's future limit holds beside the deepest prediction window and the row captured after it.
export function maxInputDelay(correction: number): number {
  return FUTURE_LIMIT - correction - 2;
}

// D and R hold for the whole epoch; `correction` bounds R.
export function beginShadowEpoch<Row>(schedule: ShadowSchedule<Row>, epoch: number, delay: number, window: number, participants: number): boolean {
  if (epoch <= schedule.epoch || window < 1 || window > schedule.correction || delay > maxInputDelay(schedule.correction)) return false;
  if (!beginFixedEpoch(schedule.fixed, epoch, delay, participants)) return false;
  schedule.epoch = epoch;
  schedule.delay = delay;
  schedule.window = window;
  schedule.nextSpeculative = 1;
  schedule.nextConfirmed = 1;
  schedule.preparedSpeculative = undefined;
  schedule.preparedConfirmed = undefined;
  ringClear(schedule.pending);
  for (const row of schedule.previous) schedule.codec.copy(row, schedule.codec.neutral());
  return true;
}

export function knownFrame<Row>(schedule: ShadowSchedule<Row>): number {
  return schedule.fixed.ledger.known;
}

// The last frame the confirmed cursor may run: min(K, F - 1).
export function confirmedLimit<Row>(schedule: ShadowSchedule<Row>): number {
  return Math.min(knownFrame(schedule), schedule.nextSpeculative - 1);
}

// The active slots whose row for K + 1 has not arrived: the players the confirmed match waits for.
export function awaitedSlots<Row>(schedule: ShadowSchedule<Row>): number {
  const ledger = schedule.fixed.ledger;
  const frame = ledger.known + 1;
  let slots = 0;
  for (let slot = 0; slot < ledger.rings.length; slot++) {
    if (isActive(ledger, slot) && acceptedRow(ledger, slot, frame) === undefined) slots |= 1 << slot;
  }
  return slots;
}

// From `frame`, the last frame through which some playing slot other than `local` has rows accepted.
export function othersThrough<Row>(schedule: ShadowSchedule<Row>, local: number, frame: number): number {
  const ledger = schedule.fixed.ledger;
  let through = frame;
  for (let slot = 0; slot < ledger.rings.length; slot++) {
    if (slot === local || !isPlaying(ledger, slot)) continue;
    while (through < LAST_FRAME && ringRow(at(ledger.rings, slot), through + 1) !== undefined) through++;
  }
  return through;
}

// The last frame through which every playing slot but `local` has rows accepted: what a prediction can't have to correct. NO_FRAME when no remote plays.
export function remoteThrough<Row>(schedule: ShadowSchedule<Row>, local: number): number {
  const ledger = schedule.fixed.ledger;
  let through = NO_FRAME;
  for (let slot = 0; slot < ledger.rings.length; slot++) {
    const accepted = at(ledger.through, slot);
    if (slot !== local && isPlaying(ledger, slot) && accepted < through) through = accepted;
  }
  return through;
}

function captureInto<Row>(schedule: ShadowSchedule<Row>, frame: number, sample: Readonly<Row>): Capture {
  if (ringRow(schedule.pending, frame) !== undefined) return Capture.alreadyCaptured;
  if (!ringVacant(schedule.pending, frame)) return Capture.pendingFull;
  ringStore(schedule.codec, schedule.pending, frame, sample);
  return Capture.captured;
}

// Assigns a polled sample to F + D. Capture never moves K or either cursor, and a repeated poll cannot rewrite an assigned row.
export function captureLocal<Row>(schedule: ShadowSchedule<Row>, epoch: number, sample: Readonly<Row>): Capture {
  if (epoch !== schedule.epoch) return Capture.wrongEpoch;
  const target = captureTarget(schedule.nextSpeculative, schedule.delay);
  return target === undefined ? Capture.frameExhausted : captureInto(schedule, target, sample);
}

// Assigns a sample to the frame its producer chose, delay included. Storage is bounded by the retained history and the future limit.
export function captureLocalAt<Row>(schedule: ShadowSchedule<Row>, epoch: number, frame: number, sample: Readonly<Row>): Capture {
  if (epoch !== schedule.epoch) return Capture.wrongEpoch;
  if (frame < 1 || frame > LAST_FRAME) return Capture.frameExhausted;
  const firstRetained = schedule.fixed.ledger.retainedFrom;
  if (frame < firstRetained) return Capture.outOfHistory;
  if (frame - (schedule.nextConfirmed - 1) > FUTURE_LIMIT) return Capture.tooFarAhead;
  if (frame - firstRetained >= schedule.pending.frames.length) return Capture.pendingFull;
  const assigned = ringRow(schedule.pending, frame);
  if (assigned !== undefined) return schedule.codec.same(assigned, sample) ? Capture.alreadyCaptured : Capture.conflict;
  return captureInto(schedule, frame, sample);
}

// Synchronized receipt, with the sender slot from the receive event. A local send is not receipt; only its echo is.
export function acceptSynchronized<Row>(schedule: ShadowSchedule<Row>, sender: number, firstFrame: number, rows: readonly Row[], count: number): Receipt {
  const receipt = acceptRows(schedule.fixed.ledger, sender, schedule.epoch, firstFrame, rows, count);
  if (receipt === "accepted") schedule.acceptedPackets++;
  return receipt;
}

// The first frame this sender's newly accepted rows touch, NO_FRAME when none; starts afresh.
export function lateFrom<Row>(schedule: ShadowSchedule<Row>, sender: number): number {
  return takeLowestAccepted(schedule.fixed.ledger, sender);
}

// F may run while it is within R frames past the last frame every remote row has arrived through, and while the ledger will admit the local row captured after it: alone against computers, a late echo otherwise let prediction capture rows the ledger refused, stalling the match for good.
export function mayAdvanceSpeculative<Row>(schedule: ShadowSchedule<Row>, local: number): boolean {
  return schedule.epoch !== NO_EPOCH && schedule.nextSpeculative <= LAST_FRAME
    && schedule.nextSpeculative - schedule.window <= remoteThrough(schedule, local)
    && schedule.nextSpeculative + 1 + schedule.delay - (schedule.nextConfirmed - 1) <= FUTURE_LIMIT;
}

// Whether the local player's row for F is accepted or captured: prediction has local rows it hasn't run. A schedule with no local player has none to wait for.
export function hasLocalRow<Row>(schedule: ShadowSchedule<Row>, local: number): boolean {
  const frame = schedule.nextSpeculative;
  return local < 0 || (schedule.epoch !== NO_EPOCH && (acceptedRow(schedule.fixed.ledger, local, frame) !== undefined || ringRow(schedule.pending, frame) !== undefined));
}

export function mayAdvanceSpeculativeFor<Row>(schedule: ShadowSchedule<Row>, local: number): boolean {
  return (local < 0 || isActive(schedule.fixed.ledger, local)) && mayAdvanceSpeculative(schedule, local) && hasLocalRow(schedule, local);
}

// Whether the local row for F is ready and prediction waits only for a remote row R frames behind it.
export function windowHalted<Row>(schedule: ShadowSchedule<Row>, local: number): boolean {
  return schedule.epoch !== NO_EPOCH && (local < 0 || isActive(schedule.fixed.ledger, local)) && schedule.nextSpeculative <= LAST_FRAME
    && hasLocalRow(schedule, local) && !mayAdvanceSpeculative(schedule, local);
}

// Fills every active slot for F. Accepted input wins; otherwise the local player uses its captured row and remote players are predicted from their previous row. Only a prediction makes the frame speculative.
export function resolveSpeculative<Row>(schedule: ShadowSchedule<Row>, epoch: number, local: number, inputs: Row[]): Resolution | undefined {
  if (epoch !== schedule.epoch || schedule.preparedSpeculative !== undefined || !mayAdvanceSpeculativeFor(schedule, local)) return undefined;
  const codec = schedule.codec;
  const ledger = schedule.fixed.ledger;
  const frame = schedule.nextSpeculative;
  let resolution: Resolution = "accepted";
  for (let slot = 0; slot < inputs.length; slot++) {
    if (!isActive(ledger, slot)) continue;
    const target = at(inputs, slot);
    const previous = at(schedule.previous, slot);
    const accepted = acceptedRow(ledger, slot, frame);
    if (accepted !== undefined) {
      codec.copy(target, accepted);
    } else if (slot === local) {
      const captured = ringRow(schedule.pending, frame);
      if (captured === undefined) throw new Error(`local input for frame ${frame} was never captured`);
      codec.copy(target, captured);
    } else {
      resolution = "speculative";
      codec.hold(target, previous);
    }
    codec.copy(previous, target);
  }
  schedule.preparedSpeculative = frame;
  return resolution;
}

// Call after the resolved row is recorded and executed. The local row stays until K confirms it.
export function completeSpeculative<Row>(schedule: ShadowSchedule<Row>, epoch: number, frame: number): boolean {
  if (epoch !== schedule.epoch || frame !== schedule.nextSpeculative || frame !== schedule.preparedSpeculative) return false;
  schedule.preparedSpeculative = undefined;
  schedule.nextSpeculative++;
  return true;
}

// Moves F back to `frame`, never before the confirmed cursor; the frames after it run again.
export function rewindSpeculative<Row>(schedule: ShadowSchedule<Row>, epoch: number, frame: number): boolean {
  if (epoch !== schedule.epoch || schedule.preparedSpeculative !== undefined || frame < schedule.nextConfirmed) return false;
  if (frame < schedule.nextSpeculative) schedule.nextSpeculative = frame;
  return true;
}

// Replaces a slot's prediction basis after a correction rebuilt its rows.
export function rememberResolvedInput<Row>(schedule: ShadowSchedule<Row>, slot: number, row: Readonly<Row>): boolean {
  if (!isActive(schedule.fixed.ledger, slot)) return false;
  schedule.codec.copy(at(schedule.previous, slot), row);
  return true;
}

export function mayAdvanceConfirmed<Row>(schedule: ShadowSchedule<Row>): boolean {
  return schedule.epoch !== NO_EPOCH && schedule.nextConfirmed <= confirmedLimit(schedule);
}

export function readConfirmed<Row>(schedule: ShadowSchedule<Row>, epoch: number, inputs: Row[]): boolean {
  if (epoch !== schedule.epoch || schedule.preparedConfirmed !== undefined || !mayAdvanceConfirmed(schedule)) return false;
  const frame = schedule.nextConfirmed;
  if (!readFixed(schedule.fixed, epoch, inputs)) return false;
  schedule.preparedConfirmed = frame;
  return true;
}

// Call after the accepted rows ran in a confirmed world distinct from the speculative one. Completion advances the common ledger's cursor.
export function completeConfirmed<Row>(schedule: ShadowSchedule<Row>, epoch: number, frame: number): boolean {
  if (epoch !== schedule.epoch || frame !== schedule.nextConfirmed || frame !== schedule.preparedConfirmed) return false;
  if (!completeFixed(schedule.fixed, epoch, frame)) return false;
  schedule.preparedConfirmed = undefined;
  schedule.nextConfirmed++;
  const expired = frame - schedule.history;
  if (expired >= 1) ringRelease(schedule.pending, expired);
  return true;
}

// The local sample assigned to frame, kept until its frame leaves the history.
export function pendingRow<Row>(schedule: ShadowSchedule<Row>, epoch: number, frame: number): Readonly<Row> | undefined {
  return epoch !== schedule.epoch || frame < 1 || frame > LAST_FRAME ? undefined : ringRow(schedule.pending, frame);
}
