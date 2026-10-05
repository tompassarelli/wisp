// Development hot reload. The host client polls for the next manifest
// `waygate hot` writes into CustomMapData and announces it in a synchronized
// message. Every client reads its own copy, verifies and loads it, and
// broadcasts whether it is ready. When the last answer arrives, all clients
// install the bundle on that same frame, or all refuse it, so a file problem
// on one client can't split the simulations. Match state is untouched: it lives
// in globals the new code reads. The reloader's own handlers are reinstalled
// too, so it can reload itself.
import { acknowledgementLine, ackFile, manifestFile, parseManifest, payloadFile, payloadKey } from "../runtime/gameFiles";
import { checksum } from "../runtime/payload";
import { runtimeConfiguration } from "../runtime/config";
import { floorDiv } from "../sim/intMath";
import { on, trampoline } from "./dispatch";
import { readChunk } from "./fileio";

const POLL_SECONDS = 0.25;
const MAX_SLOTS = 4;

/** What a reloadable bundle exports: re-register handlers, keep state. */
export interface Reloadable {
  install(this: void): void;
}

/** A version waiting for every client's answer. `bundle` is this client's own load. */
interface Pending {
  version: number;
  bundle: Reloadable | string;
  waiting: number;
  refused: boolean;
}

interface HotState {
  announced: number;
  applied: number;
  hostSlot: number;
  localSlot: number;
  pending: Pending | undefined;
  /** Game time since the reloader started, which every client reads alike on a given frame. */
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

function poll(): void {
  const state = hot();
  if (state.localSlot !== state.hostSlot) return;
  const text = readChunk(manifestFile(state.announced + 1, runtimeConfiguration().filePrefix));
  if (text === undefined) return;
  state.announced++;
  BlzSendSyncData(runtimeConfiguration().announcePrefix, text);
}

/** This client's copy of an announced bundle, loaded but not run, or why it failed. */
function loadLocal(announcement: string): { version: number; bundle: Reloadable | string } | undefined {
  const manifest = parseManifest(announcement);
  if (manifest === undefined) return undefined;
  const { version, files, checksum: expected } = manifest;
  const parts: string[] = [];
  for (let index = 0; index < files; index++) parts.push(readChunk(payloadFile(expected, index, runtimeConfiguration().filePrefix)) ?? "");
  const text = parts.join("");
  if (checksum(text.length, (index) => string.byte(text, index + 1)) !== expected) return { version, bundle: "payload missing or damaged" };
  const [chunk, error] = load(text, `=hot-${payloadKey(expected)}`);
  if (chunk === undefined) return { version, bundle: error ?? "load failed" };
  // A bundle that fails while loading is refused like a damaged one, so every client still answers.
  const [ran, module] = pcall(chunk);
  if (!ran) return { version, bundle: `failed while loading: ${String(module)}` };
  return { version, bundle: isReloadable(module) ? module : "bundle exports no install()" };
}

function announced(): void {
  const state = hot();
  const local = loadLocal(BlzGetTriggerSyncData());
  if (local === undefined || local.version <= state.applied) return;
  state.pending = { ...local, waiting: playingHumans(), refused: false };
  BlzSendSyncData(runtimeConfiguration().readyPrefix, `${local.version} ${typeof local.bundle === "string" ? "refuse" : "ready"}`);
}

function answered(): void {
  const state = hot();
  const pending = state.pending;
  const [versionText, answer] = BlzGetTriggerSyncData().split(" ");
  if (pending === undefined || Number(versionText) !== pending.version) return;
  if (answer !== "ready") pending.refused = true;
  pending.waiting--;
  if (pending.waiting > 0) return;
  state.pending = undefined;
  const { version, bundle } = pending;
  if (pending.refused || typeof bundle === "string") {
    report(`hot reload ${version} not applied: ${typeof bundle === "string" ? bundle : "another client couldn't load it"}`);
    return;
  }
  bundle.install();
  state.applied = version;
  state.clock ??= startClock();
  PreloadGenClear();
  PreloadGenStart();
  Preload(acknowledgementLine(version, TimerGetElapsed(state.clock)));
  PreloadGenEnd(ackFile(state.localSlot, runtimeConfiguration().filePrefix));
  report(`hot reload ${version} applied`);
}

/** Registers the reloader's handlers; a reloaded bundle calls this again. */
export function installHotReload(): void {
  on("hotReload.poll", poll);
  on("hotReload.announced", announced);
  on("hotReload.answered", answered);
}

function onSync(prefix: string, handler: string): void {
  const trigger = CreateTrigger();
  for (let slot = 0; slot < MAX_SLOTS; slot++) BlzTriggerRegisterPlayerSyncEvent(trigger, Player(slot), prefix, false);
  TriggerAddAction(trigger, trampoline(handler));
}

/** Starts polling for new bundles; the host slot announces them. */
export function startHotReload(hostSlot: number, localSlot: number): void {
  // Versions published before this match are its baseline, not reloads.
  const configuration = runtimeConfiguration();
  const globals = globalThis as Record<`${string}Hot`, HotState | undefined>;
  globals[`${configuration.globalPrefix}Hot`] = { announced: latestVersion(), applied: 0, hostSlot, localSlot, pending: undefined };
  installHotReload();
  onSync(configuration.announcePrefix, "hotReload.announced");
  onSync(configuration.readyPrefix, "hotReload.answered");
  TimerStart(CreateTimer(), POLL_SECONDS, true, trampoline("hotReload.poll"));
}
