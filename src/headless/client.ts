import { errorFile, FILE_IO_ABILITY } from "../runtime/gameFiles";
import { addFloat32, addFloat32TowardZero, divideFloat32, multiplyFloat32TowardZero, roundToFloat32, subtractFloat32, subtractFloat32TowardZero } from "../sim/binary32";
import { f32 } from "../sim/f32";
import { steppedFrames } from "./frameCount";
import { advanceAnimation, type AnimationBlend, type AnimationState, freshAnimation, seekAnimation, selectAnimation } from "./animation";
import type { FrameTemplate } from "./frames";
import type { NativeDeclarations } from "./declarations";
import { FRAME_POINTS, type Frame, Frames } from "./frames";
import { Warcraft3Abilities, type AbilityObjectFixtures } from "./warcraft3Abilities";
import { WARCRAFT3_ENUM_VALUES } from "./warcraft3Natives";
import { Scenery, type SceneryFixtures } from "./warcraft3Scenery";
import { TextTags } from "./textTags";
import { Lightnings } from "./lightnings";
import { Warcraft3Inventory, type Warcraft3InventoryFixtures } from "./warcraft3Inventory";
import { FRAMES_PER_SECOND } from "./frameRate";

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

export interface MapEntry {
  start(this: void): void;
  install(this: void): void;
}

export type LocalNatives = Readonly<Record<string, string>>;

export type IntentionalNoops = Readonly<Record<string, string>>;

export interface MissingNative {
  readonly native: string;
  readonly client: number;
  readonly frame: number;
}

export type NativeBehavior = (this: void, ...args: never[]) => unknown;

export type NativeBehaviors = Readonly<Record<string, unknown>>;

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

export interface EffectPose extends AnimationState {
  readonly handle: Handle;
  readonly model: string;

  readonly created: number;
  x: number;
  y: number;

  z: number;
  alpha: number;
  scale: number;
  timeScale: number;
  queuedAnimations: string[];
  yaw: number;
  pitch: number;
  roll: number;
  color: [number, number, number];
  teamColor: number;
  matrixScale: [number, number, number];

  flat: boolean;

  destroyed?: number;

  death?: number;
}

const copyBlend = (blend: AnimationBlend | undefined): AnimationBlend | undefined =>
  blend === undefined ? undefined : { from: { ...blend.from, subAnimations: [...blend.from.subAnimations] }, remaining: blend.remaining };

export type EffectDeaths = (this: void, model: string) => number | undefined;

export interface CineFilterPose {
  readonly texture: string;

  readonly blendMode: string;
  readonly texMapFlags: unknown;

  readonly color: readonly [number, number, number, number];

  readonly uv: readonly [number, number, number, number];
}

const BLEND_MODES = ["BLEND_MODE_NONE", "BLEND_MODE_DONT_CARE", "BLEND_MODE_KEYALPHA", "BLEND_MODE_BLEND", "BLEND_MODE_ADDITIVE", "BLEND_MODE_MODULATE", "BLEND_MODE_MODULATE_2X"];

interface CineFilter {
  texture: string;
  blendMode: string;
  texMapFlags: unknown;
  startColor: [number, number, number, number];
  endColor: [number, number, number, number];
  startUV: [number, number, number, number];
  endUV: [number, number, number, number];
  duration: number;

  shown: number | undefined;
}

export interface CameraPose {
  readonly x: number;
  readonly y: number;
  readonly fields: Readonly<Record<string, number>>;
}

export interface SoundCue {
  readonly event: "create" | "start" | "stop" | "volume";
  readonly kind: "sound" | "music";
  readonly frame: number;
  readonly handle: Handle;
  readonly source: string | undefined;
  readonly label: string | undefined;
  readonly volume: number;
  readonly effectiveVolume: number;
  readonly looping: boolean;
  readonly pitch: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface SoundState {
  readonly kind: "sound" | "music";
  readonly handle: Handle;
  readonly source: string | undefined;
  label: string | undefined;
  volume: number;
  pitch: number;
  x: number;
  y: number;
  z: number;
  unit: Unit | undefined;
  readonly looping: boolean;
  duration: number;
  elapsed: number;
  playing: boolean;
  killWhenDone: boolean;
}

export function assertSoundCue(log: readonly SoundCue[], expected: { readonly source?: string; readonly label?: string; readonly frame?: number; readonly count?: number }): void {
  let count = 0;
  for (const cue of log) {
    if (cue.event !== "start") continue;
    if (expected.source !== undefined && cue.source !== expected.source) continue;
    if (expected.label !== undefined && cue.label !== expected.label) continue;
    if (expected.frame !== undefined && cue.frame !== expected.frame) continue;
    count++;
  }
  if (count !== (expected.count ?? 1)) throw new Error(`sound cue ${expected.source ?? expected.label ?? "any"}: expected ${expected.count ?? 1} starts, got ${count}`);
}

export interface UnitPose extends AnimationState {
  readonly handle: Handle;
  readonly typeId: number;
  owner: number;
  x: number;
  y: number;
  z: number;

  facing: number;
  scale: [number, number, number];
  alpha: number;
  color: [number, number, number];
  teamColor: number;
  timeScale: number;
  visible: boolean;
}

export interface UnitStateFixture {
  readonly life: number;
  readonly maxLife: number;
  readonly mana: number;
  readonly maxMana: number;
}

export type UnitStateFixtures = Readonly<Record<number, UnitStateFixture>>;

interface Unit extends Handle, UnitPose {
  moveSpeed: number;
  attackCooldown: number;
  life: number | undefined;
  maxLife: number | undefined;
  mana: number | undefined;
  maxMana: number | undefined;
  dead: boolean;

  removed: boolean;
}

type Callback = (this: void) => void;

interface Timer extends Handle {
  callback: Callback | undefined;
  periodic: boolean;

  timeout: number;

  period: number;

  due: number;
  /** Equal deadlines run in TimerStart order; a periodic timer keeps its place. */
  order: number;
  running: boolean;
  expired: boolean;

  paused: number | undefined;
}

interface Trigger extends Handle {
  readonly actions: Callback[];
  destroyed: boolean;
  running: boolean;
  interrupted: boolean;
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

export interface ClientFiles {

  written(this: void, name: string, lines: readonly string[]): void;

  read(this: void, name: string): readonly string[] | undefined;
}

export interface ClientScope {
  enter(this: void, client: HeadlessClient): void;
  leave(this: void, client: HeadlessClient): void;
}

export interface ClientOptions {
  readonly abilityObjects?: AbilityObjectFixtures;
  readonly unitStates?: UnitStateFixtures;
  readonly scenery?: SceneryFixtures;
  readonly inventory?: Warcraft3InventoryFixtures;
  readonly slot: number;

  readonly filePrefix: string;

  readonly humans: readonly number[];

  readonly playerNames?: Readonly<Record<number, string>>;
  readonly declarations: NativeDeclarations;
  readonly localNatives: LocalNatives;
  readonly intentionalNoops?: IntentionalNoops;
  readonly network: SyncMessage[];
  readonly screenWidth: number;
  readonly scope?: ClientScope;

  readonly natives?: (this: void, client: HeadlessClient) => NativeBehaviors;
  readonly files?: ClientFiles;

  readonly frames?: readonly FrameTemplate[];

  readonly effectDeaths?: EffectDeaths;

