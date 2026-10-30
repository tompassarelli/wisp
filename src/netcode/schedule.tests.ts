import { assertDefined, assertEquals, assertFalse, assertTrue, test } from "../runtime/testing";
import { Capture } from "./capture";
import { frameRing, ringClear, ringRelease, ringRow, ringStore, ringVacant } from "./frameRing";
import { beginFixedEpoch, captureFixed, completeFixed, fixedSchedule, readFixed } from "./fixedSchedule";
import { FUTURE_LIMIT, NO_FRAME, acceptRows, acceptedRow, allParticipants, beginEpoch, discardThrough, inputLedger, knownThrough, leaveLedger, markConsumed, takeLowestAccepted } from "./ledger";
import { TOY_CODEC, type ToyRow, toyRow } from "./rowCodec.tests";
import {
  acceptSynchronized, awaitedSlots, beginShadowEpoch, captureLocal, captureLocalAt, completeConfirmed, completeSpeculative, confirmedLimit, mayAdvanceConfirmed, mayAdvanceSpeculative, pendingRow,
  readConfirmed, resolveSpeculative, rewindSpeculative, shadowSchedule, windowHalted,
} from "./shadowSchedule";

const HISTORY = 8;

function moving(move: number): ToyRow {
  return { move, fire: 0, aim: 0 };
}

function span(first: number, count: number, move: number): ToyRow[] {
  const made: ToyRow[] = [];
  for (let index = 0; index < count; index++) made.push(moving(move + index));
  return made;
}

function started(players: number, delay: number) {
  const ledger = inputLedger(TOY_CODEC, players, HISTORY);
  assertTrue(beginEpoch(ledger, 0, 1, delay, allParticipants(players)));
  return ledger;
}

test("[scenario] frame ring: a released or cleared slot is vacant, a stored one is not", () => {
  const ring = frameRing(TOY_CODEC, 4);
  assertTrue(ringVacant(ring, 6));
  ringStore(TOY_CODEC, ring, 6, moving(3));
  assertFalse(ringVacant(ring, 2));
  assertEquals(ringRow(ring, 6)?.move, 3);
  assertEquals(ringRow(ring, 2), undefined);
  ringRelease(ring, 6);
  assertTrue(ringVacant(ring, 6));
  ringStore(TOY_CODEC, ring, 7, moving(1));
  ringClear(ring);
  assertTrue(ringVacant(ring, 7));
});

test("[scenario] ledger: rows are admitted against K and the retained history, a packet all or nothing, and one late-row signal per take", () => {
  const ledger = started(2, 2);
  assertEquals(knownThrough(ledger), 2);
  assertEquals(acceptRows(ledger, 0, 0, 3, span(3, 2, 1), 2), "accepted");
  assertEquals(acceptRows(ledger, 0, 0, 3, span(3, 2, 1), 2), "accepted", "a duplicate is accepted again");
  assertEquals(acceptRows(ledger, 0, 0, 4, [moving(9)], 1), "conflict");
  assertEquals(acceptRows(ledger, 0, 0, 5, [moving(1), moving(2)], 2), "accepted");
  assertEquals(acceptRows(ledger, 0, 1, 5, [moving(1)], 1), "wrongEpoch");
  assertEquals(acceptRows(ledger, 2, 0, 3, [moving(1)], 1), "wrongSender");
  assertEquals(acceptRows(ledger, 1, 0, knownThrough(ledger) + FUTURE_LIMIT + 1, [moving(1)], 1), "tooFarAhead");
  assertEquals(acceptRows(ledger, 1, 0, knownThrough(ledger) + FUTURE_LIMIT, [moving(1), moving(1)], 2), "tooFarAhead", "a packet crossing the limit is refused whole");
  assertEquals(takeLowestAccepted(ledger, 0), 3);
  assertEquals(takeLowestAccepted(ledger, 0), NO_FRAME);
  assertEquals(knownThrough(ledger), 2, "K waits for the slowest participant");
  assertEquals(acceptRows(ledger, 1, 0, 3, span(3, 4, 5), 4), "accepted");
  assertEquals(knownThrough(ledger), 6);
  assertTrue(markConsumed(ledger, 0, 1));
  assertFalse(markConsumed(ledger, 0, 3));
  assertTrue(markConsumed(ledger, 0, 2));
  assertTrue(discardThrough(ledger, 0, 2));
  assertEquals(acceptedRow(ledger, 0, 2), undefined);
  assertEquals(acceptRows(ledger, 0, 0, 2, [moving(0)], 1), "outOfHistory");
});

test("[scenario] ledger: a participant outside the mask is refused, a departed one frees K, and storage is bounded", () => {
  const ledger = inputLedger(TOY_CODEC, 3, HISTORY);
  assertTrue(beginEpoch(ledger, 4, 1, 0, 3));
  assertFalse(beginEpoch(ledger, 4, 1, 0, 3));
  assertEquals(acceptRows(ledger, 2, 4, 1, [moving(1)], 1), "wrongSender");
  assertEquals(acceptRows(ledger, 0, 4, 1, [moving(1)], 1), "accepted");
  assertEquals(knownThrough(ledger), 0);
  assertEquals(leaveLedger(ledger, 1), 0);
  assertEquals(knownThrough(ledger), 1, "the leaver no longer holds K back");
  assertEquals(acceptRows(ledger, 1, 4, 1, [moving(1)], 1), "gone");
  assertEquals(acceptedRow(ledger, 1, 5)?.move, 0);
  const full = started(1, 0);
  for (let first = 1; first <= 128; first += 64) acceptRows(full, 0, 0, first, span(first, 64, 0), 64);
  assertEquals(acceptRows(full, 0, 0, 129, [moving(1)], 1), "accepted");
  assertEquals(acceptRows(full, 0, 0, 259, [moving(1)], 1), "tooFarAhead");
});

