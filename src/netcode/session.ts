import { at } from "../runtime/lookup";
import { floorMod } from "../sim/intMath";
import type { RowCodec } from "./codec";
import { type FrameRing, frameRing, ringRow, ringStore } from "./frameRing";
import { type InputLedger, type Receipt, acceptRows, acceptedRow, inputLedger, isPlaying, knownThrough, leaveLedger } from "./ledger";
import { MESSAGE_MAX_FRAMES, decodeMessage, encodeMessage } from "./message";
import { WIRE_MAX_VALUE } from "./wire";

export interface NetSettings {
  readonly delay: number;
  readonly window: number;
  readonly sendEvery: number;
  readonly catchUp: number;
}

export const NET_SETTINGS: NetSettings = { delay: 2, window: 24, sendEvery: 6, catchUp: 6 };

const HISTORY = 128;
const NO_ROLLBACK = WIRE_MAX_VALUE + 1;

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
  readonly ledger: InputLedger<Row>;
  readonly pending: FrameRing<Row>;
  readonly used: readonly FrameRing<Row>[];
  readonly states: State[];
  readonly stateFrames: number[];
  readonly rows: readonly Row[];
  readonly frameRows: Readonly<Row>[];
  readonly inbox: readonly Row[];
  confirmed: State;
  confirmedFrame: number;
  present: number;
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
  return {
    players, local: local >= 0 && local < players ? local : -1,
    ledger: inputLedger(codec, players, settings.delay), pending: frameRing(codec, HISTORY), used, states, stateFrames,
    rows: rows(codec, players), frameRows: rows(codec, players), inbox: rows(codec, MESSAGE_MAX_FRAMES),
    confirmed: initial, confirmedFrame: 0, present: 0, callbacks: 0, rollbackFrom: NO_ROLLBACK,
    sentThrough: settings.delay, credit: 2 * settings.sendEvery, sinceSend: 0, pressWaiting: false, lastHadPress: false,
    stats: { rollbacks: 0, deepest: 0, held: 0, messages: 0, largest: 0, refused: 0 },
  };
}

export function predictedAt<Row, State>(session: Session<Row, State>, frame: number): State | undefined {
  const slot = floorMod(frame, HISTORY);
  return session.stateFrames[slot] === frame ? session.states[slot] : undefined;
}

export function predictedState<Row, State>(session: Session<Row, State>): State {
  return at(session.states, floorMod(session.present, HISTORY));
}

export function remoteThrough<Row, State>(session: Session<Row, State>): number {
  let through = NO_ROLLBACK;
  for (let player = 0; player < session.players; player++) {
    const accepted = at(session.ledger.through, player);
    if (player !== session.local && isPlaying(session.ledger, player) && accepted < through) through = accepted;
  }
  return through;
}

export function receive<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, sender: number, wire: string): Receipt {
  if (sender < 0 || sender >= session.players) return "wrongSender";
  const codec = sim.codec;
  const decoded = decodeMessage(codec, wire, session.inbox);
  const receipt = decoded === undefined ? "malformed"
    : acceptRows(codec, session.ledger, sender, decoded.firstFrame, session.inbox, decoded.count, session.confirmedFrame);
  if (decoded === undefined || receipt !== "accepted") {
    session.stats.refused++;
    return receipt;
  }
  if (sender === session.local) return receipt;
  const used = at(session.used, sender);
  for (let index = 0; index < decoded.count; index++) {
    const frame = decoded.firstFrame + index;
    if (frame > session.present || frame >= session.rollbackFrom) break;
    const ran = ringRow(used, frame);
    if (ran === undefined || !codec.same(ran, at(session.inbox, index))) {
      session.rollbackFrom = frame;
      break;
    }
  }
  return receipt;
}

export function leave<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, player: number): void {
  if (player < 0 || player >= session.players) return;
  const used = at(session.used, player);
  for (let frame = leaveLedger(session.ledger, player) + 1; frame <= session.present && frame < session.rollbackFrom; frame++) {
    const ran = ringRow(used, frame);
    if (ran === undefined || !sim.codec.same(ran, session.ledger.idle)) session.rollbackFrom = frame;
  }
}

