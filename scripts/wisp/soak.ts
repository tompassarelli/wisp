import { Effect, Schema } from "effect";
import { runPlatformSync } from "../platform/layer";
import { ResourceAccounting } from "../platform/services";
import type { ClientFiles, HeadlessClient, MapEntry } from "../../src/headless/client";
import type { Lockstep } from "../../src/headless/lockstep";
import { sceneFile } from "../../src/runtime/scene";
import type { HeadlessMap, HeadlessRuntime } from "./headless";
import type { TypedInput } from "./headlessInput";
import { Random } from "../../src/headless/random";
import { type SceneBody, type SceneExpectations, bodyProblems, readSceneLines, sceneProblems } from "./scene";
import { type NativeCostModel, WARCRAFT_COST, nativeFrameCost } from "../../src/headless/nativeCost";
import { MEASURED_BATTLE_NET, syncDelivery } from "../../src/headless/syncChannel";
import { describeStack } from "./command";

export interface SoakController {
  readonly buttons: readonly string[];

  readonly weights?: readonly number[];

  readonly toggles?: readonly string[];
  readonly axes: readonly string[];
  readonly axisLimit: number;

  readonly deadZone: number;
}

export type SoakEdge =
  | { readonly button: number; readonly down: boolean }
  | { readonly axis: number; readonly value: number };

export interface SoakInputFrame {

  readonly edges: ReadonlyMap<number, readonly SoakEdge[]>;

  readonly silences: ReadonlyMap<number, number>;

  readonly hitchMs: number;

  readonly typed: ReadonlyMap<number, readonly string[]>;

  readonly files: ReadonlyMap<number, readonly (readonly [name: string, chunks: readonly string[]])[]>;
}

export interface SoakInputs {
  readonly edges: readonly (readonly [frame: number, slot: number, edge: SoakEdge])[];
  readonly silences: readonly (readonly [frame: number, slot: number, frames: number])[];
  readonly hitches: readonly (readonly [frame: number, ms: number])[];

  readonly slow: readonly (readonly [frame: number, ms: number])[];

  readonly typed?: readonly (readonly [frame: number, slot: number, text: string])[];
  readonly files?: readonly (readonly [frame: number, slot: number, name: string, chunks: readonly string[]])[];
}

export interface FuzzOptions {

  readonly rate: number;

  readonly silence: number;

  readonly hitch: number;
}

export const SOAK_FUZZ: FuzzOptions = { rate: 1 / 8, silence: 1 / 3600, hitch: 1 / 2400 };

export const FUZZ_POLICY = "fuzz";

export interface SoakMatch {

  readonly index: number;
  readonly seed: number;

  readonly fighters: readonly string[];
  readonly stage: string;

  readonly policies: readonly string[];

  readonly frames: number;

  readonly typed?: boolean;
}

export interface SoakRoster {
  readonly fighters: readonly string[];
  readonly stages: readonly string[];

  readonly policies: readonly (readonly string[])[];
}

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

type Pattern = (readonly [delay: number, edge: SoakEdge])[];

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

export interface SoakInputSource {
  frame(frame: number): SoakInputFrame;

  slow(frame: number, measuredMs: number): number;

  recorded(): SoakInputs;
}

const NO_EDGES: ReadonlyMap<number, readonly SoakEdge[]> = new Map();
const NO_SILENCES: ReadonlyMap<number, number> = new Map();
const NO_TYPING: ReadonlyMap<number, readonly string[]> = new Map();
const NO_FILES: ReadonlyMap<number, readonly (readonly [string, readonly string[]])[]> = new Map();

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

export interface SoakStep {

  readonly frame: number;

  readonly wallMs: number;

  readonly edges: ReadonlyMap<number, readonly SoakEdge[]>;

  readonly silent: ReadonlySet<number>;
}

export interface SoakObservation {

  readonly progress: number | undefined;

  readonly waiting?: string | undefined;

  readonly backlog?: number;

  readonly over: boolean;
}

export interface SoakDriver {

  input(step: SoakStep): void;

  observe(client: HeadlessClient): SoakObservation;

  confirmed?(client: HeadlessClient): { readonly frame: number; readonly checksum: string } | undefined;

