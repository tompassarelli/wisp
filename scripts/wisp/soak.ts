// The soak (wisp:docs/soak.md): many headless matches of a map, played by the
// game's computers and by fuzzed controllers, faster than real time, each
// watched for what a playtest would find: a stall, a desync, an error report,
// a scene problem, a fighter drawn with nothing, and frames that cost more
// than real time allows or a catch-up that never ends. Each match repeats from
// its seed; a finding keeps the match and its inputs as a repro file. Plain
// functions, so tests use them without Effect; commands/soak.ts runs them in
// worker processes.
import { dlopen } from "bun:ffi";
import { Schema } from "effect";
import type { ClientFiles, HeadlessClient, MapEntry } from "../../src/headless/client";
import type { Lockstep } from "../../src/headless/lockstep";
import { sceneFile } from "../../src/runtime/scene";
import type { HeadlessMap, HeadlessRuntime } from "./headless";
import type { TypedInput } from "./headlessInput";
import { Random } from "../../src/headless/random";
import { type SceneBody, type SceneExpectations, bodyProblems, readSceneLines, sceneProblems } from "./scene";
import { type NativeCostModel, WARCRAFT_COST, nativeFrameCost } from "../../src/headless/nativeCost";
import { MEASURED_BATTLE_NET, syncDelivery } from "../../src/headless/syncChannel";

/** A controller the fuzzer drives: buttons, and axes whose values are whole numbers from -axisLimit to axisLimit. */
export interface SoakController {
  readonly buttons: readonly string[];
  /** How often each button starts a pattern, relative to the others; 1 each by default. */
  readonly weights?: readonly number[];
  /** Buttons that toggle a mode, such as a pause: pressed twice, a moment apart, so the mode doesn't stick. */
  readonly toggles?: readonly string[];
  readonly axes: readonly string[];
  readonly axisLimit: number;
  /** The axis values a player can't feel; the fuzzer jitters inside and across them. */
  readonly deadZone: number;
}

/** One change on a controller, in the order it happens within its frame. */
export type SoakEdge =
  | { readonly button: number; readonly down: boolean }
  | { readonly axis: number; readonly value: number };

/** What a player's input source does on one frame of a match, counted from the frame the match began. */
export interface SoakInputFrame {
  /** Each fuzzed slot's controller edges, in order. */
  readonly edges: ReadonlyMap<number, readonly SoakEdge[]>;
  /** Slots whose input source starts sending nothing for this many frames. */
  readonly silences: ReadonlyMap<number, number>;
  /** Wall-clock milliseconds the whole game stops before this frame, as in a lag spike. */
  readonly hitchMs: number;
  /** Text each player's input helper typed before this frame, in a match played through the helpers. */
  readonly typed: ReadonlyMap<number, readonly string[]>;
  /** Files each player's input helper put in their CustomMapData that the map read first during this frame; those read before the match began are at frame 0. */
  readonly files: ReadonlyMap<number, readonly (readonly [name: string, chunks: readonly string[]])[]>;
}

/** A match's inputs as a repro file keeps them: only the frames where something happened. */
export interface SoakInputs {
  readonly edges: readonly (readonly [frame: number, slot: number, edge: SoakEdge])[];
  readonly silences: readonly (readonly [frame: number, slot: number, frames: number])[];
  readonly hitches: readonly (readonly [frame: number, ms: number])[];
  /** Frames whose clients cost more than real time allows, with the milliseconds over, which the replay's clock adds again. */
  readonly slow: readonly (readonly [frame: number, ms: number])[];
  /**
   * In a match played through its players' input helpers: what each typed,
   * by the frame it reached the client before, and each file it wrote that the
   * map read, by the frame the map first read it (0: before the match began).
   * A replay plays these instead of the edges, which reached the clients
   * only through the helpers.
   */
  readonly typed?: readonly (readonly [frame: number, slot: number, text: string])[];
  readonly files?: readonly (readonly [frame: number, slot: number, name: string, chunks: readonly string[]])[];
}

export interface FuzzOptions {
  /** Chance a new pattern starts on a frame; patterns overlap. */
  readonly rate: number;
  /** Chance per frame that a fuzzed player's input source goes quiet for a while. */
  readonly silence: number;
  /** Chance per frame that the whole game stops for a moment. */
  readonly hitch: number;
}

/** About seven patterns a second, a quiet input source every minute and a lag spike every 40 s of a fuzzed player's match. */
export const SOAK_FUZZ: FuzzOptions = { rate: 1 / 8, silence: 1 / 3600, hitch: 1 / 2400 };

/** The policy name that drives a slot with the fuzzer; every other policy is the game's to interpret. */
export const FUZZ_POLICY = "fuzz";

/** One match of a soak, as data: everything it needs to repeat. */
export interface SoakMatch {
  /** Its place in the run, which names its repro file. */
  readonly index: number;
  readonly seed: number;
  /** The game's fighter names, one per player slot. */
  readonly fighters: readonly string[];
  readonly stage: string;
  /** One per player slot: FUZZ_POLICY or one of the game's. */
  readonly policies: readonly string[];
  /** Frames the match may run after it began; it ends sooner when the game says it is over. */
  readonly frames: number;
  /** Every player's input came from an input helper typing into their client, which the repro's `typed` inputs replay. */
  readonly typed?: boolean;
}

/** What each match chooses from. */
export interface SoakRoster {
  readonly fighters: readonly string[];
  readonly stages: readonly string[];
  /** Policy pairs, one policy per player slot. */
  readonly policies: readonly (readonly string[])[];
}

/**
 * `matches` matches: every ordered pair of fighters on every stage, then
 * again with the next policy pair, and so on, each with its own seed. `keep`
 * narrows the cycle, such as to the pairs one fighter plays in.
 */