  readonly musicSlider?: number;
  /** Whole milliseconds of game time per engine step when effect clocks advance once per step (25 on the 3.0.0 offline LAN pool); unset, once per frame. */
  readonly effectStepMs?: number;
}

export { FRAMES_PER_SECOND };
/** The shortest repeating period: a zero period fires about 10,000 times a game second (wisp:docs/warsmash-notes.md#timers-and-frame-stepping). */
const MIN_PERIOD = f32(0.0001);

const MIN_ONE_SHOT = 0.0009765625;

const frameEnd = (frame: number): number => divideFloat32(frame, FRAMES_PER_SECOND);
// Warcraft timer deadlines add toward zero; sub-resolution repeats advance one resolution to avoid stalling.

const after = (at: number, length: number): number => {
  const due = addFloat32TowardZero(at, length);
  return due > at ? due : addFloat32TowardZero(at, at * 1.1920928955078125e-7);
};

const CAMERA_FIELDS = ["CAMERA_FIELD_TARGET_DISTANCE", "CAMERA_FIELD_FARZ", "CAMERA_FIELD_ANGLE_OF_ATTACK", "CAMERA_FIELD_FIELD_OF_VIEW", "CAMERA_FIELD_ROLL", "CAMERA_FIELD_ROTATION", "CAMERA_FIELD_ZOFFSET", "CAMERA_FIELD_NEARZ", "CAMERA_FIELD_LOCAL_PITCH", "CAMERA_FIELD_LOCAL_YAW", "CAMERA_FIELD_LOCAL_ROLL", "CAMERA_FIELD_DEPTH_OF_FIELD_DISTANCE", "CAMERA_FIELD_DEPTH_OF_FIELD_SCALE", "CAMERA_FIELD_ZABSOLUTE"];
const PLAYER_COLORS = ["RED", "BLUE", "CYAN", "PURPLE", "YELLOW", "ORANGE", "GREEN", "PINK", "LIGHT_GRAY", "LIGHT_BLUE", "AQUA", "BROWN", "MAROON", "NAVY", "TURQUOISE", "VIOLET", "WHEAT", "PEACH", "MINT", "LAVENDER", "COAL", "SNOW", "EMERALD", "PEANUT", "BLACK"].map(name => "PLAYER_COLOR_" + name);

const isHandle = (value: unknown): value is Handle =>
  typeof value === "object" && value !== null && "id" in value && "kind" in value;

const isFrame = (value: unknown): value is Frame => typeof value === "object" && value !== null && "points" in value;

const DEATH_CUTOFF = f32(0.405);

const RADIANS_PER_DEGREE = 0.01745329238474369;
const DEGREES_PER_RADIAN = 57.295780181884766;

const TURN = 6.2831854820251465;
/** Two ulps above the binary32 nearest 1 / TURN, as 3.0.1 multiplies by it. */
const TURNS_PER_RADIAN = 0.1591549664735794;

// Warcraft stores facing in radians with products rounded toward zero (wisp:docs/warsmash-notes.md, Unit position and facing).

function unitFacing(degrees: number): number {
  let radians = multiplyFloat32TowardZero(f32(degrees), RADIANS_PER_DEGREE);
  if (radians >= TURN || radians < -TURN) {
    const turns = multiplyFloat32TowardZero(radians, TURNS_PER_RADIAN);
    radians = multiplyFloat32TowardZero(f32(turns - Math.floor(turns)), TURN);
  } else if (radians < 0) radians = subtractFloat32TowardZero(TURN, -radians);
  return multiplyFloat32TowardZero(radians, DEGREES_PER_RADIAN);
}

function isDigits(text: string): boolean {
  const start = text.startsWith("-") ? 1 : 0;
  if (text.length <= start) return false;
  for (let index = start; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

// Lua and JavaScript print floats differently; exact binary text keeps runtime comparisons deterministic.

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

// JASS S2I skips leading spaces; S2R does not (wisp:docs/warsmash-notes.md, Script rules).

function leadingNumber(text: string, fraction: boolean): number {
  let start = 0;
  while (!fraction && start < text.length && text.charAt(start) === " ") start++;
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

// Warcraft R2S/R2SW round exact ties away from zero and retain negative zero; host formatters differ.

function fixed(value: number, digits: number): string {
  const real = roundToFloat32(value);
  if (real !== real || real === Infinity || real === -Infinity || real >= f32(1e21) || real <= -f32(1e21)) return real.toFixed(digits);
  // 30 more digits than kept: no binary32 is that close to a tie without being one.
  const expanded = (real < 0 ? -real : real).toFixed(digits + 30);
  const point = expanded.indexOf(".");
  const kept = expanded.slice(0, point) + expanded.slice(point + 1, point + 1 + digits);
  const rest = expanded.slice(point + 1 + digits);
  let digitsText = kept;
  if (rest.charAt(0) >= "5") {
    let carry = digitsText.length - 1;
    while (carry >= 0 && digitsText.charAt(carry) === "9") carry--;
    digitsText = carry < 0
      ? `1${"0".repeat(digitsText.length)}`
      : digitsText.slice(0, carry) + String.fromCharCode(digitsText.charCodeAt(carry) + 1) + "0".repeat(digitsText.length - carry - 1);
  }
  const whole = digitsText.slice(0, digitsText.length - digits);
  const text = digits > 0 ? `${whole}.${digitsText.slice(digitsText.length - digits)}` : whole;
  return real < 0 ? `-${text}` : text;
}

// Sync data is capped at 255 characters, preserving whole UTF-8 characters (wisp:docs/warsmash-notes.md).
const SYNC_DATA_LIMIT = 255;

// Products below 2^53 and | 0 preserve Lua32 wrapping hash arithmetic in JavaScript.

const mix = (hash: number, value: number) => (hash * 1000003 + value) | 0;

function mixText(hash: number, text: string): number {
  let mixed = hash;
  for (let index = 0; index < text.length; index++) mixed = mix(mixed, text.charCodeAt(index));
  return mix(mixed, text.length);
}

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
  readonly scenery: Scenery;
  readonly inventory: Warcraft3Inventory;
  readonly abilities: Warcraft3Abilities;

  readonly textTags = new TextTags();
  readonly lightnings = new Lightnings();
  readonly textAreaAutoScroll = new Map<Handle, boolean>();
  readonly heldMouseButtons = new Set<unknown>();
  mouseScreenX = 0;
  mouseScreenY = 0;
  private heldMeta = 0;
  readonly slot: number;

  readonly log: NativeCall[] = [];

  forgotten = 0;
  private forgottenHash = 0;

  readonly errors: string[] = [];

  readonly missingNatives: MissingNative[] = [];

  readonly messages: string[] = [];

  readonly thrown: string[] = [];

  readonly files = new Map<string, string[]>();

  readonly published = new Map<string, readonly string[]>();
  // Wine reads the parent folder when a Preloader path is missing (wisp:docs/hot-reload.md).

  missedLookups = 0;
  readonly natives: Record<string, unknown> = {};

  frame = 0;
  private wallSeconds: number | undefined;

  clockSeconds(): number { return this.wallSeconds ?? this.frame / FRAMES_PER_SECOND; }

  setWallTime(seconds: number): void { this.wallSeconds = seconds; }
  private nextId = 0;
  private readonly scope: ClientScope | undefined;
  private readonly filePrefix: string;
  private readonly timers: Timer[] = [];
  private readonly spellHits: { target: Unit; due: number; damage: number }[] = [];
  private readonly passiveAlliances = new Map<string, boolean>();
  private timerOrder = 0;

  private now = 0;
  private readonly registrations: Registration[] = [];
  private readonly heldKeys = new Set<number>();
  private readonly memo = new Map<string, Frame>();
  private allPlayers: Handle | undefined;

  private readonly effects = new Map<Handle, EffectPose>();
  private readonly effectDeaths: EffectDeaths | undefined;
  private readonly effectStepMs: number | undefined;
  private readonly musicSlider: number;
  private readonly units = new Map<Handle, Unit>();

  private removals: Unit[] = [];
  private readonly unitStates: UnitStateFixtures;
  private readonly sounds = new Map<Handle, SoundState>();
  private readonly locations = new Map<Handle, { x: number; y: number }>();
  private readonly groups = new Set<Handle>();

  liveHandleCounts(): { readonly locations: number; readonly groups: number } {
    return { locations: this.locations.size, groups: this.groups.size };
  }
  readonly soundLog: SoundCue[] = [];
  private music: SoundState | undefined;
  private musicVolume = 127;
  private cameraX = 0;
  private cameraY = 0;
  private readonly cameraFields: Record<string, number> = {};
  private readonly cineFilter: CineFilter = { texture: "", blendMode: "BLEND_MODE_NONE", texMapFlags: undefined, startColor: [255, 255, 255, 255], endColor: [255, 255, 255, 255], startUV: [0, 0, 1, 1], endUV: [0, 0, 1, 1], duration: 0, shown: undefined };
  private readonly tooltips = new Map<string, string>();
  /** Preloader runs the content it first read from a path for the rest of the session. */
  private readonly preloaded = new Map<string, readonly string[]>();
  private event: EventContext = { player: 0, syncPrefix: "", syncData: "", chat: "", key: 0, timer: undefined, frame: undefined, frameEvent: undefined };
  private preload: string[] = [];
  private readonly stored: ClientFiles | undefined;

  readonly frames: Frames;

  constructor(options: ClientOptions) {
    this.abilities = new Warcraft3Abilities(options.abilityObjects);
    this.scenery = new Scenery(options.scenery);
    this.inventory = new Warcraft3Inventory({
      handle: kind => this.handle(kind),
      getUnitTypeId: unit => (unit as Unit).typeId,
      readLife: unit => this.unitValue(unit as Unit, "life"),
      readMaxLife: unit => this.unitValue(unit as Unit, "maxLife"),
      writeLife: (unit, life) => this.setLife(unit as Unit, life),
    }, options.inventory);
    this.unitStates = options.unitStates ?? {};
    this.effectDeaths = options.effectDeaths;
    this.effectStepMs = options.effectStepMs;
    this.musicSlider = options.musicSlider ?? 1;
    this.slot = options.slot;
    this.scope = options.scope;
    this.filePrefix = options.filePrefix;
    this.stored = options.files;
    const behaviors = this.behaviors(options);
    const local = options.localNatives;
    const log = this.log;

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
    const missing = new Set<string>();
    const noops = options.intentionalNoops ?? {};
    for (const name of Object.keys(noops)) {
      if (!options.declarations.functions.some(([native]) => native === name) || (noops[name] ?? "").trim() === "") {
        throw new Error(`intentional no-op ${name} needs a declared native and a concrete reason`);
      }
    }
    for (const [name, returns, parameters] of options.declarations.functions) {
      declared.add(name);
      arity.set(name, parameters);
      const fallback = this.defaultNative(returns);
      const behave = (behaviors[name] ?? (name.startsWith("Convert") ? (value: unknown) => value : noops[name] !== undefined ? fallback : () => {
        if (!missing.has(name)) {
          missing.add(name);
          this.missingNatives.push({ native: name, client: this.slot, frame: this.frame });
        }
        return fallback();
      })) as (this: void, ...args: unknown[]) => unknown;
      this.natives[name] = local[name] === undefined ? logged(name, parameters, behave) : behave;
    }

    for (const [name, type] of options.declarations.constants) this.natives[name] = WARCRAFT3_ENUM_VALUES[name] ?? (type === "number" ? 0 : type === "boolean" ? name === "TRUE" : name);
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
    this.effects.set(handle, { ...freshAnimation(), handle, model, created: this.frame, x: f32(x), y: f32(y), z: 0, alpha: 255, scale: 1, timeScale: 1, flat: false, queuedAnimations: [],
      yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1] });
    return handle;
  }

  private unitAt(owner: number, typeId: number, x: number, y: number, facing: number): Unit {
    const handle = this.handle("unit");
    const state = this.unitStates[typeId];
    const unit: Unit = { ...handle, ...freshAnimation(), handle, typeId, owner, x, y, z: 0, facing: unitFacing(facing), scale: [1, 1, 1], alpha: 255,
      color: [255, 255, 255], teamColor: owner, timeScale: 1,
      visible: true, moveSpeed: 0, attackCooldown: 0, life: state?.life, maxLife: state?.maxLife,
      mana: state?.mana, maxMana: state?.maxMana, dead: state !== undefined && state.life <= DEATH_CUTOFF, removed: false };
    this.units.set(unit, unit);
    return unit;
  }

  private unitValue(unit: Unit, field: "life" | "maxLife" | "mana" | "maxMana"): number {
    if (unit.removed) return 0;
    const value = unit[field];
    if (value === undefined) throw new Error(`unit type ${unit.typeId}: declare unitStates.${unit.typeId}.${field} or set it before reading`);
    return value;
  }

  // Native life writes round halfway changes toward zero before applying the cutoff (wisp:docs/warsmash-notes.md#native-results-for-44).

  private setLife(unit: Unit, life: number): void {
    if (unit.removed) return;
    const value = unit.life === undefined ? f32(life) : addFloat32(unit.life, subtractFloat32(f32(life), unit.life, true));
    if (!unit.dead && value <= DEATH_CUTOFF) {
      unit.life = 0;
      unit.dead = true;
    } else unit.life = value;
  }

  private unitAnimation(unit: Unit, animation: string | number): void {
    selectAnimation(unit, animation);
  }

  private sound(source: string | undefined, label: string | undefined, looping: boolean): Handle {
    const handle = this.handle("sound");
    const sound: SoundState = { kind: "sound", handle, source, label, volume: 127, pitch: 1, x: 0, y: 0, z: 0, unit: undefined,
      looping, duration: 0, elapsed: 0, playing: false, killWhenDone: false };
    this.sounds.set(handle, sound);
    this.cue(sound, "create");
    return handle;
  }

  private cue(sound: SoundState, event: SoundCue["event"]): void {
    this.soundLog.push({ event, kind: sound.kind, frame: this.frame, handle: sound.handle, source: sound.source, label: sound.label,
      volume: sound.volume, effectiveVolume: sound.volume / 127 * (sound.kind === "music" ? this.musicSlider : 1), looping: sound.looping,
      pitch: sound.pitch, x: sound.unit?.x ?? sound.x, y: sound.unit?.y ?? sound.y, z: sound.z });
  }

  private stopAudio(sound: SoundState): void {
    if (!sound.playing) return;
    this.cue(sound, "stop");
    sound.playing = false;
  }

  private playMusic(source: string, looping = true): void {
    if (this.music !== undefined) this.stopAudio(this.music);
    this.music = { kind: "music", handle: { kind: "music", id: 0 }, source, label: undefined,
      volume: this.musicVolume, pitch: 1, x: 0, y: 0, z: 0, unit: undefined, looping,
      duration: 0, elapsed: 0, playing: true, killWhenDone: false };
    this.cue(this.music, "start");
  }

  private startSound(handle: Handle): void {
    const sound = this.sounds.get(handle);
    // A handle has one voice: starting it while it plays changes nothing.
    if (sound === undefined || sound.playing) return;
    this.cue(sound, "start");
    sound.elapsed = 0;
    sound.playing = sound.looping || sound.duration > 0;
    if (!sound.playing && sound.killWhenDone) this.sounds.delete(handle);
  }

  private cameraField(field: unknown): string {
    if (typeof field === "number") return CAMERA_FIELDS[field] ?? describeValue(field);
    if (typeof field === "string") return field;
    return describeValue(field);
  }

  private liveEffect(effect: Handle): EffectPose | undefined {
    const pose = this.effects.get(effect);
    return pose?.destroyed === undefined ? pose : undefined;
  }

  private destroyEffect(effect: Handle): void {
    const pose = this.liveEffect(effect);
    if (pose === undefined) return;
    const death = this.effectDeaths?.(pose.model);
    pose.destroyed = this.frame;
    pose.queuedAnimations.length = 0;
    if (death !== undefined && death > 0) {
      pose.death = death;
      selectAnimation(pose, "death", []);
    }
  }

  private playEffect(effect: Handle, animation: string | number, timeScale?: number): void {
    const pose = this.liveEffect(effect);
    if (pose === undefined) return;
    selectAnimation(pose, animation, undefined, true);
    if (timeScale !== undefined) pose.timeScale = f32(timeScale);
  }

  private show(text: string): void {
    this.messages.push(text);
  }

  private report(lines: readonly string[]): void {
    const heading = lines[0] ?? "";
    this.errors.push(`error in ${heading.slice(heading.indexOf(" in ") + 4)}: ${lines[1] ?? ""}`);
  }

  private behaviors({ humans, playerNames, network, screenWidth }: ClientOptions): Readonly<Record<string, NativeBehavior>> {
    const playing = (player: number) => humans.includes(player);
    return {
      ...this.scenery.behaviors({ handle: kind => this.handle(kind) }),
      ...this.textTags.behaviors({
        handle: kind => this.handle(kind),
        unitPosition: (unit) => { const live = unit as Unit | undefined; return live === undefined || live.removed ? undefined : { x: live.x, y: live.y, z: live.z }; },
      }),
      ...this.lightnings.behaviors({ handle: kind => this.handle(kind) }),
      ...this.inventory.behaviors(),
      GetLocalPlayer: () => this.slot,
      Player: (n: number) => n,
      GetPlayerId: (player: number) => player,
      GetPlayerName: (player: number) => playerNames?.[player] ?? `Player ${player + 1}`,
      GetTriggerPlayer: () => this.event.player,
      GetHandleId: (handle: unknown) => (isHandle(handle) ? handle.id : handle),
      Location: (x: number, y: number) => {
        const handle = this.handle("location");
        this.locations.set(handle, { x, y });
        return handle;
      },
      RemoveLocation: (handle: Handle) => { this.locations.delete(handle); },
      MoveLocation: (handle: Handle, x: number, y: number) => {
        const location = this.locations.get(handle);
        if (location !== undefined) { location.x = x; location.y = y; }
      },
      GetLocationX: (handle: Handle) => this.locations.get(handle)?.x ?? 0,
      GetLocationY: (handle: Handle) => this.locations.get(handle)?.y ?? 0,
      CreateGroup: () => {
        const handle = this.handle("group");
        this.groups.add(handle);
        return handle;
      },
      DestroyGroup: (handle: Handle) => { this.groups.delete(handle); },
      GetPlayerController: (player: number) => (playing(player) ? "MAP_CONTROL_USER" : "MAP_CONTROL_NONE"),
      GetPlayerSlotState: (player: number) => (playing(player) ? "PLAYER_SLOT_STATE_PLAYING" : "PLAYER_SLOT_STATE_EMPTY"),
      GetPlayersAll: () => {
        if (this.allPlayers === undefined) this.allPlayers = this.handle("force");
        return this.allPlayers;
      },
      CreateUnit: (owner: number, typeId: number, x: number, y: number, facing: number) => this.unitAt(owner, typeId, x, y, facing),
      CreateUnitByName: (owner: number, name: string, x: number, y: number, facing: number) => this.unitAt(owner, name.length === 4 ? name.charCodeAt(0) * 0x1000000 + name.charCodeAt(1) * 0x10000 + name.charCodeAt(2) * 0x100 + name.charCodeAt(3) : 0, x, y, facing),
      RemoveUnit: (unit: Unit) => { this.removals.push(unit); this.units.delete(unit); this.abilities.removeUnit(unit); },
      GetOwningPlayer: (unit: Unit) => unit.owner,
      GetWidgetLife: (unit: Unit) => this.unitValue(unit, "life"),
      SetWidgetLife: (unit: Unit, life: number) => this.setLife(unit, life),
      KillUnit: (unit: Unit) => { if (!unit.removed) { unit.life = 0; unit.dead = true; } },
      GetUnitState: (unit: Unit, state: string) => {
        if (state === "UNIT_STATE_LIFE") return this.unitValue(unit, "life");
        if (state === "UNIT_STATE_MAX_LIFE") return this.unitValue(unit, "maxLife");
        if (state === "UNIT_STATE_MANA") return this.unitValue(unit, "mana");
        if (state === "UNIT_STATE_MAX_MANA") return this.unitValue(unit, "maxMana");
        throw new Error(`GetUnitState: unsupported state ${state}`);
      },
      SetUnitState: (unit: Unit, state: string, value: number) => {
        if (unit.removed) return;
        if (state === "UNIT_STATE_LIFE") this.setLife(unit, value);
        else if (state === "UNIT_STATE_MANA") unit.mana = unit.mana === undefined ? f32(value) : addFloat32(unit.mana, subtractFloat32(f32(value), unit.mana, true));
        // Warcraft ignores maximum life and mana writes here; BlzSetUnitMaxHP and BlzSetUnitMaxMana set them.
        else if (state !== "UNIT_STATE_MAX_LIFE" && state !== "UNIT_STATE_MAX_MANA") throw new Error(`SetUnitState: unsupported state ${state}`);
      },
      BlzGetUnitMaxHP: (unit: Unit) => this.unitValue(unit, "maxLife"),
      BlzSetUnitMaxHP: (unit: Unit, value: number) => { if (!unit.removed) unit.maxLife = value; },
      BlzGetUnitMaxMana: (unit: Unit) => this.unitValue(unit, "maxMana"),
      BlzSetUnitMaxMana: (unit: Unit, value: number) => { if (!unit.removed) unit.maxMana = value; },
      ShowUnit: (unit: Unit, show: boolean) => { unit.visible = show; },
      IsUnitHidden: (unit: Unit) => !unit.visible,
      GetUnitFlyHeight: (unit: Unit) => unit.z,
      SetUnitFlyHeight: (unit: Unit, height: number) => { unit.z = f32(height); },
      GetUnitFacing: (unit: Unit) => unit.facing,
      SetUnitFacing: (unit: Unit, facing: number) => { unit.facing = unitFacing(facing); },
      BlzSetUnitFacingEx: (unit: Unit, facing: number) => { unit.facing = unitFacing(facing); },
      SetUnitScale: (unit: Unit, x: number, y: number, z: number) => { unit.scale = [x, y, z]; },
      SetUnitTimeScale: (unit: Unit, timeScale: number) => { unit.timeScale = timeScale; },
      SetUnitBlendTime: (unit: Unit, blendTime: number) => { unit.animationBlendTime = blendTime; },
      SetUnitVertexColor: (unit: Unit, red: number, green: number, blue: number, alpha: number) => {
        unit.color = [red, green, blue];
        unit.alpha = alpha;
      },
      SetUnitColor: (unit: Unit, color: number | string) => {
        unit.teamColor = typeof color === "number" ? color : PLAYER_COLORS.indexOf(color);
      },
      SetUnitAnimation: (unit: Unit, animation: string) => this.unitAnimation(unit, animation),
      SetUnitAnimationByIndex: (unit: Unit, animation: number) => this.unitAnimation(unit, animation),
      SetUnitAnimationWithRarity: (unit: Unit, animation: string) => this.unitAnimation(unit, animation),
      GetUnitTypeId: (unit: Unit) => unit.removed ? 0 : unit.typeId,
      GetUnitX: (unit: Unit) => unit.x,
      GetUnitY: (unit: Unit) => unit.y,
      SetUnitX: (unit: Unit, x: number) => {
        unit.x = f32(x);
      },
      SetUnitY: (unit: Unit, y: number) => {
        unit.y = f32(y);
      },
      SetUnitPosition: (unit: Unit, x: number, y: number) => {
        unit.x = f32(x);
        unit.y = f32(y);
      },
      SetUnitMoveSpeed: (unit: Unit, value: number) => {
        unit.moveSpeed = f32(value);
      },
      GetUnitMoveSpeed: (unit: Unit) => unit.moveSpeed,
      SetPlayerAlliance: (source: number, target: number, which: string, allied: boolean) => {
        if (which !== "ALLIANCE_PASSIVE") throw new Error(`SetPlayerAlliance: unsupported alliance ${which}`);
        this.passiveAlliances.set(`${source} ${target}`, allied);
      },
      IssueTargetOrder: (caster: Unit, order: string, target: Unit) => {
        const spell = order === "shadowstrike" ? this.abilities.shadowStrike(caster) : undefined;
        if (spell === undefined || spell.interval <= 0 || spell.duration <= 0) {
          this.missingNatives.push({ native: "IssueTargetOrder", client: this.slot, frame: this.frame });
          return false;
        }
        if (!this.units.has(caster) || !this.units.has(target) || caster.dead || target.dead || caster.owner === target.owner || this.passiveAlliances.get(`${caster.owner} ${target.owner}`) === true) return false;
        const dx = target.x - caster.x;
        const dy = target.y - caster.y;
        if (dx * dx + dy * dy > spell.range * spell.range) return false;
        const impact = after(this.now, spell.impactDelay);
        this.spellHits.push({ target, due: impact, damage: spell.initial });
        for (let elapsed = spell.interval; elapsed < spell.duration; elapsed = after(elapsed, spell.interval)) {
          this.spellHits.push({ target, due: after(impact, elapsed), damage: spell.periodic });
        }
        return true;
      },
      ...this.abilities.behaviors((kind) => this.handle(kind)),
      BlzGetLocalClientWidth: () => screenWidth,
      BlzGetLocalClientHeight: () => 1080,
      BlzIsLocalClientActive: () => true,
      BlzIsKeyPressed: (key: number) => this.heldKeys.has(key),
      BlzIsMetaKeyPressed: (meta: number) => (this.heldMeta & meta) === meta,
      BlzIsMouseButtonPressed: (button: unknown) => this.heldMouseButtons.has(button),
      BlzGetMouseScreenPosX: () => this.mouseScreenX,
      BlzGetMouseScreenPosY: () => this.mouseScreenY,
      BlzPixelToFrameX: (pixel: number) => f32(pixel * f32(0.8) / screenWidth),
      BlzPixelToFrameY: (pixel: number) => f32(pixel * f32(0.6) / 1080),
      BlzFrameToPixelX: (frame: number) => Math.round(frame * screenWidth / f32(0.8)),
      BlzFrameToPixelY: (frame: number) => Math.round(frame * 1080 / f32(0.6)),
      BlzTextAreaFrameSetAutoScroll: (frame: Handle, value: boolean) => { this.textAreaAutoScroll.set(frame, value); },
      BlzLoadTOCFile: () => true,

      BlzGetOriginFrame: (type: unknown, index: number) => this.memoized(`origin ${describeValue(type)} ${index}`),
      BlzGetFrameByName: (name: string, context: number) => this.frames.named(name, context) ?? this.memoized(`name ${name} ${context}`, name),
      BlzFrameGetChildrenCount: (frame: unknown) => (isFrame(frame) ? this.frames.children(frame).length : 0),
      BlzFrameGetChild: (frame: Handle, index: number) => (isFrame(frame) ? this.frames.children(frame)[index] : undefined) ?? this.memoized(`child ${frame.id} ${index}`),
      BlzCreateFrame: (name: string, owner: unknown, _priority: number, context: number) => this.frames.create(() => this.handle("framehandle"), name, isFrame(owner) ? owner : undefined, context),
      BlzCreateSimpleFrame: (name: string, owner: unknown, context: number) => this.created(name, name, owner, context),
      BlzCreateFrameByType: (type: string, name: string, owner: unknown, _inherits: string, context: number) => this.created(type, name, owner, context),
      BlzDestroyFrame: (frame: unknown) => {
        if (isFrame(frame)) this.frames.destroy(frame);
      },
      BlzFrameGetName: (frame: unknown) => (isFrame(frame) ? frame.name : ""),
      BlzFrameGetParent: (frame: unknown) => (isFrame(frame) ? frame.parent : undefined),
      BlzFrameSetText: (frame: unknown, text: string) => {
        if (isFrame(frame)) frame.text = frame.textLimit >= 0 ? text.slice(0, frame.textLimit) : text;
      },
      BlzFrameGetText: (frame: unknown) => (isFrame(frame) ? frame.text : ""),
      BlzFrameSetTexture: (frame: unknown, texture: string) => {
        if (isFrame(frame)) frame.texture = texture;
      },
      BlzFrameSetVertexColor: (frame: unknown, color: number) => {
        if (isFrame(frame)) frame.color = color;
      },
      BlzFrameSetTextColor: (frame: unknown, color: number) => {
        if (isFrame(frame)) frame.textColor = color;
      },
      BlzFrameSetAlpha: (frame: unknown, alpha: number) => {
        if (isFrame(frame)) frame.alpha = alpha;
      },
      BlzFrameGetAlpha: (frame: unknown) => (isFrame(frame) ? frame.alpha : 0),
      BlzFrameSetTextSizeLimit: (frame: unknown, size: number) => {
        if (isFrame(frame)) frame.textLimit = size;
      },
      BlzFrameGetTextSizeLimit: (frame: unknown) => (isFrame(frame) ? frame.textLimit : 0),
      BlzFrameSetFont: (frame: unknown, file: string, height: number, flags: number) => {
        if (isFrame(frame)) frame.font = { file, height, flags };
      },
      BlzFrameSetTextAlignment: (frame: unknown, vertical: unknown, horizontal: unknown) => {
        if (isFrame(frame)) frame.alignment = { vertical, horizontal };
      },
      BlzFrameSetScale: (frame: unknown, scale: number) => {
        if (isFrame(frame)) frame.scale = scale;
      },
      BlzFrameSetVisible: (frame: unknown, visible: boolean) => {
        if (isFrame(frame)) frame.visible = visible;
      },
      BlzFrameIsVisible: (frame: unknown) => (isFrame(frame) ? this.frames.shown(frame) : false),
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
        if (isFrame(frame)) {
          frame.points.clear();
          frame.anchors.length = 0;
        }
      },
      BlzFrameSetPoint: (frame: unknown, point: unknown, relative: unknown, relativePoint: unknown, x: number, y: number) => {
        if (!isFrame(frame) || !isFrame(relative)) return;
        const name = (value: unknown) => typeof value === "number" ? FRAME_POINTS[value]?.[0] ?? "" : typeof value === "string" ? value : "";
        const ownPoint = name(point).replace("FRAMEPOINT_", "");
        for (let index = frame.anchors.length - 1; index >= 0; index--) if (frame.anchors[index]?.point === ownPoint) frame.anchors.splice(index, 1);
        frame.anchors.push({ point: ownPoint, relative, relativePoint: name(relativePoint).replace("FRAMEPOINT_", ""), x, y });
      },
      BlzFrameSetAllPoints: (frame: unknown, relative: unknown) => {
        if (!isFrame(frame) || !isFrame(relative)) return false;
        frame.points.clear();
        frame.anchors.length = 0;
        for (const point of ["TOPLEFT", "BOTTOMRIGHT"]) frame.anchors.push({ point, relative, relativePoint: point, x: 0, y: 0 });
        return true;
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
      CreateTrigger: (): Trigger => ({ ...this.handle("trigger"), actions: [], destroyed: false, running: false, interrupted: false }),
      BlzTriggerIsRunning: (trigger: Trigger) => trigger.running,
      BlzTriggerInterrupt: (trigger: Trigger) => { trigger.interrupted = true; },
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
        const timer: Timer = { ...this.handle("timer"), callback: undefined, periodic: false, timeout: 0, period: 0, due: 0,
          order: 0, running: false, expired: false, paused: undefined };
        this.timers.push(timer);
        return timer;
      },
      TimerStart: (timer: Timer, timeout: number, periodic: boolean, callback: Callback) => {
        const seconds = roundToFloat32(timeout);
        const shortest = periodic ? MIN_PERIOD : MIN_ONE_SHOT;
        timer.callback = callback;
        timer.periodic = periodic;
        timer.timeout = seconds;
        timer.period = seconds >= shortest ? seconds : shortest;

        timer.due = after(this.now, timer.period);
        timer.order = ++this.timerOrder;
        timer.running = true;
        timer.expired = false;
        timer.paused = undefined;
      },
      PauseTimer: (timer: Timer) => {
        if (timer.running) timer.paused = this.timerElapsed(timer);
        timer.running = false;
      },
      DestroyTimer: (timer: Timer) => {
        timer.running = false;
        const index = this.timers.indexOf(timer);
        if (index >= 0) this.timers.splice(index, 1);
      },
      TimerGetElapsed: (timer: Timer) => this.timerElapsed(timer),
      BlzSendSyncData: (prefix: string, data: string) => {
        network.push({ sender: this.slot, prefix, data: data.slice(0, SYNC_DATA_LIMIT) });
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
      // PreloadGenClear starts the modeled buffer; Start only enables native file generation.
      PreloadGenStart: () => undefined,
      Preload: (line: string) => {
        this.preload.push(line);
      },
      PreloadGenEnd: (name: string) => {
        this.files.set(name, this.preload);
        if (name === errorFile(this.slot, this.filePrefix)) this.report(this.preload);
        this.stored?.written(name, this.preload);
      },

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
      SetCameraPosition: (x: number, y: number) => {
        this.cameraX = x;
        this.cameraY = y;
      },
      GetCameraTargetPositionX: () => this.cameraX,
      SetCameraTargetController: () => { this.scenery.cameraAllowsHotkeyTargetLock = false; },
      SetCameraOrientController: () => { this.scenery.cameraAllowsHotkeyTargetLock = false; },
      SetCameraField: (field: unknown, value: number) => {
        this.cameraFields[this.cameraField(field)] = value;
      },
      GetCameraField: (field: unknown) => this.cameraFields[this.cameraField(field)] ?? 0,
      SetCineFilterTexture: (texture: string) => { this.cineFilter.texture = texture; },
      SetCineFilterBlendMode: (mode: unknown) => { this.cineFilter.blendMode = typeof mode === "number" ? BLEND_MODES[mode] ?? "BLEND_MODE_NONE" : String(mode); },
      SetCineFilterTexMapFlags: (flags: unknown) => { this.cineFilter.texMapFlags = flags; },
      SetCineFilterStartUV: (minU: number, minV: number, maxU: number, maxV: number) => { this.cineFilter.startUV = [minU, minV, maxU, maxV]; },
      SetCineFilterEndUV: (minU: number, minV: number, maxU: number, maxV: number) => { this.cineFilter.endUV = [minU, minV, maxU, maxV]; },
      SetCineFilterStartColor: (red: number, green: number, blue: number, alpha: number) => { this.cineFilter.startColor = [red, green, blue, alpha]; },
      SetCineFilterEndColor: (red: number, green: number, blue: number, alpha: number) => { this.cineFilter.endColor = [red, green, blue, alpha]; },
      SetCineFilterDuration: (duration: number) => { this.cineFilter.duration = duration; },
      DisplayCineFilter: (flag: boolean) => { this.cineFilter.shown = flag ? this.frame : undefined; },
      IsCineFilterDisplayed: () => this.cineFilter.shown !== undefined,
      CreateSound: (source: string, loop: boolean) => this.sound(source, undefined, loop),
      CreateSoundFromLabel: (label: string, loop: boolean) => this.sound(undefined, label, loop),
      CreateSoundFilenameWithLabel: (source: string, loop: boolean, _is3D: boolean, _stop: boolean, _fadeIn: number, _fadeOut: number, label: string) => this.sound(source, label, loop),
      SetSoundDuration: (handle: Handle, duration: number) => {
        const sound = this.sounds.get(handle);
        if (sound !== undefined) sound.duration = Math.max(0, duration);
      },
      GetSoundDuration: (handle: Handle) => this.sounds.get(handle)?.duration ?? 0,
      // A sound marked for destruction reads as not playing while it plays out.
      GetSoundIsPlaying: (handle: Handle) => {
        const sound = this.sounds.get(handle);
        return sound !== undefined && sound.playing && !sound.killWhenDone;
      },
      KillSoundWhenDone: (handle: Handle) => {
        const sound = this.sounds.get(handle);
        if (sound === undefined) return;
        sound.killWhenDone = true;
        if (!sound.playing) this.sounds.delete(handle);
      },
      StopSound: (handle: Handle, killWhenDone: boolean) => {
        const sound = this.sounds.get(handle);
        if (sound === undefined) return;
        this.stopAudio(sound);
        if (killWhenDone || sound.killWhenDone) this.sounds.delete(handle);
      },
      SetSoundParamsFromLabel: (handle: Handle, label: string) => {
        const sound = this.sounds.get(handle);
        if (sound !== undefined) sound.label = label;
      },
      SetSoundVolume: (handle: Handle, volume: number) => {
        const sound = this.sounds.get(handle);
        if (sound !== undefined) {
          sound.volume = Math.max(0, Math.min(127, volume));
          if (sound.playing) this.cue(sound, "volume");
        }
      },
      PlayMusic: (source: string) => this.playMusic(source),
      PlayMusicEx: (source: string) => this.playMusic(source),
      PlayThematicMusic: (source: string) => this.playMusic(source, false),
      StopMusic: () => { if (this.music !== undefined) this.stopAudio(this.music); },
      ResumeMusic: () => {
        if (this.music === undefined || this.music.playing) return;
        this.music.playing = true;
        this.cue(this.music, "start");
      },
      SetMusicVolume: (volume: number) => {
        this.musicVolume = Math.max(0, Math.min(127, volume));
        if (this.music !== undefined) {
          this.music.volume = this.musicVolume;
          if (this.music.playing) this.cue(this.music, "volume");
        }
      },
      SetSoundPitch: (handle: Handle, pitch: number) => {
        const sound = this.sounds.get(handle);
        if (sound !== undefined) sound.pitch = f32(pitch);
      },
      SetSoundPosition: (handle: Handle, x: number, y: number, z: number) => {
        const sound = this.sounds.get(handle);
        if (sound !== undefined) {
          sound.x = f32(x);
          sound.y = f32(y);
          sound.z = f32(z);
          sound.unit = undefined;
        }
      },
      AttachSoundToUnit: (handle: Handle, unit: Unit) => {
        const sound = this.sounds.get(handle);
        if (sound !== undefined) sound.unit = unit;
      },
      StartSound: (handle: Handle) => this.startSound(handle),
      StartSoundEx: (handle: Handle) => this.startSound(handle),
      AddSpecialEffectLoc: (model: string) => this.effectAt(model, 0, 0),
      // Local position getters read attached effects at 0, 0 regardless of the unit position.
      AddSpecialEffectTarget: (model: string) => this.effectAt(model, 0, 0),
      DestroyEffect: (effect: Handle) => this.destroyEffect(effect),
      BlzRemoveEffect: (effect: Handle) => { if (this.liveEffect(effect) !== undefined) this.effects.delete(effect); },
      BlzSetSpecialEffectAnimationBlendTime: (effect: Handle, time: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.animationBlendTime = f32(time);
      },
      BlzSetSpecialEffectAnimation: (effect: Handle, animation: string) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) { pose.queuedAnimations.length = 0; this.playEffect(effect, animation); }
      },
      BlzQueueSpecialEffectAnimation: (effect: Handle, animation: string) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.queuedAnimations.push(animation);
      },
      // Effect reals are stored as binary32 (wisp:docs/warsmash-notes.md, "Effects: attachment, scale and lifetime").

      BlzSetSpecialEffectPosition: (effect: Handle, x: number, y: number, z: number) => {
        const pose = this.liveEffect(effect);
        if (pose === undefined) return;
        pose.x = f32(x);
        pose.y = f32(y);
        pose.z = f32(z);
      },
      BlzSetSpecialEffectX: (effect: Handle, x: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.x = f32(x);
      },
      BlzSetSpecialEffectY: (effect: Handle, y: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.y = f32(y);
      },
      BlzSetSpecialEffectZ: (effect: Handle, z: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.z = f32(z);
      },
      BlzSetSpecialEffectAlpha: (effect: Handle, alpha: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.alpha = alpha;
      },
      BlzSetSpecialEffectScale: (effect: Handle, scale: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.scale = f32(scale);
      },
      BlzSetSpecialEffectTimeScale: (effect: Handle, timeScale: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.timeScale = f32(timeScale);
      },
      BlzSetSpecialEffectTime: (effect: Handle, time: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) seekAnimation(pose, f32(time));
      },
      BlzPlaySpecialEffect: (effect: Handle, animation: string | number) => this.playEffect(effect, animation),
      BlzPlaySpecialEffectWithTimeScale: (effect: Handle, animation: string | number, timeScale: number) => this.playEffect(effect, animation, timeScale),
      BlzSpecialEffectClearSubAnimations: (effect: Handle) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.subAnimations.length = 0;
      },
      BlzSpecialEffectAddSubAnimation: (effect: Handle, animation: string | number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined && !pose.subAnimations.includes(animation)) pose.subAnimations.push(animation);
      },
      BlzSpecialEffectRemoveSubAnimation: (effect: Handle, animation: string | number) => {
        const pose = this.liveEffect(effect);
        if (pose === undefined) return;
        const index = pose.subAnimations.indexOf(animation);
        if (index >= 0) pose.subAnimations.splice(index, 1);
      },
      BlzSetSpecialEffectOrientation: (effect: Handle, yaw: number, pitch: number, roll: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) {
          pose.yaw = f32(yaw);
          pose.pitch = f32(pitch);
          pose.roll = f32(roll);
        }
      },
      BlzSetSpecialEffectYaw: (effect: Handle, yaw: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) {
          pose.yaw = f32(yaw);
          pose.matrixScale = [1, 1, 1];
          pose.flat = false;
        }
      },
      BlzSetSpecialEffectPitch: (effect: Handle, pitch: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.pitch = f32(pitch);
      },
      BlzSetSpecialEffectRoll: (effect: Handle, roll: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.roll = f32(roll);
      },
      BlzSetSpecialEffectColor: (effect: Handle, r: number, g: number, b: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.color = [r, g, b];
      },
      BlzSetSpecialEffectColorByPlayer: (effect: Handle, player: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) pose.teamColor = player;
      },
      BlzSetSpecialEffectMatrixScale: (effect: Handle, x: number, y: number, z: number) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) {
          pose.matrixScale = [f32(pose.matrixScale[0] * f32(x)), f32(pose.matrixScale[1] * f32(y)), f32(pose.matrixScale[2] * f32(z))];
          pose.flat = pose.matrixScale.includes(0);
        }
      },
      BlzResetSpecialEffectMatrix: (effect: Handle) => {
        const pose = this.liveEffect(effect);
        if (pose !== undefined) {
          pose.flat = false;
          pose.matrixScale = [1, 1, 1];
          pose.yaw = 0;
          pose.pitch = 0;
          pose.roll = 0;
        }
      },
      // Destroyed effects still playing Death retain their position.
      BlzGetLocalSpecialEffectX: (effect: Handle) => this.effects.get(effect)?.x ?? 0,
      BlzGetLocalSpecialEffectY: (effect: Handle) => this.effects.get(effect)?.y ?? 0,
      BlzGetLocalSpecialEffectZ: (effect: Handle) => this.effects.get(effect)?.z ?? 0,
      I2S: (n: number) => describeNumber(n),
      R2S: (n: number) => fixed(n, 3),
      R2SW: (n: number, width: number, precision: number) => {
        // R2SW pads to width and rounds to at least one decimal (wisp:docs/warsmash-notes.md, Script rules).
        let text = fixed(n, precision > 0 ? precision : 0);
        if (precision <= 0) text = `${text}.0`;
        while (text.length < width + 1) text = ` ${text}`;
        return text;
      },
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

  preloadedFiles(): string[] {
    return [...this.preloaded.keys()];
  }

  effectPoses(options: { readonly visibleOnly?: boolean } = {}): EffectPose[] {
    const poses: EffectPose[] = [];
    for (const pose of this.effects.values()) if (options.visibleOnly !== true || (pose.alpha > 0 && pose.scale > 0 && !pose.flat)) poses.push({ ...pose, subAnimations: [...pose.subAnimations], animationBlend: copyBlend(pose.animationBlend), color: [...pose.color], matrixScale: [...pose.matrixScale] });
    return poses;
  }

  cineFilterPose(): CineFilterPose | undefined {
    const filter = this.cineFilter;
    if (filter.shown === undefined) return undefined;
    const share = filter.duration <= 0 ? 1 : Math.min(1, (this.frame - filter.shown) / FRAMES_PER_SECOND / filter.duration);
    const mix = (from: readonly number[], to: readonly number[]): [number, number, number, number] =>
      [0, 1, 2, 3].map((i) => (from[i] ?? 0) + ((to[i] ?? 0) - (from[i] ?? 0)) * share) as [number, number, number, number];
    return { texture: filter.texture, blendMode: filter.blendMode, texMapFlags: filter.texMapFlags, color: mix(filter.startColor, filter.endColor), uv: mix(filter.startUV, filter.endUV) };
  }

  cameraPose(): CameraPose {
    return { x: this.cameraX, y: this.cameraY, fields: { ...this.cameraFields } };
  }

  unitPoses(): UnitPose[] {
    const poses: UnitPose[] = [];
    for (const unit of this.units.values()) poses.push({ handle: unit.handle, typeId: unit.typeId, owner: unit.owner,
      x: unit.x, y: unit.y, z: unit.z, facing: unit.facing, scale: [...unit.scale], alpha: unit.alpha, color: [...unit.color],
      teamColor: unit.teamColor, timeScale: unit.timeScale, visible: unit.visible, animation: unit.animation, subAnimations: [...unit.subAnimations],
      animationElapsed: unit.animationElapsed, animationClock: unit.animationClock,
      animationBlendTime: unit.animationBlendTime, animationBlend: copyBlend(unit.animationBlend) });
    return poses;
  }

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
    const running = trigger.running;
    const interrupted = trigger.interrupted;
    trigger.running = true;
    trigger.interrupted = false;
    try {
      for (const action of trigger.actions) {
        if (trigger.interrupted) break;
        action();
      }
    } finally {
      trigger.running = running;
      trigger.interrupted = interrupted;
    }
  }

  step(draw = true): void {
    this.frame++;
    steppedFrames.count++;

    this.abilities.tick(f32(1 / FRAMES_PER_SECOND));
    this.scenery.tick(f32(1 / FRAMES_PER_SECOND));
    this.textTags.tick(f32(1 / FRAMES_PER_SECOND));
    if (this.effectStepMs !== undefined) this.stepEffects(this.effectStepMs);
    if (draw) this.draw(f32(1 / FRAMES_PER_SECOND));
    const died: Handle[] = [];
    for (const pose of this.effects.values()) {
      if (pose.destroyed !== undefined && this.frame - pose.destroyed >= 5 * FRAMES_PER_SECOND) died.push(pose.handle);
    }
    for (const handle of died) this.effects.delete(handle);
    for (const sound of this.sounds.values()) {
      if (!sound.playing || sound.looping) continue;
      sound.elapsed += sound.pitch * 1000 / FRAMES_PER_SECOND;
      if (sound.elapsed < sound.duration) continue;
      this.stopAudio(sound);
      if (sound.killWhenDone) this.sounds.delete(sound.handle);
    }
    this.run(() => this.runDueTimers());
    for (const unit of this.removals) unit.removed = true;
    this.removals = [];
  }

  draw(seconds: number): void {
    if (this.effectStepMs === undefined) for (const pose of this.effects.values()) advanceAnimation(pose, pose.timeScale, f32(seconds));
    for (const unit of this.units.values()) advanceAnimation(unit, unit.timeScale, f32(seconds));
  }

  /** Engine steps end every `ms` of game time, after the callbacks due by then; frame n runs those ending in [(n - 1)/60, n/60) s first. */
  private stepEffects(ms: number): void {
    const per = FRAMES_PER_SECOND * ms;
    const ended = (frame: number) => Math.ceil(frame * 1000 / per);
    for (let step = ended(this.frame - 1); step < ended(this.frame); step++) {
      for (const pose of this.effects.values()) {
        // 3.0.0 LAN: the step that applies a selection restarts it without advancing it.
        if (pose.animationRestartPending === true) {
          pose.animationElapsed = 0;
          pose.animationRestartPending = false;
        } else advanceAnimation(pose, pose.timeScale, f32(ms / 1000));
      }
    }
  }

  private timerElapsed(timer: Timer): number {
    if (timer.paused !== undefined) return timer.paused;
    if (timer.expired) return timer.timeout;
    if (!timer.running) return 0;
    const remaining = timer.due > this.now ? subtractFloat32TowardZero(timer.due, this.now) : 0;
    return remaining < timer.period ? subtractFloat32TowardZero(timer.period, remaining) : 0;
  }

  // Due callbacks run by deadline then TimerStart order, reading their own deadline as game time.

  private runDueTimers(): void {
    const end = frameEnd(this.frame);
    this.now = end;
    for (;;) {
      let next: Timer | undefined;
      for (const timer of this.timers) {
        if (!timer.running || timer.callback === undefined || timer.due > end) continue;
        if (next === undefined || timer.due < next.due || (timer.due === next.due && timer.order < next.order)) next = timer;
      }
      let hitIndex = -1;
      for (let index = 0; index < this.spellHits.length; index++) {
        const hit = this.spellHits[index];
        const earliest = this.spellHits[hitIndex];
        if (hit !== undefined && hit.due <= end && (next === undefined || hit.due <= next.due) && (earliest === undefined || hit.due < earliest.due)) hitIndex = index;
      }
      const hit = this.spellHits[hitIndex];
      if (hit !== undefined) {
        this.spellHits.splice(hitIndex, 1);
        this.now = hit.due;
        if (this.units.has(hit.target) && !hit.target.dead) this.setLife(hit.target, subtractFloat32(this.unitValue(hit.target, "life"), hit.damage));
        continue;
      }
      if (next === undefined || next.callback === undefined) break;
      this.now = next.due;
      if (next.periodic) next.due = after(next.due, next.period);
      else {
        next.running = false;
        next.expired = true;
      }
      this.event.timer = next;
      try {
        next.callback();
      } finally {
        this.now = end;
      }
    }
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
    if (sender === this.slot) this.hold(key, meta, down);
    this.keyEvent(sender, key, meta, down);
  }

  hold(key: number, meta: number, down: boolean): void {
    this.heldMeta = meta;
    if (down) this.heldKeys.add(key);
    else this.heldKeys.delete(key);
  }

  keyEvent(sender: number, key: number, meta: number, down: boolean): void {
    this.run(() => {
      for (const registration of [...this.registrations]) {
        if (registration.kind === "key" && registration.player === sender && registration.key === key && registration.meta === meta && registration.down === down) {
          this.fire(registration.trigger, { player: sender, key });
        }
      }
    });
  }

  type(text: string): boolean {
    return this.frames.type(text);
  }

  clickTarget(x: number, y: number): Frame | undefined {
    const click = this.natives.FRAMEEVENT_CONTROL_CLICK;
    return this.frames.at(x, y, (frame) => this.registrations.some((registration) =>
      registration.kind === "frame" && registration.frame === frame && registration.event === click && !registration.trigger.destroyed));
  }

  frameEvent(sender: number, id: number, event: unknown): void {
    this.run(() => {
      for (const registration of [...this.registrations]) {
        if (registration.kind === "frame" && registration.frame.id === id && registration.event === event) {
          this.fire(registration.trigger, { player: sender, frame: registration.frame, frameEvent: event });
        }
      }
    });
  }

  callCount(): number {
    return this.forgotten + this.log.length;
  }

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

  checksum(): string {
    let hash = this.forgottenHash;
    for (const call of this.log) hash = mixCall(hash, call);
    return describeNumber(hash);
  }
}