  bodies?(client: HeadlessClient): readonly SceneBody[];

  repro?(client: HeadlessClient): readonly string[] | undefined;

  typed?(slot: number): number;

  findings?(client: HeadlessClient): readonly SoakGameFinding[];
}

export interface SoakGameFinding {

  readonly detector: string;
  readonly text: string;
}

export interface SoakGame {

  readonly entry: MapEntry;

  begin(clients: Lockstep, match: SoakMatch): SoakDriver;
}

export interface SoakLimits {

  readonly stallFrames: number;

  readonly frameMs: number;

  readonly costScale: number;

  readonly spikeMs: number;

  readonly typingMs: number;

  readonly backlogFrames: number;

  readonly growthSeconds: number;

  readonly recoverFrames: number;

  readonly checksumEvery: number;

  readonly afterOver: number;

  readonly warmUpFrames: number;
}

export const SOAK_LIMITS: SoakLimits = {
  stallFrames: 180,
  frameMs: 1000 / 60,
  costScale: 1,
  spikeMs: 1000 / 60,
  typingMs: 1000 / 60,
  backlogFrames: 60,
  growthSeconds: 3,
  recoverFrames: 180,
  checksumEvery: 60,
  afterOver: 60,
  warmUpFrames: 1200,
};

export type SoakFindingKind = "stall" | "desync" | "error" | "scene" | "invisible" | "cost" | "typing" | "catch-up" | "unfinished" | "crash" | "game";

export interface SoakFinding {
  readonly kind: SoakFindingKind;

  readonly frame: number;
  readonly slot?: number;
  readonly text: string;
}

export interface SoakResult {
  readonly match: SoakMatch;

  readonly frames: number;

  readonly wallMs: number;

  readonly costMs: number;

  readonly worstFrameMs: number;

  readonly typingStallsMs: readonly number[];
  readonly over: boolean;
  readonly findings: readonly SoakFinding[];
  readonly inputs: SoakInputs;

  readonly checksums: readonly string[];

  readonly repros?: readonly (readonly [slot: number, lines: readonly string[]])[];
}

let threadClock: (() => number) | undefined;

export const cpuMillis = (): number => (threadClock ??= runPlatformSync(ResourceAccounting.use((accounting) => Effect.succeed(accounting.threadCpuMillis))))();

const shape = (text: string) => text.replace(/\d+(\.\d+)?/g, "#");

interface CostlyFrame {
  readonly slot: number;
  readonly ms: number;
}

export class SoakMonitor {
  readonly findings: SoakFinding[] = [];

  readonly repros = new Map<number, readonly string[]>();

  frame = 0;
  over = false;
  costMs = 0;
  worstFrameMs = 0;

  readonly typingStallsMs: number[] = [];
  private readonly seen = new Set<string>();
  private readonly errors: number[];
  private readonly serials: number[];
  private readonly missing: string[][];
  private lastProgress: number | undefined;
  private stalledSince: number | undefined;
  private stallReported = false;
  private quietUntil = 0;

  readonly spikes = new Map<number, CostlyFrame>();
  private behindSince: number | undefined;
  private readonly windows: { readonly lag: number; readonly backlog: number }[] = [];
  private overAt: number | undefined;

  private readonly warmUp: number;

  constructor(
    readonly clients: Lockstep,
    private readonly driver: SoakDriver,
    private readonly limits: SoakLimits = SOAK_LIMITS,
    private readonly scene?: SceneExpectations,
    private readonly filePrefix = "wisp",

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

  get done(): boolean {
    return this.overAt !== undefined && this.frame - this.overAt >= this.limits.afterOver;
  }

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
        if (ms > (this.spikes.get(this.frame)?.ms ?? 0)) this.spikes.set(this.frame, { slot: client.slot, ms });
      }

      const typing = typingMs?.[index] ?? 0;
      if (typing > limits.frameMs) this.typingStallsMs.push(typing);
      if (typing > limits.typingMs) {
        this.find("typing", `p${client.slot}'s frame ${this.frame} has a recovery typing stall of ${typing.toFixed(1)} ms, over the ${limits.typingMs.toFixed(1)} ms budget of what its input helper may type at once`, client.slot, "typing");
      }
      this.checkErrors(client, index);
      this.checkScene(client, index);
      this.checkGame(client);
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