export function planSoak(roster: SoakRoster, matches: number, seed: number, frames: number, keep: (match: SoakMatch) => boolean = () => true): SoakMatch[] {
  const pairs = roster.fighters.flatMap((first) => roster.fighters.map((second) => [first, second] as const));
  const cycle = roster.policies.flatMap((policies) => pairs.flatMap((fighters) => roster.stages.map((stage) => ({ index: 0, seed: 0, fighters, stage, policies, frames }))))
    .filter(keep);
  if (cycle.length === 0) throw new Error("no fighters, stages and policies left to soak");
  const seeds = new Random(seed);
  return Array.from({ length: matches }, (_, index) => {
    const base = cycle[index % cycle.length];
    if (base === undefined) throw new Error("no fighters, stages and policies left to soak");
    return { ...base, index, seed: seeds.between(1, 2147483646) };
  });
}

/** The edges a pattern adds, by frames from now. */
type Pattern = (readonly [delay: number, edge: SoakEdge])[];

/**
 * A controller's input, made of patterns that probe its edges: a press and
 * release in one frame, holds of every length, chords, mashing, a stick
 * flicked to the rim and back, swept across its range or jittered around its
 * dead zone, everything let go at once, and a pause pressed twice.
 */
class Fuzzer {
  private readonly held = new Set<number>();
  private readonly axes: number[];
  private readonly pending = new Map<number, SoakEdge[]>();
  private readonly weights: readonly number[];
  private readonly toggles: ReadonlySet<number>;

  constructor(private readonly controller: SoakController, private readonly random: Random, private readonly rate: number) {
    this.axes = controller.axes.map(() => 0);
    this.toggles = new Set(controller.buttons.flatMap((name, index) => (controller.toggles?.includes(name) ? [index] : [])));
    this.weights = controller.buttons.map((_, index) => (this.toggles.has(index) ? 0 : controller.weights?.[index] ?? 1));
  }

  private button(): number {
    const total = this.weights.reduce((sum, weight) => sum + weight, 0);
    let draw = this.random.next() * total;
    for (let index = 0; index < this.weights.length; index++) {
      draw -= this.weights[index] ?? 0;
      if (draw <= 0 && (this.weights[index] ?? 0) > 0) return index;
    }
    return this.weights.findLastIndex((weight) => weight > 0);
  }

  private pattern(): Pattern {
    const { random, controller } = this;
    const limit = controller.axisLimit;
    const axis = () => random.between(0, controller.axes.length - 1);
    const rim = () => (random.chance(0.5) ? limit : -limit);
    const choice = random.between(0, this.toggles.size > 0 ? 9 : 8);
    if (!this.weights.some((weight) => weight > 0) && (choice < 4 || choice === 7)) return [];
    if (controller.axes.length === 0 && choice >= 4 && choice < 8) return [];
    switch (choice) {
      case 0: {
        const button = this.button();
        return [[0, { button, down: true }], [0, { button, down: false }]];
      }
      case 1: {
        const button = this.button();
        return [[0, { button, down: true }], [random.chance(0.5) ? random.between(1, 4) : random.between(5, 90), { button, down: false }]];
      }
      case 2: {
        const buttons = [...new Set([this.button(), this.button(), this.button()])].slice(0, random.between(2, 3));
        const hold = random.between(0, 30);
        return [...buttons.map((button) => [0, { button, down: true }] as const), ...buttons.map((button) => [hold, { button, down: false }] as const)];
      }
      case 3: {
        const button = this.button();
        const period = random.between(1, 3);
        return Array.from({ length: random.between(4, 20) }, (_, index) => [index * period, { button, down: index % 2 === 0 }] as const)
          .concat([[20 * period, { button, down: false }]]);
      }
      case 4: {
        const index = axis();
        return [[0, { axis: index, value: rim() }], [random.between(1, 3), { axis: index, value: 0 }]];
      }
      case 5: {
        const index = axis();
        const steps = random.between(4, 30);
        const from = rim();
        return Array.from({ length: steps + 1 }, (_, step) => [step, { axis: index, value: Math.round(from - (2 * from * step) / steps) }] as const)
          .concat([[steps + random.between(0, 20), { axis: index, value: 0 }]]);
      }
      case 6: {
        const index = axis();
        const reach = Math.max(1, 2 * controller.deadZone);
        const frames = random.between(3, 30);
        return Array.from({ length: frames }, (_, frame) => [frame, { axis: index, value: random.between(-reach, reach) }] as const)
          .concat([[frames, { axis: index, value: 0 }]]);
      }
      case 7: {
        // A direction and a button on the same frame, as a smash or a tilt.
        const index = axis();
        const button = this.button();
        const hold = random.between(1, 12);
        return [[0, { axis: index, value: rim() }], [0, { button, down: true }], [hold, { button, down: false }], [hold + random.between(0, 6), { axis: index, value: 0 }]];
      }
      case 8:
        return [
          ...[...this.held].map((button) => [0, { button, down: false }] as const),
          ...this.axes.flatMap((value, index) => (value === 0 ? [] : [[0, { axis: index, value: 0 }] as const])),
        ];
      default: {
        const button = random.pick([...this.toggles]);
        const gap = random.between(10, 120);
        return [[0, { button, down: true }], [1, { button, down: false }], [gap, { button, down: true }], [gap + 1, { button, down: false }]];
      }
    }
  }

  /** The edges of `frame`: each scheduled change that still changes something. */
  frame(frame: number): SoakEdge[] {
    if (this.random.chance(this.rate)) {
      for (const [delay, edge] of this.pattern()) {
        const at = frame + delay;
        const list = this.pending.get(at) ?? [];
        list.push(edge);
        this.pending.set(at, list);
      }
    }
    const due = this.pending.get(frame) ?? [];
    this.pending.delete(frame);
    const edges: SoakEdge[] = [];
    for (const edge of due) {
      if ("button" in edge) {
        if (edge.down === this.held.has(edge.button)) continue;
        if (edge.down) this.held.add(edge.button);
        else this.held.delete(edge.button);
      } else {
        if (this.axes[edge.axis] === edge.value) continue;
        this.axes[edge.axis] = edge.value;
      }
      edges.push(edge);
    }
    return edges;
  }
}

