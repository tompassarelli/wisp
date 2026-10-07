// One simulated Warcraft client for headless runs (wisp:docs/headless.md).
// Every declared native is stubbed for this client, with the state the stubs
// need: handles, units, timers, triggers, the FileIO tooltips, the files the
// map writes and the host publishes, and the special effects it shows. The
// client logs every native call except the local-only ones, so clients that
// ran the same events can be compared call by call. Runtime-neutral: it runs
// in Bun and, compiled with TypeScriptToLua, in 32-bit Lua; each host puts the
// natives where its map code finds them.
import { errorFile, FILE_IO_ABILITY } from "../runtime/gameFiles";
import type { FrameTemplate } from "./frames";
import type { NativeDeclarations } from "./declarations";
import { FRAME_POINTS, type Frame, Frames } from "./frames";

export type Handle = { readonly kind: string; readonly id: number };

export interface NativeCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface SyncMessage {
  readonly sender: number;
  readonly prefix: string;
  readonly data: string;
}

/** What a map's entry exports: start once per match, install after each hot reload. */
export interface MapEntry {
  start(this: void): void;
  install(this: void): void;
}

/** Native name to why a client may call it when the others don't. */
export type LocalNatives = Readonly<Record<string, string>>;

/** A native's behavior; a host or game supplies one for a native the default stub can't answer. */
export type NativeBehavior = (this: void, ...args: never[]) => unknown;
/** Natives a host or game adds or replaces, and other globals its map code reads, such as Lua's. */
export type NativeBehaviors = Readonly<Record<string, unknown>>;

/**
 * Natives Wisp's own runtime calls on one client only. A game adds the ones
 * its code calls that way: local UI, input polling, conversions for local text.
 */
export const WISP_LOCAL_NATIVES: LocalNatives = {
  GetLocalPlayer: "identifies the client; every local branch starts here",
  GetPlayerId: "names this client's files; no effect",
  BlzSendSyncData: "only the sending client calls it; its message reaches every client as an event",
  PreloadGenClear: "local file output",
  PreloadGenStart: "local file output",
  Preload: "local file output",
  PreloadGenEnd: "local file output",
  Preloader: "local file input, synchronized only through sync data",
  BlzGetAbilityTooltip: "FileIO's local file buffer",
  BlzSetAbilityTooltip: "FileIO's local file buffer",
  DisplayTextToPlayer: "a message on this client: reload results and error reports",
  BlzFrameSetText: "the frame meter's overlay: an existing frame's text on this client",
  BlzFrameSetVisible: "the frame meter's overlay: shows an existing frame on this client",
  TimerGetElapsed: "reads a timer; the reload acknowledgement only reports it",
  BlzGetLocalSpecialEffectX: "the scene report reads an effect's local position",
  BlzGetLocalSpecialEffectY: "the scene report reads an effect's local position",
  BlzGetLocalSpecialEffectZ: "the scene report reads an effect's local position",
};

/** A special effect as the client shows it. */
export interface EffectPose {
  readonly handle: Handle;
  readonly model: string;
  /** The client frame it was created on. */
  readonly created: number;
  x: number;
  y: number;
  /** Where AddSpecialEffect puts it, 0, until the map moves it. */
  z: number;
  alpha: number;
  scale: number;
  timeScale: number;
  /** A matrix scale of zero on some axis since the matrix was last reset. */
  flat: boolean;
}

interface Unit extends Handle {
  x: number;
  y: number;
  readonly typeId: number;
  moveSpeed: number;
  attackCooldown: number;
}

type Callback = (this: void) => void;

interface Timer extends Handle {
  callback: Callback | undefined;
  periodFrames: number;
  dueFrame: number;
  startFrame: number;
  running: boolean;
}

interface Trigger extends Handle {
  readonly actions: Callback[];
  destroyed: boolean;
}

interface EventContext {
  player: number;
  syncPrefix: string;
  syncData: string;
  chat: string;
  key: number;
  timer: Timer | undefined;
  frame: Frame | undefined;
  frameEvent: unknown;
}

type Registration =
  | { readonly kind: "sync"; readonly trigger: Trigger; readonly player: number; readonly prefix: string }
  | { readonly kind: "chat"; readonly trigger: Trigger; readonly player: number; readonly text: string; readonly exact: boolean }
  | { readonly kind: "key"; readonly trigger: Trigger; readonly player: number; readonly key: number; readonly meta: number; readonly down: boolean }
  | { readonly kind: "frame"; readonly trigger: Trigger; readonly frame: Frame; readonly event: unknown };