function bestRow<Row, State>(session: Session<Row, State>, codec: RowCodec<Row>, player: number, frame: number): Readonly<Row> {
  const accepted = acceptedRow(session.ledger, player, frame);
  if (accepted !== undefined) return accepted;
  const scratch = at(session.rows, player);
  if (player === session.local) {
    const pending = ringRow(session.pending, frame);
    if (pending === undefined) throw new Error(`no local row for frame ${frame}`);
    return pending;
  }
  const last = acceptedRow(session.ledger, player, at(session.ledger.through, player));
  if (last === undefined) throw new Error(`player ${player} has no row to predict frame ${frame} from`);
  codec.hold(scratch, last);
  return scratch;
}

function runFrame<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, frame: number): void {
  const codec = sim.codec;
  const before = predictedAt(session, frame - 1);
  if (before === undefined) throw new Error(`frame ${frame} needs a snapshot older than the rollback history`);
  for (let player = 0; player < session.players; player++) {
    const ring = at(session.used, player);
    ringStore(codec, ring, frame, bestRow(session, codec, player, frame));
    session.frameRows[player] = at(ring.rows, floorMod(frame, HISTORY));
  }
  const state = sim.step(before, session.frameRows);
  const slot = floorMod(frame, HISTORY);
  session.states[slot] = state;
  session.stateFrames[slot] = frame;
  sim.predicted(state);
}

function rollBack<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>): void {
  const from = session.rollbackFrom;
  session.rollbackFrom = NO_ROLLBACK;
  if (from > session.present) return;
  const depth = session.present - from + 1;
  session.stats.rollbacks++;
  if (depth > session.stats.deepest) session.stats.deepest = depth;
  for (let frame = from; frame <= session.present; frame++) runFrame(session, sim, frame);
}

function predict<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, settings: NetSettings, sample: Row): void {
  const codec = sim.codec;
  const remote = remoteThrough(session);
  for (let ran = 0; ran < settings.catchUp && session.present < session.callbacks; ran++) {
    const frame = session.present + 1;
    if (frame - remote > settings.window) {
      session.stats.held++;
      return;
    }
    if (session.local >= 0) {
      ringStore(codec, session.pending, frame + settings.delay, sample);
      if (codec.urgent(sample)) session.pressWaiting = true;
      codec.hold(sample, sample);
    }
    runFrame(session, sim, frame);
    session.present = frame;
  }
}

function confirm<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>): void {
  const known = knownThrough(session.ledger);
  const inputs = session.rows;
  while (session.confirmedFrame < known) {
    const frame = session.confirmedFrame + 1;
    for (let player = 0; player < session.players; player++) {
      const row = acceptedRow(session.ledger, player, frame);
      if (row === undefined) throw new Error(`player ${player} has no accepted row for frame ${frame}`);
      sim.codec.copy(at(inputs, player), row);
    }
    session.confirmed = sim.step(session.confirmed, inputs);
    session.confirmedFrame = frame;
    sim.confirmed(session.confirmed);
  }
}

function send<Row, State>(session: Session<Row, State>, sim: Simulation<Row, State>, settings: NetSettings): string | undefined {
  if (session.local < 0) return undefined;
  session.sinceSend++;
  session.credit = Math.min(session.credit + 1, 2 * settings.sendEvery);
  const captured = session.present + settings.delay;
  if (session.sentThrough >= captured) return undefined;
  const due = session.sinceSend >= settings.sendEvery || session.pressWaiting;
  const allowed = session.credit >= settings.sendEvery || (session.pressWaiting && session.lastHadPress && session.credit >= 0);
  if (!due || !allowed) return undefined;
  const pending = session.pending;
  const message = encodeMessage(sim.codec, session.sentThrough + 1, captured, (frame) => {
    const row = ringRow(pending, frame);
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
