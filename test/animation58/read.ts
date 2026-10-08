// Reads a capture of the #58 animation fixture into the rows of expected.ts:
// `bun test/animation58/read.ts SCREENSHOT.png`. The yellow marks under each
// ruler give its zero and its 1000-unit end, so the reading holds for any
// camera scale, rotation or mirroring; the red patches are the needles, the
// global markers and each ruler's larger origin square, which the other two
// are measured from.
import { inflateSync } from "node:zlib";
import * as BunRuntime from "@effect/platform-bun/BunRuntime";
import { Console, Effect, Schema } from "effect";
import { EXPECTED, EXPECTED_FILE } from "./expected";
import { CLOCK_DX, CLOCK_DY, DEATH_SECONDS, GLOBAL_LENGTH, MARK_DY, ORIENTATION_MARK, ORIGIN_DY, READY_SECONDS, RULER_LENGTH, SLOTS, type Slot } from "./layout";

class ReadFailure extends Schema.TaggedError<ReadFailure>()("ReadFailure", { problem: Schema.String }) {
  override get message(): string { return this.problem; }
}

interface Image { readonly width: number; readonly height: number; readonly rgb: Uint8Array }

/** An 8-bit, non-interlaced RGB or RGBA PNG, as screenshots and the headless renderer write them. */
export function decodePng(bytes: Uint8Array): Image {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, channels = 0;
  const data: Uint8Array[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const [depth, color, , , interlace] = body.subarray(8, 13);
      channels = color === 2 ? 3 : color === 6 ? 4 : 0;
      if (depth !== 8 || channels === 0 || interlace !== 0) throw new Error(`unsupported PNG: depth ${depth}, color type ${color}, interlace ${interlace}`);
    } else if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? pixels[y * stride + x - channels] ?? 0 : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] ?? 0 : 0;
      const corner = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] ?? 0 : 0;
      const p = left + up - corner;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter] ?? 0;
      pixels[y * stride + x] = (value + predicted) & 255;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index++) rgb.set(pixels.subarray(index * channels, index * channels + 3), index * 3);
  return { width, height, rgb };
}

interface Blob { readonly x: number; readonly y: number; readonly size: number }

/** Connected patches of pixels of one color, with their centroids. */
export function blobs(image: Image, matches: (r: number, g: number, b: number) => boolean): Blob[] {
  const { width, height, rgb } = image;
  const seen = new Uint8Array(width * height);
  const found: Blob[] = [];
  const hit = (index: number) => matches(rgb[index * 3] ?? 0, rgb[index * 3 + 1] ?? 0, rgb[index * 3 + 2] ?? 0);
  for (let start = 0; start < width * height; start++) {
    if (seen[start] === 1 || !hit(start)) continue;
    let size = 0, sumX = 0, sumY = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      const x = index % width, y = Math.floor(index / width);
      size++; sumX += x; sumY += y;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (seen[next] === 1 || !hit(next)) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (size >= 3) found.push({ x: sumX / size + 0.5, y: sumY / size + 0.5, size });
  }
  return found;
}

export const isRed = (r: number, g: number, b: number) => r >= 150 && g <= 90 && b <= 90 && r - g >= 100;
export const isYellow = (r: number, g: number, b: number) => r >= 150 && g >= 150 && b <= 110 && Math.abs(r - g) <= 70;

/** World X and Y to pixels: px = a·X + b·Y + c, py = d·X + e·Y + f. */
type Affine = readonly [number, number, number, number, number, number];
const apply = (m: Affine, x: number, y: number): [number, number] => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];

function marks(): [number, number][] {
  return [[...ORIENTATION_MARK], ...SLOTS.flatMap((slot) => [[slot.x, slot.y + MARK_DY], [slot.x + RULER_LENGTH, slot.y + MARK_DY]] as [number, number][])];
}

function nearest(found: readonly Blob[], x: number, y: number, within: number): Blob | undefined {
  let best: Blob | undefined;
  let distance = within;
  for (const blob of found) {
    const d = Math.hypot(blob.x - x, blob.y - y);
    if (d <= distance) { best = blob; distance = d; }
  }
  return best;
}