/** A match's inputs frame by frame: from its seed, or as a repro file recorded them. */
export interface SoakInputSource {
  frame(frame: number): SoakInputFrame;
  /** The milliseconds a frame's clients cost over real time: as measured, or as the repro file recorded them. */
  slow(frame: number, measuredMs: number): number;
  /** What happened so far, for a repro file. */
  recorded(): SoakInputs;
}

const NO_EDGES: ReadonlyMap<number, readonly SoakEdge[]> = new Map();
const NO_SILENCES: ReadonlyMap<number, number> = new Map();
const NO_TYPING: ReadonlyMap<number, readonly string[]> = new Map();
const NO_FILES: ReadonlyMap<number, readonly (readonly [string, readonly string[]])[]> = new Map();

/** Fuzzed input for each slot whose policy is FUZZ_POLICY, and lag spikes for the whole match, all from the match's seed. */
export function fuzzedInputs(match: SoakMatch, controller: SoakController, options: FuzzOptions = SOAK_FUZZ): SoakInputSource {
  const timing = new Random(match.seed * 31 + 7);
  const fuzzers = new Map<number, Fuzzer>();
  match.policies.forEach((policy, slot) => {
    if (policy === FUZZ_POLICY) fuzzers.set(slot, new Fuzzer(controller, new Random(match.seed * 131 + slot * 7919 + 1), options.rate));
  });
  const record: { edges: [number, number, SoakEdge][]; silences: [number, number, number][]; hitches: [number, number][]; slow: [number, number][] } = {
    edges: [], silences: [], hitches: [], slow: [],
  };
  return {
    frame: (frame) => {
      const edges = new Map<number, readonly SoakEdge[]>();
      const silences = new Map<number, number>();
      for (const [slot, fuzzer] of fuzzers) {
        const changes = fuzzer.frame(frame);
        if (changes.length > 0) edges.set(slot, changes);
        for (const edge of changes) record.edges.push([frame, slot, edge]);
        if (timing.chance(options.silence)) {
          const frames = timing.between(15, 180);
          silences.set(slot, frames);
          record.silences.push([frame, slot, frames]);
        }
      }
      let hitchMs = 0;
      if (fuzzers.size > 0 && timing.chance(options.hitch)) {
        hitchMs = timing.between(100, 2000);
        record.hitches.push([frame, hitchMs]);
      }
      return { edges: edges.size > 0 ? edges : NO_EDGES, silences: silences.size > 0 ? silences : NO_SILENCES, hitchMs, typed: NO_TYPING, files: NO_FILES };
    },
    slow: (frame, measuredMs) => {
      if (measuredMs > 0) record.slow.push([frame, measuredMs]);
      return measuredMs;
    },
    recorded: () => record,
  };
}

/** A repro file's inputs, frame by frame. */
export function recordedInputs(inputs: SoakInputs): SoakInputSource {
  const edges = new Map<number, Map<number, SoakEdge[]>>();
  for (const [frame, slot, edge] of inputs.edges) {
    const slots = edges.get(frame) ?? new Map<number, SoakEdge[]>();
    slots.set(slot, [...(slots.get(slot) ?? []), edge]);
    edges.set(frame, slots);
  }
  const silences = new Map<number, Map<number, number>>();
  for (const [frame, slot, frames] of inputs.silences) silences.set(frame, (silences.get(frame) ?? new Map<number, number>()).set(slot, frames));
  const hitches = new Map(inputs.hitches.map(([frame, ms]) => [frame, ms]));
  const slow = new Map(inputs.slow.map(([frame, ms]) => [frame, ms]));
  const bySlot = <T>(entries: readonly (readonly [frame: number, slot: number, item: T])[]) => {
    const frames = new Map<number, Map<number, T[]>>();
    for (const [frame, slot, item] of entries) {
      const slots = frames.get(frame) ?? new Map<number, T[]>();
      slots.set(slot, [...(slots.get(slot) ?? []), item]);
      frames.set(frame, slots);
    }
    return frames;
  };
  const typed = bySlot(inputs.typed ?? []);
  const files = bySlot((inputs.files ?? []).map(([frame, slot, name, chunks]) => [frame, slot, [name, chunks] as const] as const));
  return {
    frame: (frame) => ({
      edges: edges.get(frame) ?? NO_EDGES, silences: silences.get(frame) ?? NO_SILENCES, hitchMs: hitches.get(frame) ?? 0,
      typed: typed.get(frame) ?? NO_TYPING, files: files.get(frame) ?? NO_FILES,
    }),
    slow: (frame) => slow.get(frame) ?? 0,
    recorded: () => inputs,
  };
}

/** What the game's driver is given before each frame. */
export interface SoakStep {
  /** The frame about to run, counted from the frame the match began. */
  readonly frame: number;
  /** Wall-clock milliseconds since the match began, as the players' input sources live it. */
  readonly wallMs: number;
  /** Each fuzzed slot's controller edges this frame, in order. */
  readonly edges: ReadonlyMap<number, readonly SoakEdge[]>;
  /** Slots whose input source sends nothing now. */
  readonly silent: ReadonlySet<number>;
}

/** What one client shows the soak after a frame. */
export interface SoakObservation {
  /** The confirmed frame, while the match should advance; undefined in menus, at results or in a pause. */
  readonly progress: number | undefined;
  /** What tells this player why the match waits, such as "Waiting for Player 2". */
  readonly waiting?: string | undefined;
  /** Frames of input that have reached the client and that it has yet to confirm. */
  readonly backlog?: number;
  /** The match has ended: its result shows. */
  readonly over: boolean;
}

/** One match being played: the game feeds its players' input and reads its clients. */
export interface SoakDriver {
  /** Before each frame: what every player's input source sends. */
  input(step: SoakStep): void;
  /** In a client, after each frame. */
  observe(client: HeadlessClient): SoakObservation;
  /** In a client: its confirmed state's frame and hash, which every client must agree on. */
  confirmed?(client: HeadlessClient): { readonly frame: number; readonly checksum: string } | undefined;
  /** In a client, when it writes a scene report: what its player must see now, such as each fighter in play. */
  bodies?(client: HeadlessClient): readonly SceneBody[];
  /**
   * In a client, at a match's first finding: the game's repro of the moments
   * before it, the lines its repro key saves (wisp:docs/repro.md), which
   * `wisp repro` replays.
   */
  repro?(client: HeadlessClient): readonly string[] | undefined;
  /**
   * Characters a player's input helper typed into their client's edit box
   * before this frame, which Warcraft takes at a cost that grows with their
   * square (wisp:src/headless/nativeCost.ts).
   */
  typed?(slot: number): number;
}

