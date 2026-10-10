// Modules load on each client's local frame; module scope must not call natives or read synchronized state.

// Poll timers must tick alike across clients regardless of their local files.

import { acknowledgementLine, ackFile, deltaFile, formatManifest, hostFile, manifestFile, parseManifest, payloadFile, payloadKey, type Manifest } from "../runtime/gameFiles";
import { runtimeConfiguration } from "../runtime/config";
import { moduleHashText, parsePayload } from "../runtime/modules";
import { floorDiv, floorMod } from "../sim/intMath";
import { on, trampoline } from "./dispatch";
import { readChunk } from "./fileio";
import { stringChecksum } from "./payloadChecksum";
import { pollModelFailures } from "./modelFailures";

const POLL_SECONDS = 0.03125;

const IDLE_POLLS = 16;
const MAX_SLOTS = 4;

export interface Reloadable {
  install(this: void): void;
}

type Require = (this: void, name: string) => unknown;

interface LoadedModule {
  readonly hash: string;
  readonly chunk: (this: void, require: Require) => (this: void, name: string) => unknown;
}

type ModuleTable = Record<string, LoadedModule | undefined>;

interface Prepared {
  version: number;
  state: string;
  bundle: Reloadable | string;
  modules: ModuleTable;
}

interface Pending {
  manifest: Manifest;

  answered: number;
  waiting: number;
  refused: boolean;
}

interface HotState {

  applied: number;
  decided: number;
  pending: Pending | undefined;

  next: number;
  prepared: Prepared | undefined;

  unseen: number | undefined;

