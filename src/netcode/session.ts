import { at } from "../runtime/lookup";
import { floorMod } from "../sim/intMath";
import type { RowCodec } from "./codec";
import { type FrameRing, frameRing, ringRow, ringStore } from "./frameRing";
import { type InputLedger, NO_FRAME, type Receipt, acceptedRow, allParticipants, leaveLedger } from "./ledger";
import { MESSAGE_MAX_FRAMES, decodeMessage, encodeMessage } from "./message";
import {
  type ShadowSchedule, acceptSynchronized, beginShadowEpoch, captureLocal, completeConfirmed, completeSpeculative, lateFrom, mayAdvanceConfirmed, mayAdvanceSpeculative,
  pendingRow, readConfirmed, remoteThrough as scheduleRemoteThrough, rememberResolvedInput, resolveSpeculative, rewindSpeculative, shadowSchedule,
} from "./shadowSchedule";

export interface NetSettings {
  readonly delay: number;
  readonly window: number;
  readonly sendEvery: number;
  readonly catchUp: number;
}

export const NET_SETTINGS: NetSettings = { delay: 2, window: 24, sendEvery: 6, catchUp: 6 };

const HISTORY = 128;
const EPOCH = 0;
const NO_ROLLBACK = NO_FRAME;

export interface Simulation<Row, State> {
  readonly codec: RowCodec<Row>;
  step(this: void, state: State, rows: readonly Row[]): State;
  predicted(this: void, state: State): void;
  confirmed(this: void, state: State): void;
}

export interface NetStats {
  rollbacks: number;
  deepest: number;
  held: number;
  messages: number;
  largest: number;
  refused: number;
}

export interface Session<Row, State> {
  readonly players: number;
  readonly local: number;
  readonly schedule: ShadowSchedule<Row>;
  readonly ledger: InputLedger<Row>;
  readonly used: readonly FrameRing<Row>[];
  readonly states: State[];
  readonly stateFrames: number[];
  readonly resolved: Row[];
  readonly rows: Row[];
  readonly frameRows: Readonly<Row>[];
  readonly inbox: readonly Row[];
  confirmed: State;
  callbacks: number;
  rollbackFrom: number;
  sentThrough: number;
  credit: number;
  sinceSend: number;
  pressWaiting: boolean;
  lastHadPress: boolean;
  readonly stats: NetStats;
}

function rows<Row>(codec: RowCodec<Row>, count: number): Row[] {
  const made: Row[] = [];
  for (let index = 0; index < count; index++) made.push(codec.neutral());
  return made;
}

export function createSession<Row, State>(sim: Simulation<Row, State>, settings: NetSettings, players: number, local: number, initial: State): Session<Row, State> {
  const codec = sim.codec;
  const used: FrameRing<Row>[] = [];
  for (let player = 0; player < players; player++) used.push(frameRing(codec, HISTORY));
  const states: State[] = [];
  const stateFrames: number[] = [];
  for (let slot = 0; slot < HISTORY; slot++) {
    states.push(initial);
    stateFrames.push(slot === 0 ? 0 : -1);
  }
  const schedule = shadowSchedule(codec, players, HISTORY, settings.window);
  if (!beginShadowEpoch(schedule, EPOCH, settings.delay, settings.window, allParticipants(players))) throw new Error("the net settings do not fit the schedule");
  return {
    players, local: local >= 0 && local < players ? local : -1, schedule, ledger: schedule.fixed.ledger, used, states, stateFrames,
    resolved: rows(codec, players), rows: rows(codec, players), frameRows: rows(codec, players), inbox: rows(codec, MESSAGE_MAX_FRAMES),
    confirmed: initial, callbacks: 0, rollbackFrom: NO_ROLLBACK,
    sentThrough: settings.delay, credit: 2 * settings.sendEvery, sinceSend: 0, pressWaiting: false, lastHadPress: false,
    stats: { rollbacks: 0, deepest: 0, held: 0, messages: 0, largest: 0, refused: 0 },
  };
}

export function presentFrame<Row, State>(session: Session<Row, State>): number {
  return session.schedule.nextSpeculative - 1;
}

export function confirmedFrame<Row, State>(session: Session<Row, State>): number {
  return session.schedule.nextConfirmed - 1;
}

export function localRow<Row, State>(session: Session<Row, State>, frame: number): Readonly<Row> | undefined {
  return pendingRow(session.schedule, EPOCH, frame);
}

export function predictedAt<Row, State>(session: Session<Row, State>, frame: number): State | undefined {
  const slot = floorMod(frame, HISTORY);
  return session.stateFrames[slot] === frame ? session.states[slot] : undefined;
}

export function predictedState<Row, State>(session: Session<Row, State>): State {
  return at(session.states, floorMod(presentFrame(session), HISTORY));
}

export function remoteThrough<Row, State>(session: Session<Row, State>): number {
  return scheduleRemoteThrough(session.schedule, session.local);
}

