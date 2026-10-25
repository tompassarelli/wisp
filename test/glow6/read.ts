import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImage } from "../frames125/read";

interface Image { readonly width: number; readonly height: number; readonly rgb: Uint8Array }

interface OracleFile { readonly quad: "glow" | "twin"; readonly width: number; readonly height: number; readonly corners: readonly (readonly [number, number])[] }

const MARGIN = 64;
const RADIUS = 200;

const load = (path: string): Image => decodeImage(new Uint8Array(readFileSync(path)));

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

/** Pixels whose channels differ between two captures of the same still frame, and the largest difference. */
export function stillness(a: Image, b: Image): { readonly differing: number; readonly max: number } {
  let differing = 0, max = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    let worst = 0;
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs((a.rgb[i * 3 + k] ?? 0) - (b.rgb[i * 3 + k] ?? 0)));
    if (worst > 0) differing++;
    max = Math.max(max, worst);
  }
  return { differing, max };
}

interface Profile { readonly radius: number; readonly pixels: number; readonly measured: number; readonly predicted: number }

export interface QuadReading {
  readonly quad: "glow" | "twin";
  readonly region: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly channels: readonly { readonly channel: "r" | "g" | "b"; readonly max: number; readonly p95: number; readonly signedMean: number; readonly measuredPeak: number; readonly predictedPeak: number; readonly measuredSum: number; readonly predictedSum: number }[];
  readonly centroid: { readonly measured: readonly [number, number]; readonly predicted: readonly [number, number] };
  readonly darker: number;
  readonly gain: number;
  readonly halfMax: { readonly measured: number; readonly predicted: number };
  readonly reach: { readonly measured: number; readonly predicted: number };
  readonly box24: { readonly measured?: readonly number[]; readonly predicted?: readonly number[] };
  readonly profile: readonly Profile[];
}

type Region = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** One channel's level differences, peaks and sums of measured and predicted light. */
class ChannelTally {
  readonly diffs: number[] = [];
  signed = 0; measuredPeak = 0; predictedPeak = 0; measuredSum = 0; predictedSum = 0;
  add(measured: number, predicted: number): void {
    this.diffs.push(Math.abs(measured - predicted));
    this.signed += measured - predicted;
    this.measuredPeak = Math.max(this.measuredPeak, measured);
    this.predictedPeak = Math.max(this.predictedPeak, predicted);
    this.measuredSum += measured;
    this.predictedSum += predicted;
  }
  summary(channel: "r" | "g" | "b", count: number) {
    return { channel, max: this.diffs.reduce((a, b) => Math.max(a, b), 0), p95: percentile(this.diffs, 0.95), signedMean: this.signed / count, measuredPeak: this.measuredPeak, predictedPeak: this.predictedPeak, measuredSum: this.measuredSum, predictedSum: this.predictedSum };
  }
}

/** A light-weighted centroid. */
class Centroid {
  private x = 0; private y = 0; private weight = 0;
  add(x: number, y: number, light: number): void {
    if (light <= 0) return;
    this.x += (x + 0.5) * light; this.y += (y + 0.5) * light; this.weight += light;
  }
  get point(): readonly [number, number] { return this.weight === 0 ? [0, 0] : [this.x / this.weight, this.y / this.weight]; }
}

/** The pixel box of every pixel added to it. */
class PixelBox {
  private edges = [Infinity, Infinity, -Infinity, -Infinity];
  add(x: number, y: number): void {
    const [left = 0, top = 0, right = 0, bottom = 0] = this.edges;
    this.edges = [Math.min(left, x), Math.min(top, y), Math.max(right, x + 1), Math.max(bottom, y + 1)];
  }
  get box(): readonly number[] | undefined { return Number.isFinite(this.edges[0]) ? this.edges : undefined; }
}

/** The profile channel's light: least-squares gain, centroids and 1 px rings about (cx, cy). */
class ProfileTally {
  private mp = 0; private pp = 0;
  readonly measured = new Centroid();
  readonly predicted = new Centroid();
  private readonly bins = Array.from({ length: RADIUS + 1 }, () => ({ pixels: 0, measured: 0, predicted: 0 }));
  constructor(private readonly cx: number, private readonly cy: number) {}
  add(x: number, y: number, measured: number, predicted: number): void {
    this.mp += measured * predicted; this.pp += predicted * predicted;
    this.measured.add(x, y, measured);
    this.predicted.add(x, y, predicted);
    const bin = this.bins[Math.round(Math.hypot(x + 0.5 - this.cx, y + 0.5 - this.cy))];
    if (bin !== undefined) { bin.pixels++; bin.measured += measured; bin.predicted += predicted; }
  }
  get gain(): number { return this.pp === 0 ? 0 : this.mp / this.pp; }
  get profile(): Profile[] {
    return this.bins.map((bin, radius) => ({ radius, pixels: bin.pixels, measured: bin.pixels === 0 ? 0 : bin.measured / bin.pixels, predicted: bin.pixels === 0 ? 0 : bin.predicted / bin.pixels }));
  }
}