/** Least-squares affine map from world points to pixels. */
function fit(pairs: readonly (readonly [number, number, Blob])[]): Affine {
  // Normal equations for [X Y 1] → px and → py.
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const px = [0, 0, 0], py = [0, 0, 0];
  for (const [x, y, blob] of pairs) {
    const row = [x, y, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) (m[i] as number[])[j] = (m[i]?.[j] ?? 0) + (row[i] ?? 0) * (row[j] ?? 0);
      px[i] = (px[i] ?? 0) + (row[i] ?? 0) * blob.x;
      py[i] = (py[i] ?? 0) + (row[i] ?? 0) * blob.y;
    }
  }
  const solve = (rhs: number[]): number[] => {
    const a = m.map((row, i) => [...row, rhs[i] ?? 0]);
    for (let col = 0; col < 3; col++) {
      const pivot = a.reduce((best, row, i) => (i >= col && Math.abs(row[col] ?? 0) > Math.abs(a[best]?.[col] ?? 0) ? i : best), col);
      [a[col], a[pivot]] = [a[pivot] ?? [], a[col] ?? []];
      for (let i = 0; i < 3; i++) {
        if (i === col) continue;
        const factor = (a[i]?.[col] ?? 0) / (a[col]?.[col] ?? 1);
        for (let j = col; j < 4; j++) (a[i] as number[])[j] = (a[i]?.[j] ?? 0) - factor * (a[col]?.[j] ?? 0);
      }
    }
    return a.map((row, i) => (row[3] ?? 0) / (row[i] ?? 1));
  };
  const [a, b, c] = solve(px);
  const [d, e, f] = solve(py);
  return [a ?? 0, b ?? 0, c ?? 0, d ?? 0, e ?? 0, f ?? 0];
}

/**
 * Finds the marks: tries the eight axis-aligned ways the layout can lie on
 * screen, scaled to the yellow patches' extent, keeps the one that matches
 * most marks, and refines it by least squares.
 */
export function calibrate(yellow: readonly Blob[]): { affine: Affine; matched: number } {
  const world = marks();
  const span = (values: readonly number[]) => [Math.min(...values), Math.max(...values)] as const;
  const [wx0, wx1] = span(world.map(([x]) => x));
  const [wy0, wy1] = span(world.map(([, y]) => y));
  const [px0, px1] = span(yellow.map((blob) => blob.x));
  const [py0, py1] = span(yellow.map((blob) => blob.y));
  let best: { affine: Affine; pairs: [number, number, Blob][] } | undefined;
  for (const swap of [false, true]) for (const flipX of [false, true]) for (const flipY of [false, true]) {
    const [ux0, ux1] = swap ? [wy0, wy1] : [wx0, wx1];
    const [uy0, uy1] = swap ? [wx0, wx1] : [wy0, wy1];
    const sx = (px1 - px0) / (ux1 - ux0) * (flipX ? -1 : 1);
    const sy = (py1 - py0) / (uy1 - uy0) * (flipY ? 1 : -1);
    const ox = flipX ? px0 - sx * ux1 : px0 - sx * ux0;
    const oy = flipY ? py0 - sy * uy0 : py0 - sy * uy1;
    const affine: Affine = swap ? [0, sx, ox, sy, 0, oy] : [sx, 0, ox, 0, sy, oy];
    const pairs: [number, number, Blob][] = [];
    for (const [x, y] of world) {
      const [px, py] = apply(affine, x, y);
      const blob = nearest(yellow, px, py, 12);
      if (blob !== undefined) pairs.push([x, y, blob]);
    }
    if (best === undefined || pairs.length > best.pairs.length) best = { affine, pairs };
  }
  if (best === undefined || best.pairs.length < 6) return { affine: [1, 0, 0, 0, 1, 0], matched: best?.pairs.length ?? 0 };
  const affine = fit(best.pairs);
  const pairs = world.flatMap(([x, y]) => {
    const [px, py] = apply(affine, x, y);
    const blob = nearest(yellow, px, py, 6);
    return blob === undefined ? [] : [[x, y, blob] as [number, number, Blob]];
  });
  return { affine: pairs.length >= 6 ? fit(pairs) : affine, matched: pairs.length };
}

export interface Reading {
  readonly slot: Slot;
  readonly dx: number;
  readonly dy: number;
  readonly gx: number;
  /** Where the origin square was drawn, from where the ruler's slot puts it. */
  readonly offset: readonly [number, number];
}

/**
 * Each ruler's needle and global marker in world units from its drawn origin
 * square, measured along the line through its own two marks.
 */
