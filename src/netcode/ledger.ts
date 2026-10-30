import { at } from "../runtime/lookup";
import type { RowCodec } from "./codec";
import { type FrameRing, frameRing, ringClear, ringRelease, ringRow, ringStore, ringVacant } from "./frameRing";
import { WIRE_MAX_VALUE } from "./wire";

// Every client takes or refuses a row by the common frontier K alone, so all ledgers hold the same rows.
export const FUTURE_LIMIT = 128;
export const LAST_FRAME = WIRE_MAX_VALUE;
export const NO_FRAME = LAST_FRAME + 1;
export const NO_EPOCH = -1;
export const STILL_PLAYING = 2147483647;

export type Receipt = "accepted" | "malformed" | "wrongEpoch" | "wrongSender" | "gone" | "outOfHistory" | "tooFarAhead" | "conflict" | "storageFull";

// Retained history, then K at most FUTURE_LIMIT past a participant's own confirmed frame, then rows FUTURE_LIMIT past K: an admissible row always has room.
export function ledgerCapacity(history: number): number {
  return history + 2 * FUTURE_LIMIT;
}

export interface InputLedger<Row> {
  readonly codec: RowCodec<Row>;
  readonly rings: readonly FrameRing<Row>[];
  readonly through: number[];
  readonly goneAfter: number[];
  readonly lowestAccepted: number[];
  readonly idle: Readonly<Row>;
  epoch: number;
  participants: number;
  retainedFrom: number;
  consumed: number;
  known: number;
}

export function inputLedger<Row>(codec: RowCodec<Row>, players: number, history: number): InputLedger<Row> {
  const rings: FrameRing<Row>[] = [];
  const through: number[] = [];
  const goneAfter: number[] = [];
  const lowestAccepted: number[] = [];
  for (let player = 0; player < players; player++) {
    rings.push(frameRing(codec, ledgerCapacity(history)));
    through.push(0);
    goneAfter.push(STILL_PLAYING);
    lowestAccepted.push(NO_FRAME);
  }
  return { codec, rings, through, goneAfter, lowestAccepted, idle: codec.neutral(), epoch: NO_EPOCH, participants: 0, retainedFrom: 1, consumed: 0, known: 0 };
}

export function allParticipants(players: number): number {
  return (1 << players) - 1;
}

export function isActive<Row>(ledger: InputLedger<Row>, player: number): boolean {
  return player >= 0 && player < ledger.rings.length && (ledger.participants & (1 << player)) !== 0;
}

export function isPlaying<Row>(ledger: InputLedger<Row>, player: number): boolean {
  return isActive(ledger, player) && at(ledger.goneAfter, player) === STILL_PLAYING;
}

// Starts an epoch at firstFrame and seeds its first `delay` frames with neutral rows, the frames no sample can reach. Epochs only increase.
export function beginEpoch<Row>(ledger: InputLedger<Row>, epoch: number, firstFrame: number, delay: number, participants: number): boolean {
  const players = ledger.rings.length;
  if (participants < 0 || participants > allParticipants(players) || epoch < 0 || epoch <= ledger.epoch) return false;
  if (firstFrame < 1 || firstFrame > LAST_FRAME || delay < 0 || delay > FUTURE_LIMIT || (delay > 0 && firstFrame > LAST_FRAME - (delay - 1))) return false;
  ledger.participants = participants;
  ledger.epoch = epoch;
  ledger.retainedFrom = firstFrame;
  ledger.consumed = firstFrame - 1;
  ledger.known = delay > 0 ? firstFrame + delay - 1 : firstFrame - 1;
  const neutral = ledger.codec.neutral();
  for (let player = 0; player < players; player++) {
    ringClear(at(ledger.rings, player));
    ledger.goneAfter[player] = STILL_PLAYING;
    ledger.lowestAccepted[player] = NO_FRAME;
    ledger.through[player] = ledger.known;
    if (!isActive(ledger, player)) continue;
    for (let index = 0; index < delay; index++) ringStore(ledger.codec, at(ledger.rings, player), firstFrame + index, neutral);
  }
  return true;
}

// K: the lowest frontier among the players still playing, or the highest of all once none is.
function frontier<Row>(ledger: InputLedger<Row>): number {
  let known = STILL_PLAYING;
  let latest = 0;
  for (let player = 0; player < ledger.through.length; player++) {
    if (!isActive(ledger, player)) continue;
    const through = at(ledger.through, player);
    if (through > latest) latest = through;
    if (isPlaying(ledger, player) && through < known) known = through;
  }
  return known === STILL_PLAYING ? latest : known;
}