export function receive<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, sender: number, wire: string): Receipt {
  if (sender < 0 || sender >= session.players) return "wrongSender";
  const decoded = decodeMessage(sim.codec, wire, session.inbox);
  const receipt = decoded === undefined ? "malformed" : acceptSynchronized(session.schedule, sender, decoded.firstFrame, session.inbox, decoded.count);
  if (decoded === undefined || receipt !== "accepted") {
    session.stats.refused++;
    return receipt;
  }
  const from = lateFrom(session.schedule, sender);
  if (sender === session.local) return receipt;
  const used = at(session.used, sender);
  const present = presentFrame(session);
  for (let frame = from; frame < from + decoded.count; frame++) {
    if (frame > present || frame >= session.rollbackFrom) break;
    const ran = ringRow(used, frame);
    const accepted = acceptedRow(session.ledger, sender, frame);
    if (ran === undefined || accepted === undefined || !sim.codec.same(ran, accepted)) {
      session.rollbackFrom = frame;
      break;
    }
  }
  return receipt;
}

export function leave<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, player: number): void {
  if (player < 0 || player >= session.players) return;
  const used = at(session.used, player);
  for (let frame = leaveLedger(session.ledger, player) + 1; frame <= presentFrame(session) && frame < session.rollbackFrom; frame++) {
    const ran = ringRow(used, frame);
    if (ran === undefined || !sim.codec.same(ran, session.ledger.idle)) session.rollbackFrom = frame;
  }
}

function runFrame<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>): void {
  const schedule = session.schedule;
  const frame = schedule.nextSpeculative;
  const before = predictedAt(session, frame - 1);
  if (before === undefined) throw new Error(`frame ${frame} needs a snapshot older than the rollback history`);
  if (resolveSpeculative(schedule, EPOCH, session.local, session.resolved) === undefined) throw new Error(`frame ${frame} cannot be resolved`);
  for (let player = 0; player < session.players; player++) {
    const ring = at(session.used, player);
    ringStore(sim.codec, ring, frame, at(session.resolved, player));
    session.frameRows[player] = at(ring.rows, floorMod(frame, HISTORY));
  }
  const state = sim.step(before, session.frameRows);
  const slot = floorMod(frame, HISTORY);
  session.states[slot] = state;
  session.stateFrames[slot] = frame;
  completeSpeculative(schedule, EPOCH, frame);
  sim.predicted(state);
}

function rollBack<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>): void {
  const schedule = session.schedule;
  const present = presentFrame(session);
  const from = Math.max(session.rollbackFrom, schedule.nextConfirmed);
  session.rollbackFrom = NO_ROLLBACK;
  if (from > present) return;
  const depth = present - from + 1;
  session.stats.rollbacks++;
  if (depth > session.stats.deepest) session.stats.deepest = depth;
  rewindSpeculative(schedule, EPOCH, from);
  for (let player = 0; player < session.players; player++) {
    const basis = ringRow(at(session.used, player), from - 1);
    rememberResolvedInput(schedule, player, basis ?? sim.codec.neutral());
  }
  while (schedule.nextSpeculative <= present) runFrame(session, sim);
}

function predict<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, settings: NetSettings, sample: Row): void {
  const codec = sim.codec;
  const schedule = session.schedule;
  for (let ran = 0; ran < settings.catchUp && presentFrame(session) < session.callbacks; ran++) {
    if (!mayAdvanceSpeculative(schedule, session.local)) {
      session.stats.held++;
      return;
    }
    if (session.local >= 0) {
      captureLocal(schedule, EPOCH, sample);
      if (codec.urgent(sample)) session.pressWaiting = true;
      codec.hold(sample, sample);
    }
    runFrame(session, sim);
  }
}

function confirm<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>): void {
  const schedule = session.schedule;
  while (mayAdvanceConfirmed(schedule)) {
    const frame = schedule.nextConfirmed;
    if (!readConfirmed(schedule, EPOCH, session.rows)) throw new Error(`frame ${frame} has no accepted rows`);
    session.confirmed = sim.step(session.confirmed, session.rows);
    completeConfirmed(schedule, EPOCH, frame);
    sim.confirmed(session.confirmed);
  }
}

function send<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, settings: NetSettings): string | undefined {
  if (session.local < 0) return undefined;
  session.sinceSend++;
  session.credit = Math.min(session.credit + 1, 2 * settings.sendEvery);
  const captured = presentFrame(session) + settings.delay;
  if (session.sentThrough >= captured) return undefined;
  const due = session.sinceSend >= settings.sendEvery || session.pressWaiting;
  const allowed = session.credit >= settings.sendEvery || (session.pressWaiting && session.lastHadPress && session.credit >= 0);
  if (!due || !allowed) return undefined;
  const message = encodeMessage(sim.codec, session.sentThrough + 1, captured, (frame) => {
    const row = localRow(session, frame);
    if (row === undefined) throw new Error(`no local row for frame ${frame}`);
    return row;
  });
  session.sentThrough = message.lastFrame;
  session.credit -= settings.sendEvery;
  session.sinceSend = 0;
  session.lastHadPress = session.pressWaiting;
  session.pressWaiting = false;
  session.stats.messages++;
  if (message.wire.length > session.stats.largest) session.stats.largest = message.wire.length;
  return message.wire;
}

export function tick<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, settings: NetSettings, sample: Row): string | undefined {
  session.callbacks++;
  rollBack(session, sim);
  predict(session, sim, settings, sample);
  confirm(session, sim);
  return send(session, sim, settings);
}
