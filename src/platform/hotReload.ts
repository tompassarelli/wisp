// Development hot reload. `wisp hot` writes each version's payload files and
// then its manifest into every client's CustomMapData. Every client polls for
// its own next manifest, and as soon as it appears loads and verifies its copy
// and broadcasts its answer: ready or refuse, with the manifest it loaded. A
// client that has not found that version yet loads it when the first answer
// arrives. When every playing human has answered, all clients install the
// bundle on that same frame, or all refuse it, so a file problem on one client
// can't split the simulations. Match state is untouched: it lives in globals
// the new code reads. The reloader's own handlers are reinstalled too, so it
// can reload itself.
//
// Each client evaluates a new bundle's modules when its own files arrive, on
// its own frame, so module scope must not call Warcraft natives or read
// synchronized state.
import { acknowledgementLine, ackFile, formatManifest, manifestFile, parseManifest, payloadFile, payloadKey, type Manifest } from "../runtime/gameFiles";
import { runtimeConfiguration } from "../runtime/config";
import { floorDiv } from "../sim/intMath";
import { on, trampoline } from "./dispatch";
import { readChunk } from "./fileio";
import { stringChecksum } from "./payloadChecksum";

// 1/32 s: each poll is one Preloader call for a file that doesn't exist yet.
const POLL_SECONDS = 0.03125;
const MAX_SLOTS = 4;

/** What a reloadable bundle exports: re-register handlers, keep state. */
export interface Reloadable {
  install(this: void): void;
}

/** This client's load of a version it answered, or why it failed. Local to this client. */
interface Prepared {
  version: number;
  checksum: string;
  bundle: Reloadable | string;
}

/** The newest version answered by some client and not yet decided. Synchronized. */
interface Pending {
  version: number;
  files: number;
  checksum: string;
  /** Bit per player slot that has answered. */
  answered: number;
  waiting: number;
  refused: boolean;
}

interface HotState {
  /** Synchronized: the newest version installed, and the newest applied or refused. */
  applied: number;
  decided: number;
  pending: Pending | undefined;
  /** Local: the manifest version this client polls for next, and its load awaiting a decision. */
  next: number;
  prepared: Prepared | undefined;
  /** Game time since the first install, which every client reads alike on a given frame. */
  clock?: timer;
}

function hot(): HotState {
  const globals = globalThis as Record<`${string}Hot`, HotState | undefined>;
  const state = globals[`${runtimeConfiguration().globalPrefix}Hot`];
  if (state === undefined) throw new Error("hot reload used before startHotReload");
  return state;
}

function isReloadable(value: unknown): value is Reloadable {
  return typeof value === "object" && value !== null && "install" in value && typeof value.install === "function";
}

const manifestExists = (version: number) => readChunk(manifestFile(version, runtimeConfiguration().filePrefix)) !== undefined;

/**
 * The newest version published before this match. Manifests are never removed
 * and versions only rise, so existence is monotonic and a search finds it in
 * a logarithmic number of reads.
 */
function latestVersion(): number {
  if (!manifestExists(1)) return 0;
  let low = 1;
  while (manifestExists(low * 2)) low *= 2;
  let high = low * 2;
  while (high - low > 1) {
    const middle = floorDiv(low + high, 2);
    if (manifestExists(middle)) low = middle;
    else high = middle;
  }
  return low;
}

function playingHumans(): number {
  let count = 0;
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    const player = Player(slot);
    if (GetPlayerSlotState(player) === PLAYER_SLOT_STATE_PLAYING && GetPlayerController(player) === MAP_CONTROL_USER) count++;
  }
  return count;
}

function startClock(): timer {
  const clock = CreateTimer();
  TimerStart(clock, 86400.0, false, () => {});
  return clock;
}

function report(text: string): void {
  DisplayTextToPlayer(GetLocalPlayer(), 0, 0, text);
}

/** This client's copy of a version's bundle, loaded but not installed, or why it failed. */
function loadLocal({ files, checksum: expected }: Manifest): Reloadable | string {
  const parts: string[] = [];
  for (let index = 0; index < files; index++) parts.push(readChunk(payloadFile(expected, index, runtimeConfiguration().filePrefix)) ?? "");
  const text = parts.join("");
  if (stringChecksum(text) !== expected) return "payload missing or damaged";
  const [chunk, error] = load(text, `=hot-${payloadKey(expected)}`);
  if (chunk === undefined) return error ?? "load failed";
  // A bundle that fails while loading is refused like a damaged one, so every client still answers.
  const [ran, module] = pcall(chunk);
  if (!ran) return `failed while loading: ${String(module)}`;
  return isReloadable(module) ? module : "bundle exports no install()";
}