/**
 * A client's CustomMapData folder outside the process, so another program,
 * such as an input helper, reads what the map writes and writes what it reads.
 */
export interface ClientFiles {
  /** A file the map wrote with PreloadGenEnd: its Preload lines. */
  written(this: void, name: string, lines: readonly string[]): void;
  /** What Preloader reads from a file someone else wrote: one chunk per FileIO tooltip level; undefined while it is missing. */
  read(this: void, name: string): readonly string[] | undefined;
}

/** How a host makes one client's natives and state the ones map code sees while it runs. */
export interface ClientScope {
  enter(this: void, client: HeadlessClient): void;
  leave(this: void, client: HeadlessClient): void;
}

export interface ClientOptions {
  readonly slot: number;
  /** The map's configureRuntime() filePrefix, which names the file its error reports go to. */
  readonly filePrefix: string;
  /** Player slots with a human client; the others are empty. */
  readonly humans: readonly number[];
  readonly declarations: NativeDeclarations;
  readonly localNatives: LocalNatives;
  readonly network: SyncMessage[];
  readonly screenWidth: number;
  readonly scope?: ClientScope;
  /** Added or replacing natives; values that aren't declared natives, such as Lua globals, are set unlogged. */
  readonly natives?: (this: void, client: HeadlessClient) => NativeBehaviors;
  readonly files?: ClientFiles;
  /** Frame definitions (wisp:docs/ui.md) whose trees BlzCreateFrame makes by name, as their generated FDF does in Warcraft. */
  readonly frames?: readonly FrameTemplate[];
}

export const FRAMES_PER_SECOND = 60;

const isHandle = (value: unknown): value is Handle =>
  typeof value === "object" && value !== null && "id" in value && "kind" in value;

const isFrame = (value: unknown): value is Frame => typeof value === "object" && value !== null && "points" in value;