    const missing = bodyProblems(report, expected, this.scene.visibility?.models);
    const shapes = missing.map(({ seen }) => seen);
    for (const problem of missing) {
      if (this.missing[index]?.includes(problem.seen)) this.find("invisible", `would see ${problem.seen} (${problem.evidence}; report frame ${report.frame})`, client.slot, problem.seen);
    }
    this.missing[index] = shapes;
  }

  private checkGame(client: HeadlessClient): void {
    const detect = this.driver.findings;
    if (detect === undefined) return;
    let found: readonly SoakGameFinding[] = [];
    client.run(() => {
      found = detect.call(this.driver, client);
    });
    for (const { detector, text } of found) this.find("game", `${detector}: ${text}`, client.slot, detector);
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

    const growing = (value: (window: { readonly lag: number; readonly backlog: number }) => number, by: number) =>
      recent.every((window, index) => index === 0 || value(window) > value(recent[index - 1] ?? window) + by);
    if (growing(({ lag }) => lag, limits.frameMs) && lag > 1000) {
      this.find("catch-up", `the game fell ${(lag / 1000).toFixed(1)} s behind real time and kept falling for ${limits.growthSeconds} s (worst client frame ${this.worstFrameMs.toFixed(1)} ms measured)`);
    }

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

  costFinding(frames: ReadonlyMap<number, CostlyFrame>, again?: ReadonlyMap<number, { readonly ms: number }>): void {
    let worst: [number, CostlyFrame] | undefined;
    for (const entry of frames) if (worst === undefined || entry[1].ms > worst[1].ms) worst = entry;
    if (worst === undefined) return;
    const [frame, { slot, ms }] = worst;
    const replayed = again?.get(frame);
    this.find("cost", `${frames.size} client frame${frames.size === 1 ? "" : "s"} cost more than ${this.limits.spikeMs.toFixed(1)} ms${again === undefined ? "" : " in the match and again in its replay"}; the worst, p${slot}'s frame ${frame}, ${ms.toFixed(1)} ms${replayed === undefined ? "" : ` then ${replayed.ms.toFixed(1)} ms`}`);
  }

  finish(costs = true): readonly SoakFinding[] {
    this.checkDesync();
    if (costs) this.costFinding(this.spikes);
    if (this.overAt === undefined) this.find("unfinished", `the match didn't end in ${this.frame} frames`);
    return this.findings;
  }
}

export interface SoakSetup {
  readonly map: HeadlessMap;
  readonly scene?: SceneExpectations;
  readonly controller: SoakController;
  readonly players?: readonly number[];
  readonly limits?: Partial<SoakLimits>;
  readonly fuzz?: Partial<FuzzOptions>;

  readonly cost?: NativeCostModel;
}

let framesPlayed = 0;

interface Played {
  readonly result: SoakResult;
  readonly monitor: SoakMonitor | undefined;
}