/** How a game plays a soak match. */
export interface SoakGame {
  /** The map entry the clients start: the build players run, with the scene recorder when the soak checks scenes. */
  readonly entry: MapEntry;
  /**
   * Takes started clients to the beginning of `match`: its fighters, stage
   * and policies. Throws when the match doesn't begin.
   */
  begin(clients: Lockstep, match: SoakMatch): SoakDriver;
}

/** When a detector reports. Milliseconds are the native game's. */
export interface SoakLimits {
  /** Frames without confirmed progress that make a stall: 3 s. */
  readonly stallFrames: number;
  /** Wall-clock milliseconds a frame has: 60 frames a second. */
  readonly frameMs: number;
  /** Native milliseconds per measured millisecond of a client's frame. */
  readonly costScale: number;
  /** A client frame costing more, after costScale, misses its moment. */
  readonly spikeMs: number;
  /** Backlog frames that count as behind; once they keep growing, or stay, the game can't catch up. */
  readonly backlogFrames: number;
  /** Seconds of growing lag or backlog that make a spiral. */
  readonly growthSeconds: number;
  /** Frames a backlog may stay above backlogFrames before the game counts as stuck behind. */
  readonly recoverFrames: number;
  /** Frames between confirmed-state comparisons. */
  readonly checksumEvery: number;
  /** Frames the match plays on after it is over, so what the result screen shows is checked too. */
  readonly afterOver: number;
  /** Frames a process plays before frame costs count: its first frames parse and compile the map's code. */
  readonly warmUpFrames: number;
}

export const SOAK_LIMITS: SoakLimits = {
  stallFrames: 180,
  frameMs: 1000 / 60,
  costScale: 1,
  spikeMs: 1000 / 60,
  backlogFrames: 60,
  growthSeconds: 3,
  recoverFrames: 180,
  checksumEvery: 60,
  afterOver: 60,
  warmUpFrames: 1200,
};

export type SoakFindingKind = "stall" | "desync" | "error" | "scene" | "invisible" | "cost" | "catch-up" | "unfinished" | "crash";

export interface SoakFinding {
  readonly kind: SoakFindingKind;
  /** The frame it was found after, counted from the frame the match began. */
  readonly frame: number;
  readonly slot?: number;
  readonly text: string;
}

export interface SoakResult {
  readonly match: SoakMatch;
  /** Frames played after the match began. */
  readonly frames: number;
  /** The game's wall clock at the end: frames at 60 a second, plus lag spikes and frames that cost more. */
  readonly wallMs: number;
  /** Measured milliseconds of the clients' frames, every client together. */
  readonly costMs: number;
  /** The costliest client frame, measured. */
  readonly worstFrameMs: number;
  readonly over: boolean;
  readonly findings: readonly SoakFinding[];
  readonly inputs: SoakInputs;
  /** Each client's native call checksum at the end. */
  readonly checksums: readonly string[];
  /** The game's repro lines from each client at the first finding, when the game saves repros. */
  readonly repros?: readonly (readonly [slot: number, lines: readonly string[]])[];
}

/**
 * This thread's CPU milliseconds on Linux, the process's elsewhere: a frame's
 * cost without the time another process held the core, or the collector's and
 * compiler's own threads ran beside it.
 */
export const cpuMillis: () => number = (() => {
  if (process.platform !== "linux") {
    return () => {
      const { user, system } = process.cpuUsage();
      return (user + system) / 1000;
    };
  }
  const libc = dlopen("libc.so.6", { clock_gettime: { args: ["i32", "ptr"], returns: "i32" } });
  const time = new BigInt64Array(2);
  const CLOCK_THREAD_CPUTIME_ID = 3;
  return () => {
    libc.symbols.clock_gettime(CLOCK_THREAD_CPUTIME_ID, time);
    return Number(time[0] ?? 0n) * 1000 + Number(time[1] ?? 0n) / 1e6;
  };
})();

/** Text of a finding with its numbers left out, to report each kind of problem once per client. */
const shape = (text: string) => text.replace(/\d+(\.\d+)?/g, "#");

/** A client frame that cost more than its moment: whose, how many native milliseconds, and how many of them taking typed text. */
interface CostlyFrame {
  readonly slot: number;
  readonly ms: number;
  readonly typingMs?: number;
}

/**
 * Watches a match's clients after every frame and keeps what it finds. The
 * soak's own loop and a game's real-time runs (such as through its input
 * helper) share it.
 */
export class SoakMonitor {
  readonly findings: SoakFinding[] = [];
  /** The game's repro lines from each client at the match's first finding. */
  readonly repros = new Map<number, readonly string[]>();
  /** Frames since the match began. */
  frame = 0;
  over = false;
  costMs = 0;
  worstFrameMs = 0;
  private readonly seen = new Set<string>();
  private readonly errors: number[];
  private readonly serials: number[];
  private readonly missing: string[][];
  private lastProgress: number | undefined;
  private stalledSince: number | undefined;
  private stallReported = false;
  private quietUntil = 0;
  /** Frames a client's cost, after costScale, was over spikeMs: the costliest client of each. */
  readonly spikes = new Map<number, CostlyFrame>();
  private behindSince: number | undefined;
  private readonly windows: { readonly lag: number; readonly backlog: number }[] = [];
  private overAt: number | undefined;
  /** Frames of this match before its frame costs count, while the process still compiles the map's code. */
  private readonly warmUp: number;

