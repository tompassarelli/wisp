import { f32 } from "../sim/f32";
import { mixCall } from "./callHash";
import type { CameraPose, CineFilterPose, ClientFiles, EffectDeaths, EffectPose, Handle, IntentionalNoops, LocalNatives, MissingNative, NativeBehavior, NativeBehaviors, NativeCall, PlayerMouseInput, SoundCue, StandaloneProfile, SyncMessage, UnitPose, UnitStateFixtures } from "./clientTypes";
import type { NativeDeclarations } from "./declarations";
import { FRAME_POINTS, type Frame, type FrameTemplate, Frames } from "./frames";
import { enforceStandaloneProfile } from "./standaloneProfile";
import { FRAMES_PER_SECOND, steppedFrames } from "./frameRate";
import { describeNumber } from "./jassFormat";
import { Lightnings } from "./lightnings";
import { Weathers } from "./weather";
import { CameraCine } from "./natives/cameraCine";
import { Effects } from "./natives/effects";
import { frameNatives, type FrameContext, inputNatives } from "./natives/frames";
import { mathNatives } from "./natives/math";
import { Playing } from "./natives/playing";
import { PreloadText } from "./natives/preloadText";
import { Sounds } from "./natives/sound";
import { playerMouseEvent, TriggersTimers } from "./natives/triggersTimers";
import { type Unit, Units } from "./natives/units";
import { TextTags } from "./textTags";
import { type AbilityObjectFixtures, Warcraft3Abilities } from "./warcraft3Abilities";
import { Warcraft3Inventory, type Warcraft3InventoryFixtures } from "./warcraft3Inventory";
import { WARCRAFT3_ENUM_VALUES } from "./warcraft3Natives";
import { Scenery, type SceneryFixtures } from "./warcraft3Scenery";

export type { CameraPose, CineFilterPose, ClientFiles, EffectDeaths, EffectPose, Handle, IntentionalNoops, LocalNatives, MapEntry, MissingNative, NativeBehavior, NativeBehaviors, NativeCall, SoundCue, StandaloneProfile, SyncMessage, UnitPose, UnitStateFixture, UnitStateFixtures } from "./clientTypes";
export { describeCall, describeNumber, describeValue, sameCall } from "./jassFormat";
export { assertSoundCue } from "./natives/sound";
export { FRAMES_PER_SECOND };

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
  readonly standaloneProfile?: StandaloneProfile | undefined;
  readonly network: SyncMessage[];
  /** Pixels `BlzGetLocalClientWidth/Height`, `BlzPixelToFrame*` and `BlzFrameToPixel*` read. */
  readonly screen: { readonly width: number; readonly height: number };
  readonly scope?: ClientScope;

  readonly natives?: (this: void, client: HeadlessClient) => NativeBehaviors;
  readonly files?: ClientFiles;

  readonly frames?: readonly FrameTemplate[];

  readonly effectDeaths?: EffectDeaths;

  readonly musicSlider?: number;
}

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

export class HeadlessClient {
  readonly scenery: Scenery;
  readonly inventory: Warcraft3Inventory;
  readonly abilities: Warcraft3Abilities;

  readonly textTags = new TextTags();
  readonly lightnings = new Lightnings();
  readonly weathers = new Weathers();
  readonly textAreaAutoScroll = new Map<Handle, boolean>();
  readonly heldMouseButtons = new Set<unknown>();
  /** Pixels `BlzGetLocalClientWidth/Height` report, which a window's cursor is mapped into. */
  readonly screen: { readonly width: number; readonly height: number };
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
  readonly playing = new Playing();
  readonly natives: Record<string, unknown> = {};

  frame = 0;
  private wallSeconds: number | undefined;

  clockSeconds(): number { return this.wallSeconds ?? this.frame / FRAMES_PER_SECOND; }

  setWallTime(seconds: number): void { this.wallSeconds = seconds; }
  private nextId = 0;
  private readonly scope: ClientScope | undefined;
  private readonly heldKeys = new Set<number>();
  private readonly units: Units;
  private readonly effects: Effects;
  private readonly sounds: Sounds;
  private readonly camera: CameraCine;
  private readonly preloadText: PreloadText;
  private readonly timers: TriggersTimers;
  readonly soundLog: SoundCue[];

  readonly frames: Frames;