export function readRulers(image: Image): { readings: (Reading | string)[]; matched: number } {
  const yellow = blobs(image, isYellow);
  const red = blobs(image, isRed);
  const { affine, matched } = calibrate(yellow);
  const readings = SLOTS.map((slot): Reading | string => {
    const [zx, zy] = apply(affine, slot.x, slot.y + MARK_DY);
    const [ex, ey] = apply(affine, slot.x + RULER_LENGTH, slot.y + MARK_DY);
    const zero = nearest(yellow, zx, zy, 6);
    const end = nearest(yellow, ex, ey, 6);
    if (zero === undefined || end === undefined) return `${slot.name}=no marks`;
    // Along the ruler from its marks; across it, the global fit's world Y direction.
    const u = [(end.x - zero.x) / RULER_LENGTH, (end.y - zero.y) / RULER_LENGTH];
    const v = [affine[1], affine[4]];
    const local = (blob: Blob): [number, number, number] => {
      const px = blob.x - zero.x, py = blob.y - zero.y;
      const det = (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0);
      return [(px * (v[1] ?? 0) - py * (v[0] ?? 0)) / det, ((u[0] ?? 0) * py - (u[1] ?? 0) * px) / det + MARK_DY, blob.size];
    };
    // The next column starts 1200 along and the next row 160 across; the row below's top lane sits 76 under this origin.
    const own = red.map(local).filter(([x, y]) => x >= -60 && x <= RULER_LENGTH + 150 && y >= -70 && y <= 98);
    if (own.length === 0) return `${slot.name}=gone`;
    let origin: [number, number, number] | undefined;
    for (const blob of own) {
      if (Math.hypot(blob[0], blob[1] - ORIGIN_DY) <= 45 && (origin === undefined || blob[2] > origin[2])) origin = blob;
    }
    if (origin === undefined) return `${slot.name}=no origin`;
    let needle: [number, number, number] | undefined;
    let clock: [number, number, number] | undefined;
    for (const blob of own) {
      if (blob === origin) continue;
      const found: [number, number, number] = [blob[0] - origin[0], blob[1] - origin[1] + ORIGIN_DY, blob[2]];
      if (Math.abs(found[1] - CLOCK_DY) <= 7 && found[0] >= CLOCK_DX - 15) { if (clock === undefined || found[2] > clock[2]) clock = found; }
      else if (found[1] > CLOCK_DY + 7 && (needle === undefined || found[2] > needle[2])) needle = found;
    }
    if (needle === undefined || clock === undefined) return `${slot.name}=${needle === undefined ? "no needle" : "no global marker"}`;
    return { slot, dx: needle[0], dy: needle[1], gx: clock[0] - CLOCK_DX, offset: [origin[0], origin[1] - ORIGIN_DY] };
  });
  return { readings, matched };
}

const parse = (row: string) => (row.split("=")[1] ?? "").split(",").map(Number);

/**
 * Whether a reading matches its expected row: Y within 4 units (lanes are 12
 * apart), X within 6 units, plus the ruler's timing allowance where a clock
 * ran (half of it for the global marker, which moves half a unit a millisecond).
 */
export function compare(reading: Reading, effectGlobalPhase = 0): { row: string; matches: boolean } {
  const row = `${reading.slot.name}=${Math.round(reading.dx)},${Math.round(reading.dy)},${Math.round(reading.gx)}`;
  const expected = EXPECTED.find((line) => line.startsWith(`${reading.slot.name}=`)) ?? "";
  if (expected.endsWith("=gone")) return { row, matches: false };
  const [dx = Number.NaN, dy = Number.NaN, gx = Number.NaN] = parse(expected);
  // Warcraft's effects share a renderer-clock starting phase; units start at zero.
  // The frozen-in-creation effect measures that phase without spending animation time.
  const unit = EXPECTED_FILE.some((line) => line.startsWith(`${reading.slot.name}-at=`));
  const period = GLOBAL_LENGTH / 2;
  const delta = reading.gx - gx - (unit ? 0 : effectGlobalPhase);
  const globalDifference = ((delta + period / 2) % period + period) % period - period / 2;
  const matches = Math.abs(reading.dx - dx) <= 6 + reading.slot.timing && Math.abs(reading.dy - dy) <= 4 && Math.abs(globalDifference) <= 6 + reading.slot.timing / 2;
  return { row, matches };
}

const reading = (readings: readonly (Reading | string)[], name: string) =>
  readings.find((candidate): candidate is Reading => typeof candidate !== "string" && candidate.slot.name === name);

