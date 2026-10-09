// Development hot reload. `wisp hot` writes each version's payload files and
// then its manifest into every client's CustomMapData. Every client polls for
// its own next manifest, and as soon as it appears loads and verifies its copy
// and broadcasts its answer: ready or refuse, with the manifest it loaded. A
// client that has not found that version yet loads it when the first answer
// arrives. When every playing human has answered, all clients install the
// version on that same frame, or all refuse it, so a file problem on one client
// can't split the simulations. Match state is untouched: it lives in globals
// the new code reads. The reloader's own handlers are reinstalled too, so it
// can reload itself.
//
// A version is a module set (wisp:src/runtime/modules.ts). A client keeps the
// modules it installed; when they are the version's base it reads only the
// delta, the modules that changed, and links every other module from its own
// table. Otherwise, as on the first reload after the map's own bundle, it
// reads the full payload. Either way it checks the whole resulting state: the
// index's checksum is the version's state hash, every module it loads matches
// its hash in the index, and every client answers with that state.
//
// Each client evaluates a version's modules when its own files arrive, on its
// own frame, so module scope must not call Warcraft natives or read
// synchronized state.
//
// A missing file costs a read of the folder that should hold it: of all of
// CustomMapData when the hot folder doesn't exist. So until a client has seen a
// host (its marker or a manifest) it looks for each only once a second, and
// polls for every manifest 32 times a second afterwards. The poll timer never
// changes: it ticks alike in every client, because a client's timer state must
// not depend on what its own files hold.
import { acknowledgementLine, ackFile, deltaFile, formatManifest, hostFile, manifestFile, parseManifest, payloadFile, payloadKey, type Manifest } from "../runtime/gameFiles";
import { runtimeConfiguration } from "../runtime/config";
import { moduleHashText, parsePayload } from "../runtime/modules";
import { floorDiv, floorMod } from "../sim/intMath";
import { on, trampoline } from "./dispatch";
import { readChunk } from "./fileio";
import { stringChecksum } from "./payloadChecksum";
import { pollModelFailures } from "./modelFailures";

// 1/32 s: once a host has been seen, each poll is one Preloader call for a manifest that doesn't exist yet.
const POLL_SECONDS = 0.03125;
// Until then a lookup every 16 polls (0.5 s), for the host's marker and the next manifest in turn:
// at most two Preloader lookups a second.
const IDLE_POLLS = 16;
const MAX_SLOTS = 4;

/** What a reloadable bundle exports: re-register handlers, keep state. */
export interface Reloadable {
  install(this: void): void;
}

type Require = (this: void, name: string) => unknown;

/** A module this client loaded: its hash and its chunk, which links it against a require. */
interface LoadedModule {
  readonly hash: string;
  readonly chunk: (this: void, require: Require) => (this: void, name: string) => unknown;
}

type ModuleTable = Record<string, LoadedModule | undefined>;

/** This client's load of a version it answered, or why it failed. Local to this client. */
interface Prepared {
  version: number;
  state: string;
  bundle: Reloadable | string;
  modules: ModuleTable;
}

/** The newest version answered by some client and not yet decided. Synchronized. */
interface Pending {
  manifest: Manifest;
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
  /** Local: until this client has seen the host's marker or a manifest, its polls since a lookup round began. */
  unseen: number | undefined;
  /** Local: the modules this client runs and their state; undefined while it runs the map's own bundle. */
  modules?: ModuleTable;
  state?: string;
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
const hostSeen = () => readChunk(hostFile(runtimeConfiguration().filePrefix)) !== undefined;

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

/** A require over `modules`, as TypeScriptToLua's bundle defines it: each module runs once, on its first require. */
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

/** This client's copy of a version, linked and evaluated but not installed, or why it failed. */
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
      // Unchanged since the base this client runs.
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
  // A version that fails while its modules load is refused like a damaged one, so every client still answers.
  const [ran, entry] = pcall(link(modules), payload.entry);
  if (!ran) return refuse(`failed while loading: ${String(entry)}`);
  return { bundle: isReloadable(entry) ? entry : "bundle exports no install()", modules };
}

/** Loads this client's copy of a version and tells every client whether it is ready. */
function answer(state: HotState, manifest: Manifest): void {
  if (state.next <= manifest.version) state.next = manifest.version + 1;
  const { bundle, modules } = loadLocal(state, manifest);
  state.prepared = { version: manifest.version, state: manifest.state, bundle, modules };
  BlzSendSyncData(runtimeConfiguration().readyPrefix, `${formatManifest(manifest)} ${typeof bundle === "string" ? "refuse" : "ready"}`);
}

function poll(): void {
  pollModelFailures();
  const state = hot();
  // One version at a time: the next waits for the decision on the one this client answered.
  if (state.prepared !== undefined) return;
  if (state.unseen !== undefined) {
    state.unseen = floorMod(state.unseen + 1, 2 * IDLE_POLLS);
    // The marker proves the hot folder exists, so every poll after it is cheap.
    if (state.unseen === IDLE_POLLS && hostSeen()) state.unseen = undefined;
    if (state.unseen !== 0) return;
  }
  if (state.next <= state.decided) state.next = state.decided + 1;
  const text = readChunk(manifestFile(state.next, runtimeConfiguration().filePrefix));
  if (text === undefined) return;
  state.unseen = undefined;
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
  const { version, state: expected } = pending.manifest;
  state.pending = undefined;
  state.decided = version;
  const prepared = state.prepared;
  if (prepared !== undefined && prepared.version <= version) state.prepared = undefined;
  // Every client answered ready with this state, so each holds its own load of it.
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
    // The first answer for a newer version supersedes an undecided older one.
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
  const published = latestVersion();
  const unseen = published > 0 || hostSeen() ? undefined : 1;
  globals[`${configuration.globalPrefix}Hot`] = { applied: 0, decided: 0, pending: undefined, next: published + 1, prepared: undefined, unseen };
  installHotReload();
  const trigger = CreateTrigger();
  for (let slot = 0; slot < MAX_SLOTS; slot++) BlzTriggerRegisterPlayerSyncEvent(trigger, Player(slot), configuration.readyPrefix, false);
  TriggerAddAction(trigger, trampoline("hotReload.answered"));
  TimerStart(CreateTimer(), POLL_SECONDS, true, trampoline("hotReload.poll"));
  // The match is running in this client; a fresh-match journey waits for this.
  acknowledge(0, 0);
}