/** The largest ring radius whose mean light still reaches `level` of the profile's peak. */
function falls(profile: readonly Profile[], key: "measured" | "predicted", level: (peak: number) => number): number {
  const peak = profile.reduce((best, row) => Math.max(best, row[key]), 0);
  return profile.findLast((row) => row[key] >= level(peak))?.radius ?? 0;
}

function regionOf(oracle: OracleFile): Region {
  const xs = oracle.corners.map(([x]) => x), ys = oracle.corners.map(([, y]) => y);
  return { left: Math.max(0, Math.floor(Math.min(...xs)) - MARGIN), top: Math.max(0, Math.floor(Math.min(...ys)) - MARGIN), right: Math.min(oracle.width - 1, Math.ceil(Math.max(...xs)) + MARGIN), bottom: Math.min(oracle.height - 1, Math.ceil(Math.max(...ys)) + MARGIN) };
}

/**
 * Shown minus hidden against the oracle's added light, over the quad's projected square plus a 64 px margin: per channel the
 * largest and 95th-percentile level difference, the least-squares gain of measured over predicted on the profile channel,
 * the radius where each profile falls to half its peak and to 2 levels, and the 1 px radial profile about the quad's centre.
 */
export function readQuad(oracle: OracleFile, added: Float32Array, shown: Image, hidden: Image): QuadReading {
  const region = regionOf(oracle);
  const centre = oracle.corners.reduce(([sx, sy], [x, y]) => [sx + x / oracle.corners.length, sy + y / oracle.corners.length], [0, 0]);
  const main = oracle.quad === "glow" ? 0 : 1;
  const channels = [new ChannelTally(), new ChannelTally(), new ChannelTally()];
  const light = new ProfileTally(centre[0] ?? 0, centre[1] ?? 0);
  const boxes = { measured: new PixelBox(), predicted: new PixelBox() };
  let darker = 0;
  for (let y = region.top; y <= region.bottom; y++) for (let x = region.left; x <= region.right; x++) {
    const i = y * oracle.width + x;
    let measuredMax = 0, predictedMax = 0;
    channels.forEach((tally, k) => {
      const measured = (shown.rgb[i * 3 + k] ?? 0) - (hidden.rgb[i * 3 + k] ?? 0), predicted = added[i * 3 + k] ?? 0;
      if (measured < 0) darker++;
      tally.add(measured, predicted);
      measuredMax = Math.max(measuredMax, measured);
      predictedMax = Math.max(predictedMax, predicted);
      if (k === main) light.add(x, y, measured, predicted);
    });
    if (measuredMax > 24) boxes.measured.add(x, y);
    if (predictedMax > 24) boxes.predicted.add(x, y);
  }
  const profile = light.profile;
  const count = (region.right - region.left + 1) * (region.bottom - region.top + 1);
  const [measuredBox, predictedBox] = [boxes.measured.box, boxes.predicted.box];
  return {
    quad: oracle.quad, region,
    channels: (["r", "g", "b"] as const).map((channel, k) => (channels[k] ?? new ChannelTally()).summary(channel, count)),
    centroid: { measured: light.measured.point, predicted: light.predicted.point },
    darker, gain: light.gain,
    halfMax: { measured: falls(profile, "measured", (peak) => peak / 2), predicted: falls(profile, "predicted", (peak) => peak / 2) },
    reach: { measured: falls(profile, "measured", () => 2), predicted: falls(profile, "predicted", () => 2) },
    box24: { ...(measuredBox === undefined ? {} : { measured: measuredBox }), ...(predictedBox === undefined ? {} : { predicted: predictedBox }) },
    profile,
  };
}

if (import.meta.main) {
  const [captures, oracles] = process.argv.slice(2);
  if (captures === undefined || oracles === undefined) throw new Error("usage: bun test/glow6/read.ts CAPTURE_DIR ORACLE_DIR (glow, twin, hidden-1 and hidden-2 .ppm or .png; glow and twin .json and .f32)");
  const image = (name: string) => load(join(captures, `${name}.ppm`));
  const hidden = image("hidden-1");
  const still = stillness(hidden, image("hidden-2"));
  const readings = (["glow", "twin"] as const).map((quad) => {
    const oracle = JSON.parse(readFileSync(join(oracles, `${quad}.json`), "utf8")) as OracleFile;
    const bytes = readFileSync(join(oracles, `${quad}.f32`));
    return readQuad(oracle, new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), image(quad), hidden);
  });
  console.log(JSON.stringify({ stillness: still, readings }, null, 1));
}