/** Loads this client's copy of a version and tells every client whether it is ready. */
function answer(state: HotState, manifest: Manifest): void {
  if (state.next <= manifest.version) state.next = manifest.version + 1;
  const bundle = loadLocal(manifest);
  state.prepared = { version: manifest.version, checksum: manifest.checksum, bundle };
  BlzSendSyncData(runtimeConfiguration().readyPrefix, `${formatManifest(manifest)} ${typeof bundle === "string" ? "refuse" : "ready"}`);
}

function poll(): void {
  const state = hot();
  // One version at a time: the next waits for the decision on the one this client answered.
  if (state.prepared !== undefined) return;
  if (state.next <= state.decided) state.next = state.decided + 1;
  const text = readChunk(manifestFile(state.next, runtimeConfiguration().filePrefix));
  if (text === undefined) return;
  const manifest = parseManifest(text);
  if (manifest === undefined || manifest.version !== state.next) {
    // Unreadable here; another client's answer still brings this version.
    state.next++;
    return;
  }
  answer(state, manifest);
}

/** Tells host tools which version this client runs: 0 for the map's own bundle. */
function acknowledge(version: number, elapsed: number): void {
  PreloadGenClear();
  PreloadGenStart();
  Preload(acknowledgementLine(version, elapsed));
  PreloadGenEnd(ackFile(GetPlayerId(GetLocalPlayer()), runtimeConfiguration().filePrefix));
}

function decide(state: HotState, pending: Pending): void {
  state.pending = undefined;
  state.decided = pending.version;
  const prepared = state.prepared;
  if (prepared !== undefined && prepared.version <= pending.version) state.prepared = undefined;
  // Every client answered ready with this checksum, so each holds its own load of it.
  const bundle = prepared !== undefined && prepared.version === pending.version && prepared.checksum === pending.checksum ? prepared.bundle : "no local copy";
  if (pending.refused || typeof bundle === "string") {
    const reason = typeof bundle === "string" ? bundle : "another client couldn't load it";
    report(`hot reload ${pending.version} not applied: ${reason}`);
    return;
  }
  bundle.install();
  state.applied = pending.version;
  state.clock ??= startClock();
  acknowledge(pending.version, TimerGetElapsed(state.clock));
  report(`hot reload ${pending.version} applied`);
}

function answered(): void {
  const state = hot();
  const text = BlzGetTriggerSyncData();
  const manifest = parseManifest(text);
  const verdict = text.split(" ")[3];
  if (manifest === undefined || manifest.version <= state.decided) return;
  let pending = state.pending;
  if (pending !== undefined && manifest.version < pending.version) return;
  if (pending === undefined || manifest.version > pending.version) {
    // The first answer for a newer version supersedes an undecided older one.
    pending = { version: manifest.version, files: manifest.files, checksum: manifest.checksum, answered: 0, waiting: playingHumans(), refused: false };
    state.pending = pending;
  }
  const bit = 1 << GetPlayerId(GetTriggerPlayer());
  if ((pending.answered & bit) !== 0) return;
  pending.answered |= bit;
  pending.waiting--;
  if (verdict !== "ready" || manifest.checksum !== pending.checksum) pending.refused = true;
  if (state.prepared === undefined || state.prepared.version !== pending.version) {
    answer(state, { version: pending.version, files: pending.files, checksum: pending.checksum });
  }
  if (pending.waiting <= 0 && state.pending === pending) decide(state, pending);
}

/** Registers the reloader's handlers; a reloaded bundle calls this again. */
export function installHotReload(): void {
  on("hotReload.poll", poll);
  on("hotReload.answered", answered);
}

/** Starts polling for new bundles. Call once, at match start. */
export function startHotReload(): void {
  const configuration = runtimeConfiguration();
  const globals = globalThis as Record<`${string}Hot`, HotState | undefined>;
  // Versions published before this match are its baseline, not reloads.
  globals[`${configuration.globalPrefix}Hot`] = { applied: 0, decided: 0, pending: undefined, next: latestVersion() + 1, prepared: undefined };
  installHotReload();
  const trigger = CreateTrigger();
  for (let slot = 0; slot < MAX_SLOTS; slot++) BlzTriggerRegisterPlayerSyncEvent(trigger, Player(slot), configuration.readyPrefix, false);
  TriggerAddAction(trigger, trampoline("hotReload.answered"));
  TimerStart(CreateTimer(), POLL_SECONDS, true, trampoline("hotReload.poll"));
  // The match is running in this client; a fresh-match journey waits for this.
  acknowledge(0, 0);
}
