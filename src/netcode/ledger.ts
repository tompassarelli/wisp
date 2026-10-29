import { at } from "../runtime/lookup";
import type { RowCodec } from "./codec";
import { type FrameRing, frameRing, ringRow, ringStore } from "./frameRing";

// Every client takes or refuses a row by the common confirmed frame alone, so all ledgers hold the same rows.
export const FUTURE_LIMIT = 128;
export const LEDGER_CAPACITY = 2 * FUTURE_LIMIT;

export type Receipt = "accepted" | "malformed" | "wrongSender" | "gone" | "outOfHistory" | "tooFarAhead" | "conflict";

export const STILL_PLAYING = 2147483647;

export interface InputLedger<Row> {
  readonly rings: readonly FrameRing<Row>[];
  readonly through: number[];
  readonly goneAfter: number[];
  readonly idle: Readonly<Row>;
}

export function inputLedger<Row>(codec: RowCodec<Row>, players: number, seeded: number): InputLedger<Row> {
  const rings: FrameRing<Row>[] = [];
  const through: number[] = [];
  const goneAfter: number[] = [];
  const neutral = codec.neutral();
  for (let player = 0; player < players; player++) {
    const ring = frameRing(codec, LEDGER_CAPACITY);
    for (let frame = 1; frame <= seeded; frame++) ringStore(codec, ring, frame, neutral);
    rings.push(ring);
    through.push(seeded);
    goneAfter.push(STILL_PLAYING);
  }
  return { rings, through, goneAfter, idle: neutral };
}

export function isPlaying<Row>(ledger: InputLedger<Row>, player: number): boolean {
  return at(ledger.goneAfter, player) === STILL_PLAYING;
}

export function knownThrough<Row>(ledger: InputLedger<Row>): number {
  let known = STILL_PLAYING;
  let latest = 0;
  for (let player = 0; player < ledger.through.length; player++) {
    const through = at(ledger.through, player);
    if (through > latest) latest = through;
    if (isPlaying(ledger, player) && through < known) known = through;
  }
  return known === STILL_PLAYING ? latest : known;
}

export function acceptedRow<Row>(ledger: InputLedger<Row>, player: number, frame: number): Readonly<Row> | undefined {
  return frame > at(ledger.goneAfter, player) ? ledger.idle : ringRow(at(ledger.rings, player), frame);
}

export function leaveLedger<Row>(ledger: InputLedger<Row>, player: number): number {
  if (isPlaying(ledger, player)) ledger.goneAfter[player] = at(ledger.through, player);
  return at(ledger.goneAfter, player);
}

export function acceptRows<Row>(codec: RowCodec<Row>, ledger: InputLedger<Row>, sender: number, firstFrame: number, rows: readonly Row[], count: number, confirmed: number): Receipt {
  const ring = ledger.rings[sender];
  if (ring === undefined) return "wrongSender";
  if (!isPlaying(ledger, sender)) return "gone";
  for (let index = 0; index < count; index++) {
    const frame = firstFrame + index;
    if (frame > confirmed + FUTURE_LIMIT) return "tooFarAhead";
    if (frame <= confirmed + FUTURE_LIMIT - LEDGER_CAPACITY) return "outOfHistory";
    const stored = ringRow(ring, frame);
    if (stored !== undefined && !codec.same(stored, at(rows, index))) return "conflict";
  }
  for (let index = 0; index < count; index++) ringStore(codec, ring, firstFrame + index, at(rows, index));
  let through = at(ledger.through, sender);
  while (ringRow(ring, through + 1) !== undefined) through++;
  ledger.through[sender] = through;
  return "accepted";
}
