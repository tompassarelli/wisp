// Frame probes: does a captured client frame show what the game expects? A
// game declares features, such as its stage in a band of the screen, as pixel
// measurements. A probe keeps the frame on disk as a PPM image and decides by
// those measurements, never by looking at the picture. Plain functions, so a
// game's tests can measure frames without Effect; playerView.ts reads and
// writes frame files.
import type { SceneProblem } from "./scene";

/** Raw 8-bit RGB pixels, row by row. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

/** Part of a frame as fractions of its width and height, so one declaration fits any capture size. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export type Color = readonly [red: number, green: number, blue: number];

const PPM_HEADER = /^P6\s+(\d+)\s+(\d+)\s+255\s/;

/** A binary 8-bit PPM image, as grim and ffmpeg write it; undefined for anything else. */
export function decodePpm(bytes: Uint8Array): Frame | undefined {
  const header = PPM_HEADER.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 32)));
  if (header === null) return undefined;
  const width = Number(header[1]);
  const height = Number(header[2]);
  const rgb = bytes.subarray(header[0].length);
  return rgb.length < width * height * 3 ? undefined : { width, height, rgb };
}

export function encodePpm({ width, height, rgb }: Frame): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  const bytes = new Uint8Array(header.length + width * height * 3);
  bytes.set(header);
  bytes.set(rgb.subarray(0, width * height * 3), header.length);
  return bytes;
}

const span = (from: number, to: number, size: number) => [Math.max(0, Math.floor(from * size)), Math.min(size, Math.floor(to * size))] as const;

/**
 * Rows of `band` holding an unbroken horizontal run of `colors`, each channel
 * within `tolerance`, at least `run` of the frame's width long. Gaps of up to
 * two pixels, such as antialiased edges, don't break a run.
 */
export function colorRows(frame: Frame, band: Band, colors: readonly Color[], tolerance: number, run: number): number {
  const [top, bottom] = span(band.top, band.bottom, frame.height);
  const [left, right] = span(band.left, band.right, frame.width);
  const needed = run * frame.width;
  const { rgb, width } = frame;
  let rows = 0;
  for (let y = top; y < bottom; y++) {
    let length = 0;
    let gap = 0;
    for (let x = left; x < right && length < needed; x++) {
      const i = (y * width + x) * 3;
      const red = rgb[i] ?? 0;
      const green = rgb[i + 1] ?? 0;
      const blue = rgb[i + 2] ?? 0;
      const matches = colors.some(([r, g, b]) => Math.abs(red - r) <= tolerance && Math.abs(green - g) <= tolerance && Math.abs(blue - b) <= tolerance);
      if (matches) {
        length += 1 + gap;
        gap = 0;
      } else if (length > 0 && gap < 2) gap++;
      else {
        length = 0;
        gap = 0;
      }
    }
    if (length >= needed) rows++;
  }
  return rows;
}

/** The share of the band's pixels `accept` takes, from 0 to 1. */
export function pixelShare(frame: Frame, band: Band, accept: (red: number, green: number, blue: number) => boolean): number {
  const [top, bottom] = span(band.top, band.bottom, frame.height);
  const [left, right] = span(band.left, band.right, frame.width);
  let accepted = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const i = (y * frame.width + x) * 3;
      if (accept(frame.rgb[i] ?? 0, frame.rgb[i + 1] ?? 0, frame.rgb[i + 2] ?? 0)) accepted++;
    }
  }
  const pixels = (bottom - top) * (right - left);
  return pixels === 0 ? 0 : accepted / pixels;
}

export interface FeatureMeasurement {
  readonly present: boolean;
  /** The measurement and the threshold it was held to. */
  readonly measured: string;
}

/** Something a player must be able to see in a frame. */
export interface FrameFeature {
  /** What is measured, such as "stage in the stage band". */
  readonly name: string;
  /** What a player sees when it is absent. */
  readonly absent: string;
  readonly measure: (frame: Frame) => FeatureMeasurement;
}

export interface FeatureResult extends FeatureMeasurement {
  readonly feature: FrameFeature;
}

export const measureFrame = (frame: Frame, features: readonly FrameFeature[]): readonly FeatureResult[] =>
  features.map((feature) => ({ feature, ...feature.measure(frame) }));

/** The absent features, as problems a player would see. */
export const frameProblems = (results: readonly FeatureResult[]): readonly SceneProblem[] =>
  results.filter(({ present }) => !present).map(({ feature, measured }) => ({ seen: feature.absent, evidence: `${feature.name}: ${measured}` }));