  modules?: ModuleTable;
  state?: string;

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
const hostSeen = () => readChunk(hostFile(runtimeConfiguration().filePrefix)) !== undefined;

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

function link(modules: ModuleTable): Require {
  const values: Record<string, { readonly value: unknown } | undefined> = {};
  const require: Require = (name) => {
    const known = values[name];
    if (known !== undefined) return known.value;
    const module = modules[name];
    if (module === undefined) throw `module '${name}' not found`;
    const value = module.chunk(require)(name);
    values[name] = { value };
    return value;
  };
  return require;
}

function loadLocal(state: HotState, manifest: Manifest): { bundle: Reloadable | string; modules: ModuleTable } {
  const prefix = runtimeConfiguration().filePrefix;
  const installed = state.modules;
  const delta = installed !== undefined && manifest.changes > 0 && manifest.base === state.state;
  const modules: ModuleTable = {};
  const refuse = (reason: string) => ({ bundle: reason, modules });
  const parts: string[] = [];
  for (let index = 0; index < (delta ? manifest.changes : manifest.files); index++) {
    parts.push(readChunk(delta ? deltaFile(manifest.state, manifest.base, index, prefix) : payloadFile(manifest.state, index, prefix)) ?? "");
  }
  const payload = parsePayload(parts.join(""));
  if (payload === undefined || stringChecksum(payload.index) !== manifest.state) return refuse("payload missing or damaged");
  for (const [name, hash] of payload.hashes) {
    const text = payload.texts[name];
    if (text === undefined) {

      const kept = delta ? installed[name] : undefined;
      if (kept === undefined || kept.hash !== hash) return refuse(`module ${name} missing`);
      modules[name] = kept;
      continue;
    }
    if (stringChecksum(moduleHashText(name, text)) !== hash) return refuse(`module ${name} damaged`);
    const [chunk, error] = load(text, `=hot-${payloadKey(hash)}`);
    if (chunk === undefined) return refuse(error ?? `module ${name} doesn't load`);
    modules[name] = { hash, chunk };
  }

  const [ran, entry] = pcall(link(modules), payload.entry);
  if (!ran) return refuse(`failed while loading: ${String(entry)}`);
  return { bundle: isReloadable(entry) ? entry : "bundle exports no install()", modules };
}

function answer(state: HotState, manifest: Manifest): void {
  if (state.next <= manifest.version) state.next = manifest.version + 1;
  const { bundle, modules } = loadLocal(state, manifest);
  state.prepared = { version: manifest.version, state: manifest.state, bundle, modules };
  BlzSendSyncData(runtimeConfiguration().readyPrefix, `${formatManifest(manifest)} ${typeof bundle === "string" ? "refuse" : "ready"}`);
}

function poll(): void {
  pollModelFailures();
  const state = hot();

  if (state.prepared !== undefined) return;
  if (state.unseen !== undefined) {
    state.unseen = floorMod(state.unseen + 1, 2 * IDLE_POLLS);

    if (state.unseen === IDLE_POLLS && hostSeen()) state.unseen = undefined;
    if (state.unseen !== 0) return;
  }
  if (state.next <= state.decided) state.next = state.decided + 1;
  const text = readChunk(manifestFile(state.next, runtimeConfiguration().filePrefix));
  if (text === undefined) return;
  state.unseen = undefined;
  const manifest = parseManifest(text);
  if (manifest === undefined || manifest.version !== state.next) {

    state.next++;
    return;
  }
  answer(state, manifest);
}

function acknowledge(version: number, elapsed: number): void {
  PreloadGenClear();
  PreloadGenStart();
  Preload(acknowledgementLine(version, elapsed));
  PreloadGenEnd(ackFile(GetPlayerId(GetLocalPlayer()), runtimeConfiguration().filePrefix));
}

function decide(state: HotState, pending: Pending): void {
  const { version, state: expected } = pending.manifest;
  state.pending = undefined;
  state.decided = version;
  const prepared = state.prepared;
  if (prepared !== undefined && prepared.version <= version) state.prepared = undefined;

  const loaded = prepared !== undefined && prepared.version === version && prepared.state === expected ? prepared : undefined;
  const bundle = loaded === undefined ? "no local copy" : loaded.bundle;
  if (pending.refused || typeof bundle === "string" || loaded === undefined) {
    const reason = typeof bundle === "string" ? bundle : "another client couldn't load it";
    report(`hot reload ${version} not applied: ${reason}`);
    return;
  }
  state.modules = loaded.modules;
  state.state = loaded.state;
  bundle.install();
  state.applied = version;
  state.clock ??= startClock();
  acknowledge(version, TimerGetElapsed(state.clock));
  report(`hot reload ${version} applied`);
}

function answered(): void {
  const state = hot();
  const text = BlzGetTriggerSyncData();
  const manifest = parseManifest(text);
  const verdict = text.split(" ")[5];
  if (manifest === undefined || manifest.version <= state.decided) return;
  let pending = state.pending;
  if (pending !== undefined && manifest.version < pending.manifest.version) return;
  if (pending === undefined || manifest.version > pending.manifest.version) {

    pending = { manifest, answered: 0, waiting: playingHumans(), refused: false };
    state.pending = pending;
  }
  const bit = 1 << GetPlayerId(GetTriggerPlayer());
  if ((pending.answered & bit) !== 0) return;
  pending.answered |= bit;
  pending.waiting--;
  if (verdict !== "ready" || manifest.state !== pending.manifest.state) pending.refused = true;
  if (state.prepared === undefined || state.prepared.version !== pending.manifest.version) answer(state, pending.manifest);
  if (pending.waiting <= 0 && state.pending === pending) decide(state, pending);
}

export function installHotReload(): void {
  on("hotReload.poll", poll);
  on("hotReload.answered", answered);
}

export function startHotReload(): void {
  const configuration = runtimeConfiguration();
  const globals = globalThis as Record<`${string}Hot`, HotState | undefined>;

  const published = latestVersion();
  const unseen = published > 0 || hostSeen() ? undefined : 1;
  globals[`${configuration.globalPrefix}Hot`] = { applied: 0, decided: 0, pending: undefined, next: published + 1, prepared: undefined, unseen };
  installHotReload();
  const trigger = CreateTrigger();
  for (let slot = 0; slot < MAX_SLOTS; slot++) BlzTriggerRegisterPlayerSyncEvent(trigger, Player(slot), configuration.readyPrefix, false);
  TriggerAddAction(trigger, trampoline("hotReload.answered"));
  TimerStart(CreateTimer(), POLL_SECONDS, true, trampoline("hotReload.poll"));

  acknowledge(0, 0);
}