export function knownThrough<Row>(ledger: InputLedger<Row>): number {
  return ledger.known;
}

function advanceKnown<Row>(ledger: InputLedger<Row>): void {
  const known = frontier(ledger);
  if (known > ledger.known) ledger.known = known;
}

export function acceptedRow<Row>(ledger: InputLedger<Row>, player: number, frame: number): Readonly<Row> | undefined {
  if (!isActive(ledger, player) || frame < ledger.retainedFrom || frame > LAST_FRAME) return undefined;
  return frame > at(ledger.goneAfter, player) ? ledger.idle : ringRow(at(ledger.rings, player), frame);
}

export function leaveLedger<Row>(ledger: InputLedger<Row>, player: number): number {
  if (!isActive(ledger, player)) return STILL_PLAYING;
  if (isPlaying(ledger, player)) {
    ledger.goneAfter[player] = at(ledger.through, player);
    advanceKnown(ledger);
  }
  return at(ledger.goneAfter, player);
}

// Acknowledges common execution of the next frame, in order. Only this moves the retained history; remote rows advancing K never do.
export function markConsumed<Row>(ledger: InputLedger<Row>, epoch: number, frame: number): boolean {
  if (epoch !== ledger.epoch || frame > ledger.known || frame !== ledger.consumed + 1) return false;
  ledger.consumed = frame;
  return true;
}

// Forgets consumed frames through `frame`.
export function discardThrough<Row>(ledger: InputLedger<Row>, epoch: number, frame: number): boolean {
  if (epoch !== ledger.epoch || frame < ledger.retainedFrom - 1 || frame > ledger.consumed) return false;
  for (let old = ledger.retainedFrom; old <= frame; old++) {
    for (const ring of ledger.rings) ringRelease(ring, old);
  }
  ledger.retainedFrom = frame + 1;
  return true;
}

function check<Row>(ledger: InputLedger<Row>, ring: FrameRing<Row>, frame: number, row: Readonly<Row>): Receipt {
  if (frame < ledger.retainedFrom) return "outOfHistory";
  if (frame - ledger.known > FUTURE_LIMIT) return "tooFarAhead";
  if (frame - ledger.retainedFrom >= ring.frames.length) return "storageFull";
  const stored = ringRow(ring, frame);
  if (stored !== undefined) return ledger.codec.same(stored, row) ? "accepted" : "conflict";
  return ringVacant(ring, frame) ? "accepted" : "storageFull";
}

// A row once accepted never changes: a duplicate is accepted again and a different row for the same frame is a conflict. A packet's rows are accepted together or not at all.
export function acceptRows<Row>(ledger: InputLedger<Row>, sender: number, epoch: number, firstFrame: number, rows: readonly Row[], count: number): Receipt {
  const ring = ledger.rings[sender];
  if (ring === undefined || !isActive(ledger, sender)) return "wrongSender";
  if (count < 1 || firstFrame < 1 || firstFrame > LAST_FRAME - (count - 1)) return "malformed";
  if (epoch !== ledger.epoch) return "wrongEpoch";
  if (!isPlaying(ledger, sender)) return "gone";
  for (let index = 0; index < count; index++) {
    const receipt = check(ledger, ring, firstFrame + index, at(rows, index));
    if (receipt !== "accepted") return receipt;
  }
  for (let index = 0; index < count; index++) ringStore(ledger.codec, ring, firstFrame + index, at(rows, index));
  let through = at(ledger.through, sender);
  while (through < LAST_FRAME && ringRow(ring, through + 1) !== undefined) through++;
  ledger.through[sender] = through;
  advanceKnown(ledger);
  if (firstFrame < at(ledger.lowestAccepted, sender)) ledger.lowestAccepted[sender] = firstFrame;
  return "accepted";
}

// The first frame this sender's newly accepted rows touch, NO_FRAME when none; starts afresh. The one late-row signal.
export function takeLowestAccepted<Row>(ledger: InputLedger<Row>, sender: number): number {
  const lowest = at(ledger.lowestAccepted, sender);
  ledger.lowestAccepted[sender] = NO_FRAME;
  return lowest;
}
