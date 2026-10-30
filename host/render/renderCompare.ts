import { decodePng, type Image } from "../fidelity/image";

export const AREAS = ["flat", "edge"] as const;
export type Area = (typeof AREAS)[number];

export const METRICS = ["maxDelta", "p99Delta", "meanDelta", "differingFraction"] as const;
export type Metric = (typeof METRICS)[number];
export type Measures = Readonly<Record<Metric, number>>;

/** A pixel differs when any channel moves by more than this many levels. */
const DIFFERING_LEVELS = 2;
/** A reference pixel is on an edge when a neighbour in its 3x3 block differs from it by more than this many levels. */
const EDGE_LEVELS = 16;
/** The bound is the measured spread times this, so a rerun's jitter stays inside it. */
export const HEADROOM = 1.5;

export interface RegionReport {
  readonly name: string;
  readonly scene: string;
  readonly area: Area;
  readonly pixels: number;
  readonly measured: Measures;
  readonly bound: Measures;
}

const channelDelta = (a: Image, b: Image, at: number): number => Math.max(Math.abs((a.rgb[at] ?? 0) - (b.rgb[at] ?? 0)), Math.abs((a.rgb[at + 1] ?? 0) - (b.rgb[at + 1] ?? 0)), Math.abs((a.rgb[at + 2] ?? 0) - (b.rgb[at + 2] ?? 0)));

const isEdge = (image: Image, x: number, y: number): boolean => {
  const centre = (y * image.width + x) * 3;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= image.width || ny >= image.height) continue;
    const near = (ny * image.width + nx) * 3;
    if (Math.max(Math.abs((image.rgb[centre] ?? 0) - (image.rgb[near] ?? 0)), Math.abs((image.rgb[centre + 1] ?? 0) - (image.rgb[near + 1] ?? 0)), Math.abs((image.rgb[centre + 2] ?? 0) - (image.rgb[near + 2] ?? 0))) > EDGE_LEVELS) return true;
  }
  return false;
};

/** Per-pixel largest channel delta between two same-size images, with the area each pixel falls in (edges are found in the reference). */
const deltasByArea = (reference: Image, candidate: Image): Record<Area, number[]> => {
  const deltas: Record<Area, number[]> = { flat: [], edge: [] };
  for (let y = 0; y < reference.height; y++) for (let x = 0; x < reference.width; x++) {
    deltas[isEdge(reference, x, y) ? "edge" : "flat"].push(channelDelta(reference, candidate, (y * reference.width + x) * 3));
  }
  return deltas;
};

export const measure = (deltas: readonly number[]): Measures => {
  if (deltas.length === 0) return { maxDelta: 0, p99Delta: 0, meanDelta: 0, differingFraction: 0 };
  const sorted = Uint8Array.from(deltas).sort();
  let sum = 0, differing = 0;
  for (const delta of sorted) { sum += delta; if (delta > DIFFERING_LEVELS) differing++; }
  return { maxDelta: sorted.at(-1) ?? 0, p99Delta: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0, meanDelta: sum / sorted.length, differingFraction: differing / sorted.length };
};

const rounded = (value: number, step: number, ceiling: number) => Math.min(ceiling, Math.max(0, Math.ceil(value / step - 1e-9)) * step);

/** Levels round up to a whole level (at most 255) and the fraction up to a thousandth (at most 1), so the recorded bound is a stable number. */
export const boundOf = (measured: Measures): Measures => ({
  maxDelta: rounded(measured.maxDelta * HEADROOM, 1, 255),
  p99Delta: rounded(measured.p99Delta * HEADROOM, 1, 255),
  meanDelta: rounded(measured.meanDelta * HEADROOM, 0.001, 255),
  differingFraction: rounded(measured.differingFraction * HEADROOM, 0.001, 1),
});

export const compareScene = (scene: string, referencePng: Uint8Array, candidatePng: Uint8Array): RegionReport[] => {
  const reference = decodePng(referencePng), candidate = decodePng(candidatePng);
  if (reference.width !== candidate.width || reference.height !== candidate.height) throw new Error(`${scene}: reference is ${reference.width}x${reference.height} and candidate ${candidate.width}x${candidate.height}`);
  const deltas = deltasByArea(reference, candidate);
  return AREAS.map((area) => {
    const measured = measure(deltas[area]);
    return { name: `${scene}/${area}`, scene, area, pixels: deltas[area].length, measured, bound: boundOf(measured) };
  });
};