function isDigits(text: string): boolean {
  const start = text.startsWith("-") ? 1 : 0;
  if (text.length <= start) return false;
  for (let index = start; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

/**
 * A number as both runtimes print it alike: an integer in digits, any other
 * value exactly, as an integer times a power of two. Lua prints 3.0 for a
 * float that JavaScript prints as 3, and neither prints every binary digit.
 */
export function describeNumber(value: number): string {
  if (value !== value) return "nan";
  if (value === Infinity) return "inf";
  if (value === -Infinity) return "-inf";
  if (value === 0) return "0";
  const text = String(value);
  if (isDigits(text)) return text;
  let mantissa = value;
  let exponent = 0;
  while (mantissa !== Math.floor(mantissa) && exponent < 1100) {
    mantissa *= 2;
    exponent++;
  }
  return exponent === 0 ? mantissa.toFixed(0) : `${mantissa.toFixed(0)}p-${exponent}`;
}

/** A native argument, the same on every client and in both runtimes: handles by kind and number, callbacks as `fn`. */
export function describeValue(value: unknown): string {
  if (value === undefined || value === null) return "nil";
  if (typeof value === "number") return describeNumber(value);
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "function") return "fn";
  if (isHandle(value)) return `${value.kind}#${describeNumber(value.id)}`;
  return "table";
}

export function describeCall({ name, args }: NativeCall): string {
  let call = `${name}(`;
  for (let index = 0; index < args.length; index++) {
    if (index > 0) call += ", ";
    call += describeValue(args[index]);
  }
  return `${call})`;
}

/** Whether two clients made the same call: equal values, handles with the same kind and number, any two callbacks. */
export function sameCall(left: NativeCall, right: NativeCall): boolean {
  if (left.name !== right.name || left.args.length !== right.args.length) return false;
  for (let index = 0; index < left.args.length; index++) {
    const leftArg = left.args[index];
    const rightArg = right.args[index];
    if (leftArg === rightArg) continue;
    if (typeof leftArg === "function" && typeof rightArg === "function") continue;
    if (isHandle(leftArg) && isHandle(rightArg)) {
      if (leftArg.id !== rightArg.id || leftArg.kind !== rightArg.kind) return false;
      continue;
    }
    if (describeValue(leftArg) !== describeValue(rightArg)) return false;
  }
  return true;
}

/** JASS S2I and S2R read a leading number and ignore the rest; no digits read as 0. */
function leadingNumber(text: string, fraction: boolean): number {
  let start = 0;
  while (start < text.length && text.charAt(start) === " ") start++;
  let end = start;
  if (end < text.length && (text.charAt(end) === "-" || text.charAt(end) === "+")) end++;
  let digits = 0;
  let point = false;
  while (end < text.length) {
    const character = text.charAt(end);
    if (character >= "0" && character <= "9") digits++;
    else if (fraction && character === "." && !point) point = true;
    else break;
    end++;
  }
  if (digits === 0) return 0;
  const value = Number(text.slice(start, end));
  return value === value ? value : 0;
}

/**
 * Mixes an integer into a 32-bit hash. The product stays below 2^53, so
 * JavaScript computes it exactly, and `| 0` keeps its low 32 bits, as 32-bit
 * Lua's wrapping integers do.
 */
const mix = (hash: number, value: number) => (hash * 1000003 + value) | 0;

function mixText(hash: number, text: string): number {
  let mixed = hash;
  for (let index = 0; index < text.length; index++) mixed = mix(mixed, text.charCodeAt(index));
  return mix(mixed, text.length);
}

/** Native names and handle kinds recur in every call, so each is hashed once. */
const nameHashes = new Map<string, number>();

function mixCall(hash: number, { name, args }: NativeCall): number {
  let mixed = mixName(hash, name);
  for (let index = 0; index < args.length; index++) mixed = mixValue(mixed, args[index]);
  return mixed;
}

function mixName(hash: number, name: string): number {
  let named = nameHashes.get(name);
  if (named === undefined) {
    named = mixText(0, name);
    nameHashes.set(name, named);
  }
  return mix(hash, named);
}

const INT32_LIMIT = 2147483648;

/** An argument as describeValue identifies it, with a tag per kind of value. */
function mixValue(hash: number, value: unknown): number {
  if (typeof value === "number") {
    // Math.floor makes an integral Lua float an integer, which Lua's `|` needs.
    if (value === Math.floor(value) && value >= -INT32_LIMIT && value < INT32_LIMIT) return mix(mix(hash, 1), Math.floor(value));
    return mixText(mix(hash, 2), describeNumber(value));
  }
  if (typeof value === "string") return mixText(mix(hash, 3), value);
  if (typeof value === "boolean") return mix(hash, value ? 4 : 5);
  if (typeof value === "function") return mix(hash, 6);
  if (isHandle(value)) return mix(mixName(mix(hash, 7), value.kind), value.id);
  return mix(hash, value === undefined || value === null ? 8 : 9);
}

export class HeadlessClient {
  readonly slot: number;
  /** Every native call the other clients must make alike, in order, since the calls forget() dropped. */
  readonly log: NativeCall[] = [];
  /** Calls forget() dropped from the front of `log`; the checksum still covers them. */
  forgotten = 0;
  private forgottenHash = 0;
  /** Error reports the map wrote to its error file, shown on screen or not: `error in HANDLER: MESSAGE`. */
  readonly errors: string[] = [];
  /** Every message the map showed this client. */
  readonly messages: string[] = [];
  /** Where the host keeps what a thrown error says beyond the map's report, such as a JavaScript stack. */
  readonly thrown: string[] = [];
  /** Files the map wrote, by name: their Preload lines. */
  readonly files = new Map<string, string[]>();
  /** Files the host put in CustomMapData for Preloader: one chunk per FileIO tooltip level. */
  readonly published = new Map<string, readonly string[]>();
  /**
   * Preloader calls for a file nobody had published, which Wine answers by
   * reading the folder that should hold it: all of CustomMapData when the
   * file's own folder is missing too (wisp:docs/hot-reload.md).
   */
  missedLookups = 0;
  readonly natives: Record<string, unknown> = {};
  /** Frames this client has run. */
  frame = 0;
  private nextId = 0;
  private readonly scope: ClientScope | undefined;
  private readonly filePrefix: string;
  private readonly timers: Timer[] = [];
  private readonly registrations: Registration[] = [];
  private readonly memo = new Map<string, Frame>();
  private allPlayers: Handle | undefined;
  private readonly effects = new Map<Handle, EffectPose>();
  private readonly tooltips = new Map<string, string>();
  /** Preloader runs the content it first read from a path for the rest of the session. */
  private readonly preloaded = new Map<string, readonly string[]>();
  private event: EventContext = { player: 0, syncPrefix: "", syncData: "", chat: "", key: 0, timer: undefined, frame: undefined, frameEvent: undefined };
  private preload: string[] = [];
  private readonly stored: ClientFiles | undefined;
  /** The frames this client shows: their text, places, and which takes a click or the keyboard. */
  readonly frames: Frames;

  constructor(options: ClientOptions) {
    this.slot = options.slot;
    this.scope = options.scope;
    this.filePrefix = options.filePrefix;
    this.stored = options.files;
    const behaviors = this.behaviors(options);
    const local = options.localNatives;
    const log = this.log;
    // A call's arguments land in one array that the log keeps, so the common
    // arities take them as parameters rather than as a rest array to spread.
    const logged = (name: string, parameters: number, behave: (this: void, ...args: unknown[]) => unknown): ((this: void, ...args: unknown[]) => unknown) => {
      switch (parameters) {
        case 0: return () => {
          log.push({ name, args: [] });
          return behave();
        };
        case 1: return (a: unknown) => {
          log.push({ name, args: [a] });
          return behave(a);
        };
        case 2: return (a: unknown, b: unknown) => {
          log.push({ name, args: [a, b] });
          return behave(a, b);
        };
        case 3: return (a: unknown, b: unknown, c: unknown) => {
          log.push({ name, args: [a, b, c] });
          return behave(a, b, c);
        };
        case 4: return (a: unknown, b: unknown, c: unknown, d: unknown) => {
          log.push({ name, args: [a, b, c, d] });
          return behave(a, b, c, d);
        };
        default: return (...args: unknown[]) => {
          log.push({ name, args });
          return behave(...args);
        };
      }
    };
    const arity = new Map<string, number>();
    const declared = new Set<string>();
    for (const [name, returns, parameters] of options.declarations.functions) {
      declared.add(name);
      arity.set(name, parameters);
      const behave = (behaviors[name] ?? (name.startsWith("Convert") ? (value: unknown) => value : this.defaultNative(returns))) as (this: void, ...args: unknown[]) => unknown;
      this.natives[name] = local[name] === undefined ? logged(name, parameters, behave) : behave;
    }
    // A constant of a handle type is its own name, so comparisons with it work.
    for (const [name, type] of options.declarations.constants) this.natives[name] = type === "number" ? 0 : type === "boolean" ? name === "TRUE" : name;
    for (const [name, type] of options.declarations.variables) this.natives[name] = this.defaultValue(type);
    const points = new Map<unknown, readonly [number, number]>();
    for (let index = 0; index < FRAME_POINTS.length; index++) {
      const [name, fromLeft, fromTop] = FRAME_POINTS[index] ?? ["", 0, 0];
      points.set(this.natives[name] ?? name, [fromLeft, fromTop]);
      points.set(index, [fromLeft, fromTop]);
    }
    this.frames = new Frames(points);
    this.frames.define(options.frames ?? []);
    const extra = options.natives?.(this) ?? {};
    for (const name of Object.keys(extra)) {
      const value = extra[name];
      this.natives[name] = typeof value === "function" && declared.has(name) && local[name] === undefined
        ? logged(name, arity.get(name) ?? 5, value as (this: void, ...args: unknown[]) => unknown)
        : value;
    }
  }

  private handle(kind: string): Handle {
    this.nextId++;
    return { kind, id: this.nextId };
  }

  private defaultNative(returns: string): (this: void, ...args: unknown[]) => unknown {
    switch (returns) {
      case "void": return () => undefined;
      case "number": return () => 0;
      case "string": return () => "";
      case "boolean": return () => false;
      default: return () => this.handle(returns);
    }
  }

  private defaultValue(type: string): unknown {
    if (type.endsWith("[]")) return [];
    switch (type) {
      case "boolean": return false;
      case "number": return 0;
      case "string": return "";
      default: return this.handle(type);
    }
  }

  /** A frame Warcraft made, such as an origin frame: one handle per frame, made at its first lookup. */
  private memoized(key: string, name = ""): Frame {
    const known = this.memo.get(key);
    if (known !== undefined) return known;
    const created = this.frames.add(this.handle("framehandle"), "", name, undefined, 0);
    this.memo.set(key, created);
    return created;
  }

  private created(type: string, name: string, owner: unknown, context: number): Frame {
    return this.frames.add(this.handle("framehandle"), type, name, isFrame(owner) ? owner : undefined, context);
  }

  private effectAt(model: string, x: number, y: number): Handle {
    const handle = this.handle("effect");
    this.effects.set(handle, { handle, model, created: this.frame, x, y, z: 0, alpha: 255, scale: 1, timeScale: 1, flat: false });
    return handle;
  }

  private show(text: string): void {
    this.messages.push(text);
  }

  /** A report file's lines as the screen would show them: its heading names the handler, its next line the message. */
  private report(lines: readonly string[]): void {
    const heading = lines[0] ?? "";
    this.errors.push(`error in ${heading.slice(heading.indexOf(" in ") + 4)}: ${lines[1] ?? ""}`);
  }

  private behaviors({ humans, network, screenWidth }: ClientOptions): Readonly<Record<string, NativeBehavior>> {
    const playing = (player: number) => humans.includes(player);
    return {
      GetLocalPlayer: () => this.slot,
      Player: (n: number) => n,
      GetPlayerId: (player: number) => player,
      GetTriggerPlayer: () => this.event.player,
      GetHandleId: (handle: unknown) => (isHandle(handle) ? handle.id : handle),
      GetPlayerController: (player: number) => (playing(player) ? "MAP_CONTROL_USER" : "MAP_CONTROL_NONE"),
      GetPlayerSlotState: (player: number) => (playing(player) ? "PLAYER_SLOT_STATE_PLAYING" : "PLAYER_SLOT_STATE_EMPTY"),
      GetPlayersAll: () => {
        if (this.allPlayers === undefined) this.allPlayers = this.handle("force");
        return this.allPlayers;
      },
      CreateUnit: (_owner: number, typeId: number, x: number, y: number): Unit => ({ ...this.handle("unit"), typeId, x, y, moveSpeed: 0, attackCooldown: 0 }),
      GetUnitTypeId: (unit: Unit) => unit.typeId,
      GetUnitX: (unit: Unit) => unit.x,
      GetUnitY: (unit: Unit) => unit.y,
      SetUnitX: (unit: Unit, x: number) => {
        unit.x = x;
      },
      SetUnitY: (unit: Unit, y: number) => {
        unit.y = y;
      },
      SetUnitPosition: (unit: Unit, x: number, y: number) => {
        unit.x = x;
        unit.y = y;
      },
      SetUnitMoveSpeed: (unit: Unit, value: number) => {
        unit.moveSpeed = value;
      },
      GetUnitMoveSpeed: (unit: Unit) => unit.moveSpeed,
      BlzSetUnitAttackCooldown: (unit: Unit, value: number) => {
        unit.attackCooldown = value;
      },
      BlzGetUnitAttackCooldown: (unit: Unit) => unit.attackCooldown,
      BlzGetLocalClientWidth: () => screenWidth,
      BlzGetLocalClientHeight: () => 1080,
      BlzIsLocalClientActive: () => true,
      BlzLoadTOCFile: () => true,
      // A frame getter returns one handle per frame, made at its first call.
      BlzGetOriginFrame: (type: unknown, index: number) => this.memoized(`origin ${describeValue(type)} ${index}`),
      BlzGetFrameByName: (name: string, context: number) => this.frames.named(name, context) ?? this.memoized(`name ${name} ${context}`, name),
      BlzFrameGetChild: (frame: Handle, index: number) => this.memoized(`child ${frame.id} ${index}`),
      BlzCreateFrame: (name: string, owner: unknown, _priority: number, context: number) => this.frames.create(() => this.handle("framehandle"), name, isFrame(owner) ? owner : undefined, context),
      BlzCreateSimpleFrame: (name: string, owner: unknown, context: number) => this.created(name, name, owner, context),
      BlzCreateFrameByType: (type: string, name: string, owner: unknown, _inherits: string, context: number) => this.created(type, name, owner, context),
      BlzDestroyFrame: (frame: unknown) => {
        if (isFrame(frame)) this.frames.destroy(frame);
      },
      BlzFrameGetName: (frame: unknown) => (isFrame(frame) ? frame.name : ""),
      BlzFrameGetParent: (frame: unknown) => (isFrame(frame) ? frame.parent : undefined),
      BlzFrameSetText: (frame: unknown, text: string) => {
        if (isFrame(frame)) frame.text = text;
      },
      BlzFrameGetText: (frame: unknown) => (isFrame(frame) ? frame.text : ""),
      BlzFrameSetTextSizeLimit: (frame: unknown, size: number) => {
        if (isFrame(frame)) frame.textLimit = size;
      },
      BlzFrameGetTextSizeLimit: (frame: unknown) => (isFrame(frame) ? frame.textLimit : 0),
      BlzFrameSetVisible: (frame: unknown, visible: boolean) => {
        if (isFrame(frame)) frame.visible = visible;
      },
      BlzFrameIsVisible: (frame: unknown) => (isFrame(frame) ? frame.visible : false),
      BlzFrameSetEnable: (frame: unknown, enabled: boolean) => {
        if (isFrame(frame)) frame.enabled = enabled;
      },
      BlzFrameGetEnable: (frame: unknown) => (isFrame(frame) ? frame.enabled : false),
      BlzFrameSetFocus: (frame: unknown, flag: boolean) => {
        if (isFrame(frame)) this.frames.focus(frame, flag);
      },
      BlzFrameSetLevel: (frame: unknown, level: number) => {
        if (isFrame(frame)) frame.level = level;
      },
      BlzFrameSetSize: (frame: unknown, width: number, height: number) => {
        if (isFrame(frame)) {
          frame.width = width;
          frame.height = height;
        }
      },
      BlzFrameSetAbsPoint: (frame: unknown, point: unknown, x: number, y: number) => {
        if (isFrame(frame)) frame.points.set(point, { x, y });
      },
      BlzFrameClearAllPoints: (frame: unknown) => {
        if (isFrame(frame)) frame.points.clear();
      },
      BlzTriggerRegisterFrameEvent: (trigger: Trigger, frame: unknown, event: unknown) => {
        if (isFrame(frame)) this.registrations.push({ kind: "frame", trigger, frame, event });
        return this.handle("event");
      },
      BlzGetTriggerFrame: () => this.event.frame,
      BlzGetTriggerFrameEvent: () => this.event.frameEvent,
      BlzGetTriggerFrameText: () => this.event.frame?.text ?? "",
      BlzGetTriggerSyncData: () => this.event.syncData,
      BlzGetTriggerSyncPrefix: () => this.event.syncPrefix,
      GetEventPlayerChatString: () => this.event.chat,
      BlzGetTriggerPlayerKey: () => this.event.key,
      GetExpiredTimer: () => this.event.timer,
      CreateTrigger: (): Trigger => ({ ...this.handle("trigger"), actions: [], destroyed: false }),
      DestroyTrigger: (trigger: Trigger) => {
        trigger.destroyed = true;
      },
      TriggerAddAction: (trigger: Trigger, action: Callback) => {
        trigger.actions.push(action);
        return this.handle("triggeraction");
      },
      BlzTriggerRegisterPlayerSyncEvent: (trigger: Trigger, player: number, prefix: string) => {
        this.registrations.push({ kind: "sync", trigger, player, prefix });
        return this.handle("event");
      },
      TriggerRegisterPlayerChatEvent: (trigger: Trigger, player: number, text: string, exact: boolean) => {
        this.registrations.push({ kind: "chat", trigger, player, text, exact });
        return this.handle("event");
      },
      BlzTriggerRegisterPlayerKeyEvent: (trigger: Trigger, player: number, key: number, meta: number, down: boolean) => {
        this.registrations.push({ kind: "key", trigger, player, key, meta, down });
        return this.handle("event");
      },
      CreateTimer: (): Timer => {
        const timer: Timer = { ...this.handle("timer"), callback: undefined, periodFrames: 0, dueFrame: 0, startFrame: 0, running: false };
        this.timers.push(timer);
        return timer;
      },
      TimerStart: (timer: Timer, timeout: number, periodic: boolean, callback: Callback) => {
        const frames = Math.max(periodic ? 1 : 0, Math.round(timeout * FRAMES_PER_SECOND));
        timer.callback = callback;
        timer.periodFrames = periodic ? frames : 0;
        timer.dueFrame = this.frame + Math.max(1, frames);
        timer.startFrame = this.frame;
        timer.running = true;
      },
      PauseTimer: (timer: Timer) => {
        timer.running = false;
      },
      DestroyTimer: (timer: Timer) => {
        timer.running = false;
      },
      TimerGetElapsed: (timer: Timer) => (this.frame - timer.startFrame) / FRAMES_PER_SECOND,
      BlzSendSyncData: (prefix: string, data: string) => {
        network.push({ sender: this.slot, prefix, data });
        return true;
      },
      DisplayTextToPlayer: (player: number, _x: number, _y: number, text: string) => {
        if (player === this.slot) this.show(text);
      },
      DisplayTimedTextToPlayer: (player: number, _x: number, _y: number, _duration: number, text: string) => {
        if (player === this.slot) this.show(text);
      },
      DisplayTextToForce: (_force: unknown, text: string) => this.show(text),
      PreloadGenClear: () => {
        this.preload = [];
      },
      Preload: (line: string) => {
        this.preload.push(line);
      },
      PreloadGenEnd: (name: string) => {
        this.files.set(name, this.preload);
        if (name === errorFile(this.slot, this.filePrefix)) this.report(this.preload);
        this.stored?.written(name, this.preload);
      },
      // A published file's Preload code sets one FileIO tooltip level per chunk.
      Preloader: (name: string) => {
        const chunks = this.preloaded.get(name) ?? this.published.get(name) ?? this.stored?.read(name);
        if (chunks === undefined) {
          this.missedLookups++;
          return;
        }
        this.preloaded.set(name, chunks);
        for (let level = 0; level < chunks.length; level++) this.tooltips.set(`${FILE_IO_ABILITY} ${level}`, chunks[level] ?? "");
      },
      BlzSetAbilityTooltip: (ability: number, text: string, level: number) => {
        this.tooltips.set(`${ability} ${level}`, text);
      },
      BlzGetAbilityTooltip: (ability: number, level: number) => this.tooltips.get(`${ability} ${level}`) ?? "",
      AddSpecialEffect: (model: string, x: number, y: number) => this.effectAt(model, x, y),
      AddSpecialEffectLoc: (model: string) => this.effectAt(model, 0, 0),
      AddSpecialEffectTarget: (model: string, target: unknown) => {
        const unit = target as Partial<Unit>;
        return this.effectAt(model, unit.x ?? 0, unit.y ?? 0);
      },
      DestroyEffect: (effect: Handle) => {
        this.effects.delete(effect);
      },
      // An effect that was destroyed or never made changes nothing.
      BlzSetSpecialEffectPosition: (effect: Handle, x: number, y: number, z: number) => {
        const pose = this.effects.get(effect);
        if (pose === undefined) return;
        pose.x = x;
        pose.y = y;
        pose.z = z;
      },
      BlzSetSpecialEffectX: (effect: Handle, x: number) => {
        const pose = this.effects.get(effect);
        if (pose !== undefined) pose.x = x;
      },
      BlzSetSpecialEffectY: (effect: Handle, y: number) => {
        const pose = this.effects.get(effect);
        if (pose !== undefined) pose.y = y;
      },
      BlzSetSpecialEffectZ: (effect: Handle, z: number) => {
        const pose = this.effects.get(effect);
        if (pose !== undefined) pose.z = z;
      },
      BlzSetSpecialEffectAlpha: (effect: Handle, alpha: number) => {
        const pose = this.effects.get(effect);
        if (pose !== undefined) pose.alpha = alpha;
      },
      BlzSetSpecialEffectScale: (effect: Handle, scale: number) => {
        const pose = this.effects.get(effect);
        if (pose !== undefined) pose.scale = scale;
      },
      BlzSetSpecialEffectTimeScale: (effect: Handle, timeScale: number) => {
        const pose = this.effects.get(effect);
        if (pose !== undefined) pose.timeScale = timeScale;
      },
      BlzSetSpecialEffectMatrixScale: (effect: Handle, x: number, y: number, z: number) => {
        const pose = this.effects.get(effect);
        if (pose !== undefined) pose.flat = pose.flat || x === 0 || y === 0 || z === 0;
      },
      BlzResetSpecialEffectMatrix: (effect: Handle) => {
        const pose = this.effects.get(effect);
        if (pose !== undefined) pose.flat = false;
      },
      BlzGetLocalSpecialEffectX: (effect: Handle) => this.effects.get(effect)?.x ?? 0,
      BlzGetLocalSpecialEffectY: (effect: Handle) => this.effects.get(effect)?.y ?? 0,
      BlzGetLocalSpecialEffectZ: (effect: Handle) => this.effects.get(effect)?.z ?? 0,
      I2S: (n: number) => describeNumber(n),
      R2S: (n: number) => n.toFixed(3),
      R2I: (n: number) => (n < 0 ? Math.ceil(n) : Math.floor(n)),
      I2R: (n: number) => n,
      S2I: (text: string) => {
        const value = leadingNumber(text, false);
        return value < 0 ? Math.ceil(value) : Math.floor(value);
      },
      S2R: (text: string) => Math.fround(leadingNumber(text, true)),
      SubString: (text: string, start: number, end: number) => text.substring(start, end),
      StringLength: (text: string) => text.length,
      SquareRoot: (n: number) => Math.fround(Math.sqrt(n)),
      Atan2: (y: number, x: number) => Math.fround(Math.atan2(y, x)),
      BlzBitAnd: (a: number, b: number) => a & b,
      BlzBitOr: (a: number, b: number) => a | b,
      BlzBitXor: (a: number, b: number) => a ^ b,
    };
  }

  /** The published files Preloader has read in this client, in the order it first read them. */
  preloadedFiles(): string[] {
    return [...this.preloaded.keys()];
  }

  /** The effects this client shows now, as copies, in creation order. */
  effectPoses(): EffectPose[] {
    const poses: EffectPose[] = [];
    for (const pose of this.effects.values()) poses.push({ ...pose });
    return poses;
  }

  /** Makes this client's natives and state the ones map code sees, and runs `body`. */
  run(body: (this: void) => void): void {
    this.scope?.enter(this);
    try {
      body();
    } finally {
      this.scope?.leave(this);
    }
  }

  private fire(trigger: Trigger, event: Partial<EventContext>): void {
    if (trigger.destroyed) return;
    if (event.player !== undefined) this.event.player = event.player;
    if (event.syncPrefix !== undefined) this.event.syncPrefix = event.syncPrefix;
    if (event.syncData !== undefined) this.event.syncData = event.syncData;
    if (event.chat !== undefined) this.event.chat = event.chat;
    if (event.key !== undefined) this.event.key = event.key;
    if (event.frame !== undefined) this.event.frame = event.frame;
    if (event.frameEvent !== undefined) this.event.frameEvent = event.frameEvent;
    for (const action of trigger.actions) action();
  }

  /** One game frame: every due timer, in creation order. */
  step(): void {
    this.run(() => {
      this.frame++;
      const count = this.timers.length;
      for (let index = 0; index < count; index++) {
        const timer = this.timers[index];
        if (timer === undefined || !timer.running || timer.dueFrame > this.frame || timer.callback === undefined) continue;
        if (timer.periodFrames > 0) timer.dueFrame += timer.periodFrames;
        else timer.running = false;
        this.event.timer = timer;
        timer.callback();
      }
    });
  }

  deliverSync({ sender, prefix, data }: SyncMessage): void {
    this.run(() => {
      for (const registration of [...this.registrations]) {
        if (registration.kind === "sync" && registration.player === sender && registration.prefix === prefix) {
          this.fire(registration.trigger, { player: sender, syncPrefix: prefix, syncData: data });
        }
      }
    });
  }

  chat(sender: number, message: string): void {
    this.run(() => {
      for (const registration of [...this.registrations]) {
        if (registration.kind !== "chat" || registration.player !== sender) continue;
        if (registration.exact ? message === registration.text : message.includes(registration.text)) this.fire(registration.trigger, { player: sender, chat: message });
      }
    });
  }

  key(sender: number, key: number, meta: number, down: boolean): void {
    this.run(() => {
      for (const registration of [...this.registrations]) {
        if (registration.kind === "key" && registration.player === sender && registration.key === key && registration.meta === meta && registration.down === down) {
          this.fire(registration.trigger, { player: sender, key });
        }
      }
    });
  }

  /**
   * Text this client's keyboard types: into the edit box that has the
   * keyboard, while the player sees it. False when none has it, so Warcraft
   * would take the text as key presses.
   */
  type(text: string): boolean {
    return this.frames.type(text);
  }

  /** The frame a click at (x, y), in Warcraft's UI coordinates, reaches on this client: shown, enabled and registered for clicks. */
  clickTarget(x: number, y: number): Frame | undefined {
    const click = this.natives.FRAMEEVENT_CONTROL_CLICK;
    return this.frames.at(x, y, (frame) => this.registrations.some((registration) =>
      registration.kind === "frame" && registration.frame === frame && registration.event === click && !registration.trigger.destroyed));
  }

  /** A frame event from `sender` on the frame with this handle number, as every client receives it. */
  frameEvent(sender: number, id: number, event: unknown): void {
    this.run(() => {
      for (const registration of [...this.registrations]) {
        if (registration.kind === "frame" && registration.frame.id === id && registration.event === event) {
          this.fire(registration.trigger, { player: sender, frame: registration.frame, frameEvent: event });
        }
      }
    });
  }

  /** Every call this client logged, forgotten ones included. */
  callCount(): number {
    return this.forgotten + this.log.length;
  }

  /** Folds the first `count` logged calls into the checksum and drops them, so a long run keeps its memory. */
  forget(count: number): void {
    let hash = this.forgottenHash;
    for (let index = 0; index < count; index++) {
      const call = this.log[index];
      if (call !== undefined) hash = mixCall(hash, call);
    }
    this.forgottenHash = hash;
    this.log.splice(0, count);
    this.forgotten += count;
  }

  /** A 32-bit hash of every logged call: its name and arguments as describeValue identifies them. Equal logs hash alike in Bun and Lua. */
  checksum(): string {
    let hash = this.forgottenHash;
    for (const call of this.log) hash = mixCall(hash, call);
    return describeNumber(hash);
  }
}