/** The loop's lost overshoot in ms: the reference clock's time, wrapped by Walk's 1002 ms, minus the loop's frame. */
function overshoot(readings: readonly (Reading | string)[]): number | undefined {
  const loop = reading(readings, "loop-played"), reference = reading(readings, "loop-reference");
  if (loop === undefined || reference === undefined) return undefined;
  const lost = (reference.dx * 5) % 1002 - loop.dx;
  return lost < -501 ? lost + 1002 : lost;
}

/** Death needles move a unit every 30 ms. */
const DEATH_MS = 30;

/** When the capture was taken, in seconds after the map wrote its rows: read from the ruler playing Death since DEATH_SECONDS. */
function captureMoment(readings: readonly (Reading | string)[]): number | undefined {
  const reference = reading(readings, "death-reference");
  return reference === undefined ? undefined : DEATH_SECONDS + reference.dx * DEATH_MS / 1000 - READY_SECONDS;
}

/**
 * For each ruler destroyed `after` seconds past DEATH_SECONDS: how much later
 * in ms its Death started than the reference's, or that it was gone and how
 * long after its destruction the capture was taken.
 */
function deathLags(readings: readonly (Reading | string)[]): string[] {
  const reference = reading(readings, "death-reference");
  return ([["death-at-0", 0], ["death-at-1", 1], ["death-at-2", 2]] as const).map(([name, after]) => {
    const dying = reading(readings, name);
    if (dying !== undefined && reference !== undefined) return `${name}-lag=${Math.round((reference.dx - dying.dx) * DEATH_MS - after * 1000)} ms (headless 0; finishing the Stand loop first gives 750)`;
    const since = reference === undefined ? undefined : reference.dx * DEATH_MS / 1000 - after;
    return `${name}-lag=${dying === undefined ? "gone" : "unread"}${since === undefined ? "" : `, ${since.toFixed(2)} s after DestroyEffect`}`;
  });
}

/** Rulers whose origin square was drawn more than 3 units from its slot, as `name dx,dy`. */
function offsets(readings: readonly (Reading | string)[]): string {
  const moved = readings.filter((candidate): candidate is Reading => typeof candidate !== "string" && Math.hypot(...candidate.offset) > 3);
  return moved.length === 0 ? "none" : moved.map((moved) => `${moved.slot.name} ${Math.round(moved.offset[0])},${Math.round(moved.offset[1])}`).join("; ");
}

const program = (path: string | undefined) => Effect.gen(function*() {
  if (path === undefined) return yield* new ReadFailure({ problem: "usage: bun test/animation58/read.ts SCREENSHOT.png" });
  const bytes = yield* Effect.tryPromise({ try: () => Bun.file(path).bytes(), catch: (cause) => new ReadFailure({ problem: `cannot read ${path}: ${String(cause)}` }) });
  const image = yield* Effect.try({ try: () => decodePng(bytes), catch: (cause) => new ReadFailure({ problem: `${path}: ${String(cause)}` }) });
  const { readings, matched } = readRulers(image);
  yield* Console.log(`marks matched: ${matched} of ${SLOTS.length * 2 + 1}`);
  const effectGlobalPhase = reading(readings, "global-frozen")?.gx ?? 0;
  yield* Console.log(`effect-global-start=${Math.round(effectGlobalPhase)} (global markers compared relative to the frozen creation reference)`);
  let matching = 0;
  let matchingAnimation = 0;
  for (const [index, result] of readings.entries()) {
    const expected = EXPECTED[index] ?? "";
    const { row, matches } = typeof result === "string" ? { row: result, matches: result === expected } : compare(result, effectGlobalPhase);
    if (matches) matching++;
    if (matches && SLOTS[index]?.issue === 58) matchingAnimation++;
    yield* Console.log(`${row}  ${matches ? "matches" : `differs from ${expected}`}`);
  }
  const lost = overshoot(readings);
  yield* Console.log(`loop-overshoot-lost=${lost === undefined ? "unread" : Math.round(lost)} ms (wrapping by the length loses 0, dropping each lap's overshoot at 60 frames a second 59)`);
  const moment = captureMoment(readings);
  yield* Console.log(`capture-moment=${moment === undefined ? "unread" : `${moment.toFixed(2)} s after ready`}`);
  for (const line of deathLags(readings)) yield* Console.log(line);
  yield* Console.log(`drawn-away=${offsets(readings)}`);
  yield* Console.log(`${matching} of ${SLOTS.length} rulers match the headless rows`);
  yield* Console.log(`animation #58: ${matchingAnimation} of ${SLOTS.filter((slot) => slot.issue === 58).length} rulers match`);
});

if (import.meta.main) BunRuntime.runMain(program(process.argv[2]));