  constructor(
    readonly clients: Lockstep,
    private readonly driver: SoakDriver,
    private readonly limits: SoakLimits = SOAK_LIMITS,
    private readonly scene?: SceneExpectations,
    private readonly filePrefix = "wisp",
    /** Frames this process played before this match. */
    played = Number.POSITIVE_INFINITY,
  ) {
    this.warmUp = Math.max(0, limits.warmUpFrames - played);
    this.errors = clients.clients.map(() => 0);
    this.serials = clients.clients.map(() => 0);
    this.missing = clients.clients.map(() => []);
  }

  private find(kind: SoakFindingKind, text: string, slot?: number, key = shape(text)): void {
    const id = `${kind} ${slot ?? ""} ${key}`;
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.findings.push({ kind, frame: this.frame, text, ...(slot === undefined ? {} : { slot }) });
    const repro = this.driver.repro;
    if (repro === undefined || this.findings.length > 1) return;
    for (const client of this.clients.clients) {
      client.run(() => {
        const lines = repro.call(this.driver, client);
        if (lines !== undefined) this.repros.set(client.slot, lines);
      });
    }
  }

  /** Whether the match has played what it should: over, and the result shown a moment. */
  get done(): boolean {
    return this.overAt !== undefined && this.frame - this.overAt >= this.limits.afterOver;
  }

  /**
   * After each frame: `wallMs` is the game's wall clock, `quiet` the slots
   * whose input source sends nothing now, and `nativeMs` each client's
   * predicted native milliseconds for the frame: by default its measured cost
   * times costScale; `typingMs`, how much of each the edit-box stall is.
   */
  afterFrame(wallMs: number, quiet: ReadonlySet<number>, nativeMs?: readonly number[], typingMs?: readonly number[]): void {
    this.frame++;
    const { clients, driver, limits } = this;
    if (quiet.size > 0) this.quietUntil = this.frame + limits.stallFrames;
    const observations: SoakObservation[] = [];
    clients.clients.forEach((client, index) => {
      let observation: SoakObservation = { progress: undefined, over: false };
      client.run(() => {
        observation = driver.observe(client);
      });
      observations.push(observation);
      const cost = clients.costs[index] ?? 0;
      this.costMs += cost;
      this.worstFrameMs = Math.max(this.worstFrameMs, cost);
      const ms = nativeMs?.[index] ?? cost * limits.costScale;
      if (this.frame > this.warmUp && ms > limits.spikeMs) {
        if (ms > (this.spikes.get(this.frame)?.ms ?? 0)) this.spikes.set(this.frame, { slot: client.slot, ms, typingMs: typingMs?.[index] ?? 0 });
      }
      this.checkErrors(client, index);
      this.checkScene(client, index);
    });
    this.checkStall(observations);
    this.checkCatchUp(wallMs, observations, quiet.size > 0);
    if (this.frame % limits.checksumEvery === 0) this.checkDesync();
    if (this.overAt === undefined && observations.every(({ over }) => over)) this.overAt = this.frame;
    this.over = this.overAt !== undefined;
  }

  private checkErrors(client: HeadlessClient, index: number): void {
    const from = this.errors[index] ?? 0;
    for (const error of client.errors.slice(from)) {
      const thrown = client.thrown.at(-1)?.split("\n").slice(0, 6).join("\n    ");
      this.find("error", thrown === undefined ? error : `${error}\n    ${thrown}`, client.slot, shape(error));
    }
    this.errors[index] = client.errors.length;
  }

  private checkScene(client: HeadlessClient, index: number): void {
    if (this.scene === undefined) return;
    const lines = client.files.get(sceneFile(client.slot, this.filePrefix));
    const serial = Number(/^scene (\d+)/.exec(lines?.[0] ?? "")?.[1] ?? 0);
    if (lines === undefined || serial === this.serials[index]) return;
    this.serials[index] = serial;
    const report = readSceneLines(lines);
    if ("problem" in report) {
      this.find("scene", `scene report line ${report.line}: ${report.problem}`, client.slot);
      return;
    }
    for (const { seen, evidence } of sceneProblems(report, this.scene)) this.find("scene", `would see ${seen} (${evidence})`, client.slot, shape(`${seen} ${evidence.split(":")[0] ?? ""}`));
    const bodies = this.driver.bodies;
    if (bodies === undefined) return;
    let expected: readonly SceneBody[] = [];
    client.run(() => {
      expected = bodies.call(this.driver, client);
    });
    // A body counts as missing once two reports in a row show nothing of it: one report may fall between a KO and the game's state.
    const missing = bodyProblems(report, expected, this.scene.visibility?.models);
    const shapes = missing.map(({ seen }) => seen);
    for (const problem of missing) {
      if (this.missing[index]?.includes(problem.seen)) this.find("invisible", `would see ${problem.seen} (${problem.evidence}; report frame ${report.frame})`, client.slot, problem.seen);
    }
    this.missing[index] = shapes;
  }

  private checkStall(observations: readonly SoakObservation[]): void {
    const progress = observations.map(({ progress }) => progress);
    if (progress.some((value) => value === undefined)) {
      this.stalledSince = undefined;
      this.lastProgress = undefined;
      return;
    }
    const least = Math.min(...progress.map((value) => value ?? 0));
    if (this.lastProgress === undefined || least > this.lastProgress) {
      this.lastProgress = least;
      this.stalledSince = undefined;
      this.stallReported = false;
      return;
    }
    this.stalledSince ??= this.frame;
    const stalled = this.frame - this.stalledSince;
    if (this.stallReported || stalled < this.limits.stallFrames) return;
    const told = [...new Set(observations.flatMap(({ waiting }) => (waiting === undefined || waiting === "" ? [] : [waiting])))];
    const seconds = (stalled / 60).toFixed(1);
    if (told.length === 0) {
      this.stallReported = true;
      this.find("stall", `the match froze at confirmed frame ${least}: no progress for ${seconds} s and no player is told why`);
    } else if (this.frame >= this.quietUntil) {
      this.stallReported = true;
      this.find("stall", `the match stopped at confirmed frame ${least}: no progress for ${seconds} s while every player's input arrives; the players see "${told.join('", "')}"`);
    }
  }