export function playSoakMatch(runtime: HeadlessRuntime, game: SoakGame, setup: SoakSetup, match: SoakMatch, inputs?: SoakInputs): SoakResult {
  const first = playOnce(runtime, game, setup, match, inputs);
  const spikes = first.monitor?.spikes;
  if (spikes === undefined || spikes.size === 0 || first.result.findings.some(({ kind }) => kind === "crash")) return first.result;

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

  let calls: number[] = [];
  let monitor: SoakMonitor | undefined;
  let wallMs = 0;
  const crashes: SoakFinding[] = [];
  try {
    clients.start();

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

      for (const [slot, written] of step.files) for (const [name, chunks] of written) clients.client(slot).published.set(name, chunks);
      for (const [slot, lines] of step.typed) for (const line of lines) clients.type(slot, line);

      driver.input({ frame, wallMs, edges: match.typed === true ? NO_EDGES : step.edges, silent: quiet });
      clients.frames(1);

      const typingMs: number[] = [];
      const nativeMs = clients.clients.map((client, index) => {
        const now = client.callCount();
        const natives = now - (calls[index] ?? 0);
        calls[index] = now;
        const typedCharacters = (driver.typed?.(client.slot) ?? 0) + (step.typed.get(client.slot) ?? []).reduce((sum, line) => sum + line.length, 0);
        const predicted = nativeFrameCost(model, { instructions: 0, natives, allocatedKb: 0, typedCharacters });
        typingMs.push(predicted.typingUs / 1000);
        const measured = framesPlayed > limits.warmUpFrames ? clients.costs[index] ?? 0 : 0;
        return measured * limits.costScale + predicted.callbacksUs / 1000;
      });

      const frameMs = Math.max(0, ...nativeMs.map((ms, index) => ms + (typingMs[index] ?? 0)));
      wallMs += limits.frameMs + source.slow(frame, Math.max(0, frameMs - limits.frameMs));
      watching.afterFrame(wallMs, quiet, nativeMs, typingMs);
    }
  } catch (error) {
    crashes.push({ kind: "crash", frame: monitor?.frame ?? 0, text: describeStack(error, 8, "\n    ") });
  }

  const findings = crashes.length > 0 ? [...(monitor?.findings ?? []), ...crashes] : monitor?.finish(false) ?? [];
  const result = {
    match,
    frames: monitor?.frame ?? 0,
    wallMs,
    costMs: monitor?.costMs ?? 0,
    worstFrameMs: monitor?.worstFrameMs ?? 0,
    typingStallsMs: monitor?.typingStallsMs ?? [],
    over: monitor?.over ?? false,
    findings,
    inputs: source.recorded(),
    checksums: clients.clients.map((client) => client.checksum()),
    ...(monitor === undefined || monitor.repros.size === 0 ? {} : { repros: [...monitor.repros] }),
  };
  return { result, monitor };
}

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

export interface SoakRepro {
  readonly format: "wisp-soak-repro";
  readonly version: 1;

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
  kind: Schema.Literals(["stall", "desync", "error", "scene", "invisible", "cost", "typing", "catch-up", "unfinished", "crash", "game"]),
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

export const readSoakRepro = (text: string): SoakRepro => Schema.decodeSync(ReproFile)(text);

export const readSoakMatch = (line: string): SoakMatch => Schema.decodeSync(Schema.fromJsonString(MatchSchema))(line);

export interface SoakReply extends Omit<SoakResult, "inputs"> {
  readonly inputs?: SoakInputs;
}

const ReplySchema = Schema.fromJsonString(Schema.Struct({
  match: MatchSchema,
  frames: Whole,
  wallMs: Schema.Finite,
  costMs: Schema.Finite,
  worstFrameMs: Schema.Finite,
  typingStallsMs: Schema.Array(Schema.Finite),
  over: Schema.Boolean,
  findings: Schema.Array(FindingSchema),
  checksums: Schema.Array(Schema.String),
  inputs: Schema.optionalKey(InputsSchema),
  repros: Schema.optionalKey(Schema.Array(Schema.Tuple([Whole, Schema.Array(Schema.String)]))),
}));

export const soakReply = ({ inputs, ...result }: SoakResult): SoakReply => (result.findings.length > 0 ? { ...result, inputs } : result);
export const readSoakReply = (line: string): SoakReply => Schema.decodeSync(ReplySchema)(line);

export const describeMatch = ({ index, fighters, stage, policies, seed }: SoakMatch) =>
  `match ${index}: ${fighters.join(" vs ")} on ${stage}, ${policies.join("/")}, seed ${seed}`;

export interface SoakProject extends SoakSetup {

  readonly name: string;

  readonly game: string;
  readonly roster: SoakRoster;

  readonly frames: number;

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

export async function loadSoakProject(path: string): Promise<SoakProject> {
  const value = await defaultExport(path);
  if (!isSoakProject(value)) throw new Error(`${path} exports no defineSoak() declaration as its default`);
  return value;
}

export async function loadSoakGame(path: string): Promise<SoakGame> {
  const value = await defaultExport(path);
  if (!isSoakGame(value)) throw new Error(`${path} exports no defineSoakGame() setup as its default`);
  return value;
}