  constructor(options: ClientOptions) {
    this.screen = options.screen;
    this.abilities = new Warcraft3Abilities(options.abilityObjects);
    this.scenery = new Scenery(options.scenery);
    this.inventory = new Warcraft3Inventory({
      handle: kind => this.handle(kind),
      getUnitTypeId: unit => (unit as Unit).typeId,
      readLife: unit => this.units.value(unit as Unit, "life"),
      readMaxLife: unit => this.units.value(unit as Unit, "maxLife"),
      writeLife: (unit, life) => this.units.setLife(unit as Unit, life),
    }, options.inventory);
    const handle = (kind: string): Handle => this.handle(kind);
    const frame = (): number => this.frame;
    this.units = new Units(options.unitStates ?? {}, handle, this.abilities);
    this.effects = new Effects(handle, options.effectDeaths, frame);
    this.sounds = new Sounds(handle, options.musicSlider ?? 1, frame);
    this.soundLog = this.sounds.log;
    this.camera = new CameraCine(this.scenery, frame);
    this.timers = new TriggersTimers(handle, this.units);
    this.slot = options.slot;
    this.scope = options.scope;
    this.preloadText = new PreloadText({ slot: options.slot, filePrefix: options.filePrefix, stored: options.files, files: this.files, published: this.published,
      messages: this.messages, errors: this.errors, missed: () => { this.missedLookups++; } });
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
    enforceStandaloneProfile(options.standaloneProfile, declared, this.natives, (native) => { this.missingNatives.push({ native, client: this.slot, frame: this.frame, outsideProfile: true }); });
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

  liveHandleCounts(): { readonly locations: number; readonly groups: number } {
    return this.units.liveHandleCounts();
  }

  private behaviors({ humans, playerNames, network, screen }: ClientOptions): Readonly<Record<string, NativeBehavior>> {
    const handle = (kind: string): Handle => this.handle(kind);
    const frameContext: FrameContext = {
      handle, screen, textAreaAutoScroll: this.textAreaAutoScroll,
      frames: () => this.frames,
      gameUiOrigin: () => this.natives.ORIGIN_FRAME_GAME_UI,
      keyPressed: key => this.heldKeys.has(key),
      metaPressed: meta => (this.heldMeta & meta) === meta,
      mouseButtonPressed: button => this.heldMouseButtons.has(button),
      mouseX: () => this.mouseScreenX,
      mouseY: () => this.mouseScreenY,
    };
    return {
      ...this.scenery.behaviors({ handle }),
      ...this.textTags.behaviors({
        handle,
        unitPosition: (unit) => { const live = unit as Unit | undefined; return live === undefined || live.removed ? undefined : { x: live.x, y: live.y, z: live.z }; },
      }),
      ...this.lightnings.behaviors({ handle }),
      ...this.weathers.behaviors({ handle }),
      ...this.inventory.behaviors(),
      ...this.units.playerBehaviors({ slot: this.slot, humans, playerNames }),
      ...this.units.behaviors(),
      ...this.abilities.targetOrders({
        missing: () => { this.missingNatives.push({ native: "IssueTargetOrder", client: this.slot, frame: this.frame }); },
        engageable: (caster, target, range) => this.units.engageable(caster as Unit, target as Unit, range),
        now: () => this.timers.time(),
        hit: (target, due, damage) => this.timers.hit(target as Unit, due, damage),
      }),
      ...this.abilities.behaviors(handle),
      ...inputNatives(frameContext),
      ...frameNatives(frameContext),
      ...this.timers.behaviors(this.slot, network),
      ...this.preloadText.behaviors(),
      ...this.camera.behaviors(),
      ...this.sounds.behaviors(),
      ...this.effects.behaviors(),
      ...mathNatives(),
      ...this.playing.behaviors(),
    };
  }

  preloadedFiles(): string[] {
    return this.preloadText.preloadedFiles();
  }

  effectPoses(options: { readonly visibleOnly?: boolean } = {}): EffectPose[] {
    return this.effects.snapshot(options);
  }

  cineFilterPose(): CineFilterPose | undefined {
    return this.camera.cineFilterPose();
  }

  cameraPose(): CameraPose {
    return this.camera.cameraPose();
  }

  unitPoses(): UnitPose[] {
    return this.units.poses();
  }

  run(body: (this: void) => void): void {
    this.scope?.enter(this);
    try {
      body();
    } finally {
      this.scope?.leave(this);
    }
  }

  step(draw = true): void {
    this.frame++;
    steppedFrames.count++;

    this.abilities.tick(f32(1 / FRAMES_PER_SECOND));
    this.scenery.tick(f32(1 / FRAMES_PER_SECOND));
    this.textTags.tick(f32(1 / FRAMES_PER_SECOND));
    if (draw) this.draw(f32(1 / FRAMES_PER_SECOND));
    this.effects.expire(this.frame);
    this.sounds.tick();
    this.run(() => this.timers.runDue(this.frame));
    this.units.settleRemovals();
  }

  draw(seconds: number): void {
    this.effects.draw(f32(seconds));
    this.units.draw(seconds);
  }

  deliverSync(message: SyncMessage): void {
    this.run(() => this.timers.deliverSync(message));
  }

  chat(sender: number, message: string): void {
    this.run(() => this.timers.chat(sender, message));
  }

  hold(key: number, meta: number, down: boolean): void {
    this.heldMeta = meta;
    if (down) this.heldKeys.add(key);
    else this.heldKeys.delete(key);
  }

  keyEvent(sender: number, key: number, meta: number, down: boolean): void {
    this.run(() => this.timers.keyEvent(sender, key, meta, down));
  }

  playerMouse(sender: number, input: PlayerMouseInput): void {
    this.run(() => this.timers.playerMouse(sender, playerMouseEvent(this.natives, input)));
  }

  type(text: string): boolean {
    return this.frames.type(text);
  }

  clickTarget(x: number, y: number): Frame | undefined {
    const click = this.natives.FRAMEEVENT_CONTROL_CLICK;
    return this.frames.at(x, y, (frame) => this.timers.handles(frame, click));
  }

  frameEvent(sender: number, id: number, event: unknown): void {
    this.run(() => this.timers.frameEvent(sender, id, event));
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