  private checkCatchUp(wallMs: number, observations: readonly SoakObservation[], quiet: boolean): void {
    const { limits } = this;
    const backlog = Math.max(0, ...observations.map(({ backlog }) => backlog ?? 0));
    // A quiet input source holds every client's confirmed frame; catching up starts when it speaks again.
    if (quiet) {
      this.behindSince = undefined;
      this.windows.length = 0;
    } else if (backlog > limits.backlogFrames) {
      this.behindSince ??= this.frame;
      if (this.frame - this.behindSince === limits.recoverFrames) {
        this.find("catch-up", `the game stayed behind its input for ${(limits.recoverFrames / 60).toFixed(1)} s: ${backlog} frames of input not yet played`);
      }
    } else this.behindSince = undefined;
    if (this.frame % 60 !== 0) return;
    const lag = wallMs - this.frame * limits.frameMs;
    this.windows.push({ lag, backlog });
    const recent = this.windows.slice(-(limits.growthSeconds + 1));
    if (recent.length <= limits.growthSeconds) return;
    // Growth by more than a frame a second, so a clock summed frame by frame doesn't grow by its rounding.
    const growing = (value: (window: { readonly lag: number; readonly backlog: number }) => number, by: number) =>
      recent.every((window, index) => index === 0 || value(window) > value(recent[index - 1] ?? window) + by);
    if (growing(({ lag }) => lag, limits.frameMs) && lag > 1000) {
      this.find("catch-up", `the game fell ${(lag / 1000).toFixed(1)} s behind real time and kept falling for ${limits.growthSeconds} s (worst client frame ${this.worstFrameMs.toFixed(1)} ms measured)`);
    }
    // A spiral grows while behind: a game's usual backlog rising a few frames, then a lag spike, is a catch-up starting.
    if (growing(({ backlog }) => backlog, 1) && recent.every(({ backlog }) => backlog > limits.backlogFrames)) {
      this.find("catch-up", `catch-up spiral: input not yet played grew for ${limits.growthSeconds} s to ${backlog} frames`);
    }
  }

  private checkDesync(): void {
    const { clients, driver } = this;
    const divergence = clients.firstDivergence();
    if (divergence !== undefined) this.find("desync", `native calls differ ${divergence}`, undefined, "native");
    const confirmed = driver.confirmed;
    if (confirmed === undefined) return;
    // Clients compare states read on the same frame of the match, each at the confirmed frame it reached.
    const states = clients.clients.map((client) => {
      let state: { readonly slot: number; readonly frame: number; readonly checksum: string } | undefined;
      client.run(() => {
        const read = confirmed.call(driver, client);
        if (read !== undefined) state = { slot: client.slot, ...read };
      });
      return state;
    });
    for (const [index, state] of states.entries()) {
      const other = states.slice(index + 1).find((later) => later !== undefined && state !== undefined && later.frame === state.frame && later.checksum !== state.checksum);
      if (state === undefined || other === undefined) continue;
      this.find("desync", `confirmed state differs at frame ${state.frame}: p${state.slot} ${state.checksum}, p${other.slot} ${other.checksum}`, undefined, "confirmed");
    }
  }

  /** Reports the costly frames among `frames`, such as those a replay found costly too. */
  costFinding(frames: ReadonlyMap<number, CostlyFrame>, again?: ReadonlyMap<number, { readonly ms: number }>): void {
    let worst: [number, CostlyFrame] | undefined;
    for (const entry of frames) if (worst === undefined || entry[1].ms > worst[1].ms) worst = entry;
    if (worst === undefined) return;
    const [frame, { slot, ms, typingMs = 0 }] = worst;
    const replayed = again?.get(frame);
    this.find("cost", `${frames.size} client frame${frames.size === 1 ? "" : "s"} cost more than ${this.limits.spikeMs.toFixed(1)} ms${again === undefined ? "" : " in the match and again in its replay"}; the worst, p${slot}'s frame ${frame}, ${ms.toFixed(1)} ms${replayed === undefined ? "" : ` then ${replayed.ms.toFixed(1)} ms`}${typingMs > 0 ? `, ${typingMs.toFixed(1)} ms of it taking typed text` : ""}`);
  }

  /**
   * The findings the end of the match adds: a last desync check, a match that
   * didn't end, and with `costs` its costly frames as measured once.
   */
  finish(costs = true): readonly SoakFinding[] {
    this.checkDesync();
    if (costs) this.costFinding(this.spikes);
    if (this.overAt === undefined) this.find("unfinished", `the match didn't end in ${this.frame} frames`);
    return this.findings;
  }
}

/** What a soak match needs from the game's soak declaration. */
export interface SoakSetup {
  readonly map: HeadlessMap;
  readonly scene?: SceneExpectations;
  readonly controller: SoakController;
  readonly players?: readonly number[];
  readonly limits?: Partial<SoakLimits>;
  readonly fuzz?: Partial<FuzzOptions>;
  /**
   * Warcraft's costs beyond the measured frame time, which costScale scales:
   * each native call and the edit-box stall of typed text (nativeCost.ts).
   */
  readonly cost?: NativeCostModel;
}

/** Frames this process has played, across matches. */
let framesPlayed = 0;

const describeError = (error: unknown) => (error instanceof Error ? (error.stack ?? error.message).split("\n").slice(0, 8).join("\n    ") : String(error));

interface Played {
  readonly result: SoakResult;
  readonly monitor: SoakMonitor | undefined;
}

/**
 * Plays one match in two or more clients of the game's entry, faster than real time:
 * the game's wall clock gains 1/60 s a frame, more when a client's frame
 * costs more than that and by every lag spike, and the players' input
 * sources live on that clock. With `inputs` it replays a repro file's.
 */
