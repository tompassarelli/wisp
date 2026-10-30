import { at } from "../runtime/lookup";
import { assertEquals, assertGreaterThan, assertTrue, test } from "../runtime/testing";
import { floorMod } from "../sim/intMath";
import { TOY_AIM, TOY_CODEC, TOY_FIRE, type ToyRow, lcg, toyRow } from "./rowCodec.tests";
import { NET_SETTINGS, type Session, type Simulation, confirmedFrame, createSession, leave, localRow, predictedAt, presentFrame, receive, remoteThrough, tick } from "./session";

interface ToyState {
  readonly positions: readonly number[];
  readonly score: number;
}

function toyStep(state: ToyState, rows: readonly ToyRow[]): ToyState {
  let score = state.score;
  const positions: number[] = [];
  for (let player = 0; player < rows.length; player++) {
    const row = at(rows, player);
    positions.push(at(state.positions, player) + ((row.move & 1) !== 0 ? 1 : 0) - ((row.move & 2) !== 0 ? 1 : 0));
    score = floorMod(score * 31 + row.fire * 7 + row.aim + player, 100003);
  }
  return { positions, score };
}

function toyInitial(): ToyState {
  return { positions: [0, 0], score: 1 };
}

function toySum(state: ToyState): number {
  return state.score * 3 + at(state.positions, 0) * 1009 + at(state.positions, 1) * 7919;
}

const NET: Simulation<ToyRow, ToyState> = { codec: TOY_CODEC, step: toyStep, predicted: () => {}, confirmed: () => {} };

interface InFlight {
  readonly arrival: number;
  readonly sender: number;
  readonly wire: string;
}

function truthAt(rows: readonly (readonly ToyRow[])[], frame: number): ToyState {
  let state = toyInitial();
  for (let stepped = 1; stepped <= frame; stepped++) state = toyStep(state, [at(rows, 0)[stepped] ?? toyRow(), at(rows, 1)[stepped] ?? toyRow()]);
  return state;
}

function record(session: Session<ToyRow, ToyState>, captured: ToyRow[], from: number): number {
  let recorded = from;
  for (let frame = from + 1; frame <= presentFrame(session) + NET_SETTINGS.delay; frame++) {
    const row = toyRow();
    TOY_CODEC.copy(row, localRow(session, frame) ?? toyRow());
    captured[frame] = row;
    recorded = frame;
  }
  return recorded;
}

// Rolled-back prediction must equal the state stepped with the rows each player really captured, on both clients.
test("rollback: two clients trading rows over a late, bursty channel predict, roll back and confirm the state of the true rows", () => {
  const next = lcg(11);
  const sessions: Session<ToyRow, ToyState>[] = [0, 1].map((player) => createSession(NET, NET_SETTINGS, 2, player, toyInitial()));
  const samples = [toyRow(), toyRow()];
  const captured: ToyRow[][] = [[], []];
  const recorded = [NET_SETTINGS.delay, NET_SETTINGS.delay];
  const lastArrival = [0, 0];
  const network: InFlight[] = [];
  const callbacks = 900;
  for (let callback = 1; callback <= callbacks + 120; callback++) {
    for (let index = 0; index < network.length;) {
      const message = at(network, index);
      if (message.arrival > callback) index++;
      else {
        for (const session of sessions) assertEquals(receive(session, NET, message.sender, message.wire), "accepted", "receipt");
        network.splice(index, 1);
      }
    }
    for (let player = 0; player < 2; player++) {
      const session = at(sessions, player);
      const sample = at(samples, player);
      if (callback <= callbacks) {
        if (floorMod(next(), 9) === 0) sample.move = floorMod(next(), 16);
        if (floorMod(next(), 25) === 0 && sample.fire === 0) {
          sample.fire = 1 + floorMod(next(), TOY_FIRE);
          sample.aim = floorMod(next() * 16, 2 * TOY_AIM) - TOY_AIM;
        }
      } else TOY_CODEC.hold(sample, toyRow());
      const wire = tick(session, NET, NET_SETTINGS, sample);
      recorded[player] = record(session, at(captured, player), at(recorded, player));
      if (wire === undefined) continue;
      const stall = floorMod(next(), 50) === 0 ? 40 : 0;
      const arrival = Math.max(at(lastArrival, player), callback + 3 + floorMod(next(), 12) + stall);
      lastArrival[player] = arrival;
      network.push({ arrival, sender: player, wire });
    }
  }
  const [first, second] = sessions;
  if (first === undefined || second === undefined) throw new Error("two sessions");
  assertEquals(confirmedFrame(first), confirmedFrame(second), "confirmed frame");
  assertGreaterThan(confirmedFrame(first), callbacks);
  const truth = truthAt(captured, confirmedFrame(first));
  assertEquals(toySum(first.confirmed), toySum(truth), "first client's confirmed state");
  assertEquals(toySum(second.confirmed), toySum(truth), "second client's confirmed state");
  for (const session of sessions) {
    assertGreaterThan(session.stats.rollbacks, 20);
    assertEquals(session.stats.refused, 0, "refused messages");
    const settled = Math.min(presentFrame(session), remoteThrough(session));
    const predicted = predictedAt(session, settled);
    if (predicted === undefined) throw new Error(`no prediction kept for frame ${settled}`);
    assertEquals(toySum(predicted), toySum(truthAt(captured, settled)), "rolled-back prediction");
    assertTrue(session.stats.messages * NET_SETTINGS.sendEvery <= session.callbacks + 3 * NET_SETTINGS.sendEvery);
  }
});

