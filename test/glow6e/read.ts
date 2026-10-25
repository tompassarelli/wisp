import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../frames125/read";
import { stillness } from "../glow6/read";
import { PHASES } from "./layout";
import { HEIGHT, WIDTH } from "./oracle";

interface Image { readonly width: number; readonly height: number; readonly rgb: Uint8Array }
type Box = readonly [left: number, top: number, right: number, bottom: number];

export interface PhaseReading {
  readonly phase: string;
  readonly sum: { readonly measured: number; readonly predicted: number };
  readonly gain: number;
  readonly centroid: { readonly measured: readonly [number, number]; readonly predicted: readonly [number, number] };
  readonly box24: { readonly measured?: Box; readonly predicted?: Box };
  /** Measured light outside the predicted 24-level box grown by 2 px, and how many pixels of it pass 24 levels. */
  readonly outside: { readonly light: number; readonly over24: number };
  readonly p95: number;
  readonly darker: number;
}

/** Light-weighted sums, centroids and 24-level boxes of measured added light (shown minus its reference) and Wisp's prediction, on the brightest channel. */
export function readPhase(phase: string, added: Float32Array, shown: Image, reference: Image): PhaseReading {
  let measuredSum = 0, predictedSum = 0, mp = 0, pp = 0, darker = 0, outsideLight = 0, outsideOver = 0;
  const centroid = { measured: [0, 0, 0], predicted: [0, 0, 0] };
  const edges = { measured: [Infinity, Infinity, -Infinity, -Infinity], predicted: [Infinity, Infinity, -Infinity, -Infinity] };
  const grow = (edge: number[], x: number, y: number) => { edge[0] = Math.min(edge[0] ?? 0, x); edge[1] = Math.min(edge[1] ?? 0, y); edge[2] = Math.max(edge[2] ?? 0, x + 1); edge[3] = Math.max(edge[3] ?? 0, y + 1); };
  const measuredAt = new Float32Array(WIDTH * HEIGHT), diffs: number[] = [];
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    let measured = 0, predicted = 0;
    for (let k = 0; k < 3; k++) {
      const m = (shown.rgb[i * 3 + k] ?? 0) - (reference.rgb[i * 3 + k] ?? 0);
      if (m < 0) darker++;
      measured = Math.max(measured, m); predicted = Math.max(predicted, Math.min(255, added[i * 3 + k] ?? 0));
    }
    measuredAt[i] = measured;
    const x = i % WIDTH, y = Math.floor(i / WIDTH);
    if (measured === 0 && predicted === 0) continue;
    diffs.push(Math.abs(measured - predicted));
    measuredSum += measured; predictedSum += predicted; mp += measured * predicted; pp += predicted * predicted;
    centroid.measured[0] = (centroid.measured[0] ?? 0) + (x + 0.5) * measured; centroid.measured[1] = (centroid.measured[1] ?? 0) + (y + 0.5) * measured; centroid.measured[2] = (centroid.measured[2] ?? 0) + measured;
    centroid.predicted[0] = (centroid.predicted[0] ?? 0) + (x + 0.5) * predicted; centroid.predicted[1] = (centroid.predicted[1] ?? 0) + (y + 0.5) * predicted; centroid.predicted[2] = (centroid.predicted[2] ?? 0) + predicted;
    if (measured > 24) grow(edges.measured, x, y);
    if (predicted > 24) grow(edges.predicted, x, y);
  }
  const [pl = 0, pt = 0, pr = 0, pb = 0] = edges.predicted;
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    const x = i % WIDTH, y = Math.floor(i / WIDTH), m = measuredAt[i] ?? 0;
    if (m <= 0 || (x >= pl - 2 && x < pr + 2 && y >= pt - 2 && y < pb + 2)) continue;
    outsideLight += m;
    if (m > 24) outsideOver++;
  }
  const point = (c: number[]) => [(c[0] ?? 0) / (c[2] || 1), (c[1] ?? 0) / (c[2] || 1)] as const;
  const box = (edge: number[]) => Number.isFinite(edge[0]) ? edge as unknown as Box : undefined;
  const sorted = diffs.sort((a, b) => a - b);
  const [measuredBox, predictedBox] = [box(edges.measured), box(edges.predicted)];
  return {
    phase, sum: { measured: measuredSum, predicted: predictedSum }, gain: pp === 0 ? 0 : mp / pp,
    centroid: { measured: point(centroid.measured), predicted: point(centroid.predicted) },
    box24: { ...(measuredBox === undefined ? {} : { measured: measuredBox }), ...(predictedBox === undefined ? {} : { predicted: predictedBox }) },
    outside: { light: outsideLight, over24: outsideOver }, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, darker,
  };
}

/** The reference a phase's light is measured against: the glow-free body for the glow-on body, else its camera's hidden grab. */
export function referenceOf(phase: string): string {
  if (phase.startsWith("on-")) return phase.replace("on-", "off-");
  const angle = /^twin-(a\d+|c1)$/.exec(phase)?.[1];
  return angle === undefined ? "hidden-s-1" : `hidden-${angle}-1`;
}

if (import.meta.main) {
  const [captures, oracles] = process.argv.slice(2);
  if (captures === undefined || oracles === undefined) throw new Error("usage: bun test/glow6e/read.ts CAPTURE_DIR ORACLE_DIR");
  const image = (name: string) => decodeImage(new Uint8Array(readFileSync(join(captures, `${name}.ppm`))));
  const still = PHASES.filter((phase) => phase.name.startsWith("hidden") && existsSync(join(captures, `${phase.name}-2.ppm`))).map((phase) => ({ phase: phase.name, ...stillness(image(`${phase.name}-1`), image(`${phase.name}-2`)) }));
  const readings = PHASES.filter((phase) => !phase.name.startsWith("hidden") && !phase.name.startsWith("off-") && existsSync(join(captures, `${phase.name}.ppm`))).map((phase) => {
    const bytes = readFileSync(join(oracles, `${phase.name}.f32`));
    return readPhase(phase.name, new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), image(phase.name), image(referenceOf(phase.name)));
  });
  console.log(JSON.stringify({ stillness: still, readings }, null, 1));
}