export function playSoakMatch(runtime: HeadlessRuntime, game: SoakGame, setup: SoakSetup, match: SoakMatch, inputs?: SoakInputs): SoakResult {
  const first = playOnce(runtime, game, setup, match, inputs);
  const spikes = first.monitor?.spikes;
  if (spikes === undefined || spikes.size === 0 || first.result.findings.some(({ kind }) => kind === "crash")) return first.result;
  // A frame's cost is measured on a busy machine, where a collection or a
  // compile can land on any frame: a costly frame counts when its replay,
  // on the same clock, finds it costly again.
  const replay = playOnce(runtime, game, setup, match, first.result.inputs);
  const again = replay.monitor?.spikes ?? new Map<number, CostlyFrame>();
  const confirmed = new Map([...spikes].filter(([frame]) => again.has(frame)));
  first.monitor?.costFinding(confirmed, again);
  return { ...first.result, findings: first.monitor?.findings ?? first.result.findings };
}

function playOnce(runtime: HeadlessRuntime, game: SoakGame, setup: SoakSetup, match: SoakMatch, inputs?: SoakInputs): Played {
  const limits = { ...SOAK_LIMITS, ...setup.limits };
  const source = inputs === undefined ? fuzzedInputs(match, setup.controller, { ...SOAK_FUZZ, ...setup.fuzz }) : recordedInputs(inputs);
  const clients = runtime.clients(game.entry, setup.players ?? [0, 1], { delivery: syncDelivery(MEASURED_BATTLE_NET, match.seed), keepCalls: 64, cost: cpuMillis });
  const model = setup.cost ?? WARCRAFT_COST;
  /** Each client's native calls when its last frame ended. */
  let calls: number[] = [];
  let monitor: SoakMonitor | undefined;
  let wallMs = 0;
  const crashes: SoakFinding[] = [];
  try {
    clients.start();
    // Files a helper wrote that the map read before the match began, such as in its menus, are recorded at frame 0.
    for (const [frame, slot, name, chunks] of inputs?.files ?? []) if (frame === 0) clients.client(slot).published.set(name, chunks);
    const driver = game.begin(clients, match);
    calls = clients.clients.map((client) => client.callCount());
    const watching = new SoakMonitor(clients, driver, limits, setup.scene, setup.map.filePrefix, framesPlayed);
    monitor = watching;
    const quietUntil = new Map<number, number>();
    while (watching.frame < match.frames && !watching.done) {
      const frame = watching.frame + 1;
      const step = source.frame(frame);
      wallMs += step.hitchMs;
      for (const [slot, frames] of step.silences) quietUntil.set(slot, Math.max(quietUntil.get(slot) ?? 0, frame + frames));
      const quiet = new Set<number>();
      for (const [slot, until] of quietUntil) if (until > frame) quiet.add(slot);
      framesPlayed++;
      // What a player's input helper wrote and typed reaches their client before the frame, as RealtimeClients delivers it.
      for (const [slot, written] of step.files) for (const [name, chunks] of written) clients.client(slot).published.set(name, chunks);
      for (const [slot, lines] of step.typed) for (const line of lines) clients.type(slot, line);
      // In a match played through input helpers the edges reached the clients only as what the helpers typed.
      driver.input({ frame, wallMs, edges: match.typed === true ? NO_EDGES : step.edges, silent: quiet });
      clients.frames(1);
      // A frame's native cost: its measured time scaled, its natives' calls and the stall of what was typed before it.
      const typingMs: number[] = [];
      const nativeMs = clients.clients.map((client, index) => {
        const now = client.callCount();
        const natives = now - (calls[index] ?? 0);
        calls[index] = now;
        const typedCharacters = (driver.typed?.(client.slot) ?? 0) + (step.typed.get(client.slot) ?? []).reduce((sum, line) => sum + line.length, 0);
        const predicted = nativeFrameCost(model, { instructions: 0, natives, allocatedKb: 0, typedCharacters });
        typingMs.push(predicted.typingUs / 1000);
        return (clients.costs[index] ?? 0) * limits.costScale + (predicted.callbacksUs + predicted.typingUs) / 1000;
      });
      wallMs += limits.frameMs + source.slow(frame, Math.max(0, Math.max(0, ...nativeMs) - limits.frameMs));
      watching.afterFrame(wallMs, quiet, nativeMs, typingMs);
    }
  } catch (error) {
    crashes.push({ kind: "crash", frame: monitor?.frame ?? 0, text: describeError(error) });
  }
  // A crash ends the match early; it is the finding, not the match left unfinished.
  const findings = crashes.length > 0 ? [...(monitor?.findings ?? []), ...crashes] : monitor?.finish(false) ?? [];
  const result = {
    match,
    frames: monitor?.frame ?? 0,
    wallMs,
    costMs: monitor?.costMs ?? 0,
    worstFrameMs: monitor?.worstFrameMs ?? 0,
    over: monitor?.over ?? false,
    findings,
    inputs: source.recorded(),
    checksums: clients.clients.map((client) => client.checksum()),
    ...(monitor === undefined || monitor.repros.size === 0 ? {} : { repros: [...monitor.repros] }),
  };
  return { result, monitor };
}

/**
 * What a real-time run through players' input helpers records for its repro:
 * `input` and `files` wrap each player's typed text and CustomMapData, and
 * `recorded` gives what they delivered, by the frame `frame()` says is next.
 */
export function helperRecorder(frame: () => number) {
  const typed: [number, number, string][] = [];
  const files: [number, number, string, readonly string[]][] = [];
  const read = new Map<string, string>();
  return {
    input: (slot: number, input: TypedInput): TypedInput => ({
      read: () => {
        const lines = input.read();
        for (const line of lines) typed.push([frame(), slot, line]);
        return lines;
      },
      close: () => input.close(),
    }),
    files: (slot: number, stored: ClientFiles): ClientFiles => ({
      written: (name, lines) => stored.written(name, lines),
      read: (name) => {
        const chunks = stored.read(name);
        const key = `${slot} ${name}`;
        if (chunks !== undefined && read.get(key) !== chunks.join("\n")) {
          read.set(key, chunks.join("\n"));
          files.push([frame(), slot, name, chunks]);
        }
        return chunks;
      },
    }),
    recorded: (inputs: SoakInputs): SoakInputs => ({ ...inputs, typed, files }),
  };
}