test("leave: a player who leaves while holding a move key is idle after their last accepted row, and the prediction that held it rolls back", () => {
  const sessions: Session<ToyRow, ToyState>[] = [0, 1].map((player) => createSession(NET, NET_SETTINGS, 2, player, toyInitial()));
  const [stayer, leaver] = sessions;
  if (stayer === undefined || leaver === undefined) throw new Error("two sessions");
  const samples = [toyRow(), toyRow()];
  const captured: ToyRow[][] = [[], []];
  const recorded = [0, 0];
  const network: InFlight[] = [];
  const leaveAt = 100;
  for (let callback = 1; callback <= 300; callback++) {
    for (let index = 0; index < network.length;) {
      const message = at(network, index);
      if (message.arrival > callback) index++;
      else {
        assertEquals(receive(stayer, NET, message.sender, message.wire), "accepted", "receipt");
        if (callback < leaveAt) receive(leaver, NET, message.sender, message.wire);
        network.splice(index, 1);
      }
    }
    if (callback === leaveAt + 8) leave(stayer, NET, 1);
    for (let player = 0; player < 2; player++) {
      if (player === 1 && callback >= leaveAt) continue;
      const session = at(sessions, player);
      const sample = at(samples, player);
      if (player === 1 && callback >= 50) sample.move = 1;
      if (player === 0 && floorMod(callback, 40) === 0) sample.move = floorMod(callback, 16);
      const wire = tick(session, NET, NET_SETTINGS, sample);
      recorded[player] = record(session, at(captured, player), at(recorded, player));
      if (wire !== undefined) network.push({ arrival: callback + 8, sender: player, wire });
    }
  }
  const gone = at(stayer.ledger.goneAfter, 1);
  assertGreaterThan(gone, 40);
  assertGreaterThan(leaveAt, gone);
  const rows: ToyRow[][] = [at(captured, 0), []];
  for (let frame = 1; frame <= gone; frame++) at(rows, 1)[frame] = at(at(captured, 1), frame);
  assertGreaterThan(confirmedFrame(stayer), 250);
  assertEquals(toySum(stayer.confirmed), toySum(truthAt(rows, confirmedFrame(stayer))), "confirmed state");
  const predicted = predictedAt(stayer, confirmedFrame(stayer));
  if (predicted === undefined) throw new Error("no prediction kept for the confirmed frame");
  assertEquals(toySum(predicted), toySum(stayer.confirmed), "rolled-back prediction");
  assertEquals(stayer.stats.refused, 0, "refused messages");
});