test("[scenario] fixed schedule: capture assigns one row per target and a frame runs only once K reaches it", () => {
  const schedule = fixedSchedule(TOY_CODEC, 2, HISTORY);
  assertTrue(beginFixedEpoch(schedule, 0, 2, allParticipants(2)));
  assertEquals(captureFixed(schedule, 1, moving(1)), Capture.wrongEpoch);
  assertEquals(captureFixed(schedule, 0, moving(1)), Capture.captured);
  assertEquals(captureFixed(schedule, 0, moving(2)), Capture.alreadyCaptured);
  const inputs = [toyRow(), toyRow()];
  assertTrue(readFixed(schedule, 0, inputs));
  assertTrue(completeFixed(schedule, 0, 1));
  assertTrue(readFixed(schedule, 0, inputs));
  assertTrue(completeFixed(schedule, 0, 2));
  assertFalse(readFixed(schedule, 0, inputs));
  assertEquals(acceptRows(schedule.ledger, 0, 0, 3, [moving(7)], 1), "accepted");
  assertFalse(readFixed(schedule, 0, inputs));
  assertEquals(acceptRows(schedule.ledger, 1, 0, 3, [moving(8)], 1), "accepted");
  assertTrue(readFixed(schedule, 0, inputs));
  assertEquals(inputs[1]?.move, 8);
});

test("[scenario] shadow schedule: the speculative cursor predicts a late remote row within its window, rewinds and the confirmed cursor trails K", () => {
  const schedule = shadowSchedule(TOY_CODEC, 2, HISTORY, 4);
  assertFalse(beginShadowEpoch(schedule, 0, 2, 5, allParticipants(2)));
  assertTrue(beginShadowEpoch(schedule, 0, 2, 3, allParticipants(2)));
  const inputs = [toyRow(), toyRow()];
  const run = (sample: ToyRow) => {
    assertEquals(captureLocal(schedule, 0, sample), Capture.captured);
    const resolution = resolveSpeculative(schedule, 0, 0, inputs);
    assertTrue(completeSpeculative(schedule, 0, schedule.nextSpeculative));
    return resolution;
  };
  assertEquals(run(moving(5)), "accepted", "seeded frames are accepted");
  assertEquals(run(moving(6)), "accepted");
  assertEquals(run(moving(7)), "speculative", "frame 3 predicts the remote row");
  assertEquals(pendingRow(schedule, 0, 3)?.move, 5);
  assertEquals(captureLocalAt(schedule, 0, 9, moving(1)), Capture.captured);
  assertEquals(captureLocalAt(schedule, 0, 9, moving(2)), Capture.conflict);
  assertEquals(captureLocalAt(schedule, 0, 9, moving(1)), Capture.alreadyCaptured);
  assertEquals(captureLocalAt(schedule, 0, 400, moving(1)), Capture.tooFarAhead);
  assertEquals(captureLocalAt(schedule, 1, 9, moving(1)), Capture.wrongEpoch);
  assertEquals(acceptSynchronized(schedule, 0, 3, span(3, 3, 5), 3), "accepted");
  assertEquals(awaitedSlots(schedule), 2);
  assertEquals(confirmedLimit(schedule), 2);
  assertEquals(acceptSynchronized(schedule, 1, 3, span(3, 3, 1), 3), "accepted");
  assertEquals(awaitedSlots(schedule), 3);
  assertEquals(confirmedLimit(schedule), 3);
  assertTrue(rewindSpeculative(schedule, 0, 3));
  assertFalse(rewindSpeculative(schedule, 0, 0));
  assertEquals(schedule.nextSpeculative, 3);
  assertTrue(mayAdvanceConfirmed(schedule));
  assertTrue(readConfirmed(schedule, 0, inputs));
  assertTrue(completeConfirmed(schedule, 0, 1));
  assertEquals(schedule.nextConfirmed, 2);
});

test("[scenario] shadow schedule: prediction stops when the window or the ledger's future limit would be passed", () => {
  const schedule = shadowSchedule(TOY_CODEC, 2, HISTORY, 24);
  assertTrue(beginShadowEpoch(schedule, 0, 2, 24, allParticipants(2)));
  const inputs = [toyRow(), toyRow()];
  let frames = 0;
  while (mayAdvanceSpeculative(schedule, 0)) {
    captureLocal(schedule, 0, moving(1));
    assertDefined(resolveSpeculative(schedule, 0, 0, inputs));
    completeSpeculative(schedule, 0, schedule.nextSpeculative);
    frames++;
  }
  assertEquals(frames, 26, "the remote row stands at the seeded delay, so the window of 24 holds F at 26");
  assertTrue(windowHalted(schedule, 0));
  assertEquals(acceptSynchronized(schedule, 1, 3, span(3, 100, 0), 100), "accepted");
  assertTrue(mayAdvanceSpeculative(schedule, 0));
  while (mayAdvanceSpeculative(schedule, 0)) {
    captureLocal(schedule, 0, moving(1));
    assertDefined(resolveSpeculative(schedule, 0, 0, inputs));
    completeSpeculative(schedule, 0, schedule.nextSpeculative);
  }
  assertEquals(schedule.nextSpeculative, FUTURE_LIMIT - schedule.delay, "the row captured after F would pass K + the future limit");
  assertEquals(acceptSynchronized(schedule, 1, 103, span(103, 100, 0), 100), "tooFarAhead");
});