/** A repro file: one match, what it found, and its inputs, so `soak --repro FILE` plays it again. */
export interface SoakRepro {
  readonly format: "wisp-soak-repro";
  readonly version: 1;
  /** The game's soak, such as its name. */
  readonly project: string;
  readonly match: SoakMatch;
  readonly findings: readonly SoakFinding[];
  readonly checksums: readonly string[];
  readonly inputs: SoakInputs;
}

export const soakRepro = (project: string, result: SoakResult): SoakRepro => ({
  format: "wisp-soak-repro",
  version: 1,
  project,
  match: result.match,
  findings: result.findings,
  checksums: result.checksums,
  inputs: result.inputs,
});

const Whole = Schema.Int;
const MatchSchema = Schema.Struct({
  index: Whole, seed: Whole, fighters: Schema.Array(Schema.String), stage: Schema.String, policies: Schema.Array(Schema.String), frames: Whole,
  typed: Schema.optionalKey(Schema.Boolean),
});
const FindingSchema = Schema.Struct({
  kind: Schema.Literals(["stall", "desync", "error", "scene", "invisible", "cost", "catch-up", "unfinished", "crash"]),
  frame: Whole,
  slot: Schema.optionalKey(Whole),
  text: Schema.String,
});
const InputsSchema = Schema.Struct({
  edges: Schema.Array(Schema.Tuple([Whole, Whole, Schema.Union([
    Schema.Struct({ button: Whole, down: Schema.Boolean }),
    Schema.Struct({ axis: Whole, value: Whole }),
  ])])),
  silences: Schema.Array(Schema.Tuple([Whole, Whole, Whole])),
  hitches: Schema.Array(Schema.Tuple([Whole, Whole])),
  slow: Schema.Array(Schema.Tuple([Whole, Schema.Finite])),
  typed: Schema.optionalKey(Schema.Array(Schema.Tuple([Whole, Whole, Schema.String]))),
  files: Schema.optionalKey(Schema.Array(Schema.Tuple([Whole, Whole, Schema.String, Schema.Array(Schema.String)]))),
});
const ReproFile = Schema.fromJsonString(Schema.Struct({
  format: Schema.Literal("wisp-soak-repro"),
  version: Schema.Literal(1),
  project: Schema.String,
  match: MatchSchema,
  findings: Schema.Array(FindingSchema),
  checksums: Schema.Array(Schema.String),
  inputs: InputsSchema,
}));

/** A repro file's contents; throws when the text isn't one. */
export const readSoakRepro = (text: string): SoakRepro => Schema.decodeSync(ReproFile)(text);

/** A match as the soak command sends it to a worker process, one JSON line. */
export const readSoakMatch = (line: string): SoakMatch => Schema.decodeSync(Schema.fromJsonString(MatchSchema))(line);

/** A worker's answer for one match: its result, with its inputs only when it found something. */
export interface SoakReply extends Omit<SoakResult, "inputs"> {
  readonly inputs?: SoakInputs;
}

const ReplySchema = Schema.fromJsonString(Schema.Struct({
  match: MatchSchema,
  frames: Whole,
  wallMs: Schema.Finite,
  costMs: Schema.Finite,
  worstFrameMs: Schema.Finite,
  over: Schema.Boolean,
  findings: Schema.Array(FindingSchema),
  checksums: Schema.Array(Schema.String),
  inputs: Schema.optionalKey(InputsSchema),
  repros: Schema.optionalKey(Schema.Array(Schema.Tuple([Whole, Schema.Array(Schema.String)]))),
}));

export const soakReply = ({ inputs, ...result }: SoakResult): SoakReply => (result.findings.length > 0 ? { ...result, inputs } : result);
export const readSoakReply = (line: string): SoakReply => Schema.decodeSync(ReplySchema)(line);

/** A match in a line: its fighters, stage, policies and seed. */
export const describeMatch = ({ index, fighters, stage, policies, seed }: SoakMatch) =>
  `match ${index}: ${fighters.join(" vs ")} on ${stage}, ${policies.join("/")}, seed ${seed}`;

/** A game's soak: the default export of its soak module, made with defineSoak(). */
export interface SoakProject extends SoakSetup {
  /** The game's name, kept in repro files. */
  readonly name: string;
  /**
   * The module whose default export, made with defineSoakGame(), plays
   * matches. It loads only where matches play, so the game's host program
   * never reads map code.
   */
  readonly game: string;
  readonly roster: SoakRoster;
  /** Frames a match may run after it began. */
  readonly frames: number;
  /** Matches a run plays unless told how many. */
  readonly matches: number;
}

const PROJECT = Symbol.for("wisp.soak.project");
const GAME = Symbol.for("wisp.soak.game");

export const defineSoak = (project: SoakProject): SoakProject => Object.assign({ [PROJECT]: true }, project);
export const defineSoakGame = (game: SoakGame): SoakGame => Object.assign({ [GAME]: true }, { entry: game.entry, begin: (clients: Lockstep, match: SoakMatch) => game.begin(clients, match) });

const isSoakProject = (value: unknown): value is SoakProject => typeof value === "object" && value !== null && PROJECT in value;
const isSoakGame = (value: unknown): value is SoakGame => typeof value === "object" && value !== null && GAME in value;

async function defaultExport(path: string): Promise<unknown> {
  const module: unknown = await import(path);
  return typeof module === "object" && module !== null && "default" in module ? module.default : undefined;
}

/** The soak a module declares; throws when its default export isn't one. */
export async function loadSoakProject(path: string): Promise<SoakProject> {
  const value = await defaultExport(path);
  if (!isSoakProject(value)) throw new Error(`${path} exports no defineSoak() declaration as its default`);
  return value;
}

/** The match setup a module declares; throws when its default export isn't one. */
export async function loadSoakGame(path: string): Promise<SoakGame> {
  const value = await defaultExport(path);
  if (!isSoakGame(value)) throw new Error(`${path} exports no defineSoakGame() setup as its default`);
  return value;
}
