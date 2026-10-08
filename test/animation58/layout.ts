// The ruler fixture's scene, shared by the map, the headless rows, the model
// files and the screenshot reader. Every case is a ruler: a model whose
// needle shows, seen from above, which sequence it samples (the needle's
// lane, Y) and at which frame (its offset, X); a second marker shows the
// global sequence's frame. Model units are world units at scale 1. The first
// two columns are wisp#58's animation playback cases, the third wisp#59's
// effect lifetime and matrix scale cases.

import { floorDiv, floorMod } from "../../src/sim/intMath";

export const RULER = "war3mapImported\\Wisp58Ruler.mdx";
/** One non-looping Stand sequence at Blademaster clip 48's interval, as Smashcraft's pool clips are. */
export const CLIP = "war3mapImported\\Wisp58Clip.mdx";
export const MARK = "war3mapImported\\Wisp58Mark.mdx";
export const BOARD = "war3mapImported\\Wisp58Board.mdx";
/** 'h058', a footman whose model is the ruler. */
export const RULER_UNIT = 0x68303538;

/** A needle key: milliseconds into the sequence and the needle's X offset there. */
export type NeedleKey = readonly [offset: number, dx: number];

export interface RulerSequence {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly looping: boolean;
  /** The needle's Y offset while this sequence plays. */
  readonly lane: number;
  readonly keys: readonly NeedleKey[];
}

const linear = (length: number, dx = length): readonly NeedleKey[] => [[0, 0], [length, dx]];

/** `Stand Hit` comes before `Stand`, so selecting "stand" by the first name containing it would pick the wrong one. */
export const RULER_SEQUENCES: readonly RulerSequence[] = [
  { name: "Stand Hit", start: 1000, end: 2000, looping: true, lane: 12, keys: linear(1000) },
  { name: "Stand", start: 3000, end: 4000, looping: true, lane: 24, keys: linear(1000) },
  // 1002 ms: at 60 frames a second a loop that drops its overshoot loses about 15 ms a lap.
  { name: "Walk", start: 5000, end: 6002, looping: true, lane: 36, keys: linear(1002) },
  { name: "Birth", start: 7000, end: 7500, looping: false, lane: 48, keys: linear(500) },
  // The needle jumps 100 in the last millisecond, so a hold at the end − 1 ms and one at the end differ.
  { name: "Attack", start: 8000, end: 9000, looping: false, lane: 60, keys: [[0, 0], [999, 999], [1000, 1100]] },
  // The loops' reference clock: five seconds over the same 1000 units.
  { name: "Spell", start: 10000, end: 15000, looping: false, lane: 72, keys: linear(5000, 1000) },
  // Long enough to still play whenever the capture is taken, slow enough to need no exact capture time.
  { name: "Death", start: 16000, end: 46000, looping: false, lane: 84, keys: linear(30000, 1000) },
];
/** The ruler's Death sequence in seconds, for headless clients that keep destroyed effects drawn. */
export const RULER_DEATH_SECONDS = 30;

/** Blademaster clip 48's interval and key times; like the clip, no Death sequence. */
export const CLIP_SEQUENCES: readonly RulerSequence[] = [
  { name: "Stand", start: 80435, end: 81435, looping: false, lane: 24, keys: [[0, 0], [300, 300], [500, 500], [600, 600], [1000, 1000]] },
];

/** The global sequence's length; its marker moves half a unit per millisecond. */
export const GLOBAL_LENGTH = 2000;
/** Where the global marker and the calibration marks sit below a ruler's origin. */
export const CLOCK_DY = -20;
export const MARK_DY = -40;
/** A ruler's length: its end mark's X offset. */
export const RULER_LENGTH = 1000;

/** The needle's X offset at `offset` milliseconds into a sequence, between its keys. */
export function needleDx(keys: readonly NeedleKey[], offset: number): number {
  let previous: NeedleKey | undefined;
  for (const key of keys) {
    if (offset <= key[0]) {
      if (previous === undefined) return key[1];
      return previous[1] + (key[1] - previous[1]) * (offset - previous[0]) / (key[0] - previous[0]);
    }
    previous = key;
  }
  return previous === undefined ? 0 : previous[1];
}

export interface Slot {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /**
   * How far a native reading of the needle's and global marker's X may
   * stray: 0 for frozen clocks, more where a clock ran. Death keeps running
   * until the capture, whenever it is taken, so those rulers are read against
   * each other instead.
   */
  readonly timing: number;
  readonly issue: 58 | 59;
}

const COLUMNS = [-1700, -550, 600];
const ROWS = 9;
const ROW_TOP = 500;
const ROW_PITCH = 120;
const UNTIMED = 2000;
/** One ruler per case, in reading order: each column top to bottom. */
const NAMES: readonly (readonly [name: string, timing: number, issue: 58 | 59])[] = [
  ["unit-stand", 0, 58], ["unit-stand-hit", 0, 58], ["birth-during", 35, 58], ["birth-after", 35, 58], ["global-frozen", 0, 58],
  ["global-kept", 35, 58], ["index-out-of-range", 0, 58], ["clip-shown", 0, 58], ["clip-second-seek", 0, 58],
  ["loop-played", 35, 58], ["loop-reference", 35, 58], ["nonloop-held", 35, 58], ["loop-seek-past-end", 0, 58], ["nonloop-seek-past-end", 0, 58],
  ["blend-150", 50, 58], ["blend-0", 35, 58], ["blend-switch-frozen", 35, 58], ["timescale-then-select", 35, 58],
  ["death-frozen", 0, 59], ["no-death-frozen", 0, 59], ["death-playing", UNTIMED, 59], ["death-reference", UNTIMED, 59],
  ["teardown-hidden", 0, 59], ["matrix-scale-once", 0, 59], ["matrix-scale-twice", 0, 59], ["matrix-scale-reset", 0, 59],
];
export const SLOTS: readonly Slot[] = NAMES.map(([name, timing, issue], index) => {
  const column = floorDiv(index, ROWS);
  return { name, x: COLUMNS[column] ?? 0, y: ROW_TOP - ROW_PITCH * floorMod(index, ROWS), timing, issue };
});

/**
 * A mark left of the first ruler's zero mark. The rulers' marks look the same
 * turned half around, so this one tells which way up the capture is.
 */
export const ORIENTATION_MARK: readonly [number, number] = [(COLUMNS[0] ?? 0) - 60, ROW_TOP + MARK_DY];

export function slotNamed(name: string): Slot {
  for (const slot of SLOTS) if (slot.name === name) return slot;
  throw new Error(`no ruler named ${name}`);
}

/** The top-down camera every client uses; the reader needs only the marks, not these numbers. */
export const CAMERA = { x: 0, y: 40, distance: 2700, fieldOfView: 70 };
/** Game seconds after which every case is frozen and the scene can be captured. */
export const READY_SECONDS = 6;
/** The headless frame the rows are read on, a second after READY_SECONDS. */
export const CAPTURE_FRAME = (READY_SECONDS + 1) * 60;
