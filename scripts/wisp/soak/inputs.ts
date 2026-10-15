import { Random } from "../../../src/headless/random";
import type { FuzzOptions, SoakController, SoakEdge, SoakInputFrame, SoakInputs, SoakMatch } from "./types";

export const SOAK_FUZZ: FuzzOptions = { rate: 1 / 8, silence: 1 / 3600, hitch: 1 / 2400 };

export const FUZZ_POLICY = "fuzz";

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

  private readonly patterns: readonly (() => Pattern)[] = [
    () => this.tap(),
    () => this.hold(),
    () => this.chord(),
    () => this.mash(),
    () => this.flick(),
    () => this.sweep(),
    () => this.wobble(),
    () => this.aimedPress(),
    () => this.release(),
    () => this.toggle(),
  ];

  private axis(): number {
    return this.random.between(0, this.controller.axes.length - 1);
  }

  private rim(): number {
    return this.random.chance(0.5) ? this.controller.axisLimit : -this.controller.axisLimit;
  }

  private pattern(): Pattern {
    const choice = this.random.between(0, this.toggles.size > 0 ? 9 : 8);
    if (!this.weights.some((weight) => weight > 0) && (choice < 4 || choice === 7)) return [];
    if (this.controller.axes.length === 0 && choice >= 4 && choice < 8) return [];
    return this.patterns[choice]?.() ?? [];
  }

  private tap(): Pattern {
    const button = this.button();
    return [[0, { button, down: true }], [0, { button, down: false }]];
  }

  private hold(): Pattern {
    const button = this.button();
    return [[0, { button, down: true }], [this.random.chance(0.5) ? this.random.between(1, 4) : this.random.between(5, 90), { button, down: false }]];
  }

  private chord(): Pattern {
    const buttons = [...new Set([this.button(), this.button(), this.button()])].slice(0, this.random.between(2, 3));
    const hold = this.random.between(0, 30);
    return [...buttons.map((button) => [0, { button, down: true }] as const), ...buttons.map((button) => [hold, { button, down: false }] as const)];
  }

  private mash(): Pattern {
    const button = this.button();
    const period = this.random.between(1, 3);
    return Array.from({ length: this.random.between(4, 20) }, (_, index) => [index * period, { button, down: index % 2 === 0 }] as const)
      .concat([[20 * period, { button, down: false }]]);
  }

  private flick(): Pattern {
    const index = this.axis();
    return [[0, { axis: index, value: this.rim() }], [this.random.between(1, 3), { axis: index, value: 0 }]];
  }

  private sweep(): Pattern {
    const index = this.axis();
    const steps = this.random.between(4, 30);
    const from = this.rim();
    return Array.from({ length: steps + 1 }, (_, step) => [step, { axis: index, value: Math.round(from - (2 * from * step) / steps) }] as const)
      .concat([[steps + this.random.between(0, 20), { axis: index, value: 0 }]]);
  }

  private wobble(): Pattern {
    const index = this.axis();
    const reach = Math.max(1, 2 * this.controller.deadZone);
    const frames = this.random.between(3, 30);
    return Array.from({ length: frames }, (_, frame) => [frame, { axis: index, value: this.random.between(-reach, reach) }] as const)
      .concat([[frames, { axis: index, value: 0 }]]);
  }

  private aimedPress(): Pattern {
    const index = this.axis();
    const button = this.button();
    const hold = this.random.between(1, 12);
    return [[0, { axis: index, value: this.rim() }], [0, { button, down: true }], [hold, { button, down: false }], [hold + this.random.between(0, 6), { axis: index, value: 0 }]];
  }

  private release(): Pattern {
    return [
      ...[...this.held].map((button) => [0, { button, down: false }] as const),
      ...this.axes.flatMap((value, index) => (value === 0 ? [] : [[0, { axis: index, value: 0 }] as const])),
    ];
  }

  private toggle(): Pattern {
    const button = this.random.pick([...this.toggles]);
    const gap = this.random.between(10, 120);
    return [[0, { button, down: true }], [1, { button, down: false }], [gap, { button, down: true }], [gap + 1, { button, down: false }]];
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

export const NO_EDGES: ReadonlyMap<number, readonly SoakEdge[]> = new Map();
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
