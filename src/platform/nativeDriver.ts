import { runtimeConfiguration } from "../runtime/config";
import { driverCommandFile, driverReadyFile, driverStatusFile } from "../runtime/nativeDriver";
import { floorDiv } from "../sim/intMath";
import { on, trampoline } from "./dispatch";
import { readChunk, writeLine } from "./fileio";
import { stringChecksum } from "./payloadChecksum";

const SYNC = "wisp.nativeDriver";
const PREFIX = "WISP_DRIVE";

interface DriverState {
  serial: number;
  players: number;
  leader: number;
  frame: number;
  checksum: string;
  paused: boolean;
  payload: string | undefined;
  digest: string | undefined;
  answers: number;
  sent: boolean;
  polls: number;
  refused: boolean;
  offered: boolean;
}

declare global {
  var __wispDrive: DriverState | undefined;
}

function status(state: DriverState): void {
  writeLine(driverStatusFile(runtimeConfiguration().filePrefix), `drive ${state.serial} ${state.frame} ${state.checksum} ${state.paused ? 1 : 0} ${state.players} ${GetPlayerId(GetLocalPlayer())} ${state.refused ? 1 : 0}`);
}

function prepare(state: DriverState): void {
  if (state.payload !== undefined) return;
  const text = readChunk(driverCommandFile(runtimeConfiguration().filePrefix, state.serial + 1));
  if (text === undefined) return;
  state.payload = text;
  state.digest = stringChecksum(text);
}

/** Every client first verifies its numbered payload; the last matching sync answer applies it everywhere. */
export function installNativeDriver(handler: (text: string) => void): void {
  on(SYNC, () => {
    const state = globalThis.__wispDrive;
    if (state === undefined) return;
    const fields = BlzGetTriggerSyncData().split(" ");
    const serial = tonumber(fields[1]) ?? -1;
    const sender = GetPlayerId(GetTriggerPlayer());
    if (serial !== state.serial + 1 || (state.players & (1 << sender)) === 0) return;
    if (fields[0] === "offer") {
      if (sender !== state.leader) return;
      prepare(state);
      if (state.payload === undefined || fields[2] !== state.digest) state.refused = true;
      state.offered = true;
      state.sent = false;
      return;
    }
    if (fields[0] !== "ready") return;
    if (fields[2] === "refuse" || fields[2] !== state.digest) state.refused = true;
    state.answers |= 1 << sender;
    if (state.answers !== state.players) return;
    if (state.refused || state.payload === undefined) {
      status(state);
      return;
    }
    const payload = state.payload;
    handler(payload);
    state.serial = serial;
    state.payload = undefined;
    state.digest = undefined;
    state.answers = 0;
    state.sent = false;
    state.offered = false;
    status(state);
  });
}

/** Opt-in once at synchronized startup, before any commands are published. */
export function startNativeDriver(players: readonly number[], leader = 0): void {
  if (globalThis.__wispDrive !== undefined) throw new Error("native driver already started");
  const prefix = runtimeConfiguration().filePrefix;
  const exists = (serial: number) => readChunk(driverReadyFile(prefix, serial)) !== undefined;
  let serial = 0;
  if (exists(1)) {
    let low = 1;
    while (exists(low * 2)) low *= 2;
    let high = low * 2;
    while (high - low > 1) {
      const middle = floorDiv(low + high, 2);
      if (exists(middle)) low = middle;
      else high = middle;
    }
    serial = low;
  }
  let mask = 0;
  for (const slot of players) mask |= 1 << slot;
  const state: DriverState = { serial, players: mask, leader, frame: 0, checksum: "00000000", paused: true, payload: undefined, digest: undefined, answers: 0, sent: false, polls: 0, refused: false, offered: false };
  globalThis.__wispDrive = state;
  const trigger = CreateTrigger();
  for (const slot of players) BlzTriggerRegisterPlayerSyncEvent(trigger, Player(slot), PREFIX, false);
  TriggerAddAction(trigger, trampoline(SYNC));
  status(state);
}

/** Call on the existing callback even while simulation is held; no clock or timer is replaced. */
export function serviceNativeDriver(): void {
  const state = globalThis.__wispDrive;
  if (state === undefined) return;
  state.polls++;
  if (state.polls < 2) return;
  state.polls = 0;
  if (state.offered) {
    if (!state.sent) state.sent = BlzSendSyncData(PREFIX, `ready ${state.serial + 1} ${state.refused ? "refuse" : state.digest ?? "refuse"}`);
  } else if (GetPlayerId(GetLocalPlayer()) === state.leader && !state.sent
    && readChunk(driverReadyFile(runtimeConfiguration().filePrefix, state.serial + 1)) !== undefined) {
    prepare(state);
    if (state.payload !== undefined && BlzSendSyncData(PREFIX, `offer ${state.serial + 1} ${state.digest ?? ""}`)) state.sent = true;
  }
}

export function publishNativeDriverStatus(frame: number, checksum: string, paused: boolean): void {
  const state = globalThis.__wispDrive;
  if (state === undefined) return;
  state.frame = frame;
  state.checksum = checksum;
  state.paused = paused;
  status(state);
}
