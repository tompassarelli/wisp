








import { floorDiv, floorMod } from "../../src/sim/intMath";

export const RULER = "war3mapImported\\Wisp58Ruler.mdx";

export const CLIP = "war3mapImported\\Wisp58Clip.mdx";
export const MARK = "war3mapImported\\Wisp58Mark.mdx";
export const BOARD = "war3mapImported\\Wisp58Board.mdx";

export const RULER_UNIT = 0x68303538;


export type NeedleKey = readonly [offset: number, dx: number];

export interface RulerSequence {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly looping: boolean;

  readonly lane: number;
  readonly keys: readonly NeedleKey[];
}

const linear = (length: number, dx = length): readonly NeedleKey[] => [[0, 0], [length, dx]];


export const RULER_SEQUENCES: readonly RulerSequence[] = [
  { name: "Stand Hit", start: 1000, end: 2000, looping: true, lane: 12, keys: linear(1000) },
  { name: "Stand", start: 3000, end: 4000, looping: true, lane: 24, keys: linear(1000) },

  { name: "Walk", start: 5000, end: 6002, looping: true, lane: 36, keys: linear(1002) },
  { name: "Birth", start: 7000, end: 7500, looping: false, lane: 48, keys: linear(500) },

  { name: "Attack", start: 8000, end: 9000, looping: false, lane: 60, keys: [[0, 0], [999, 999], [1000, 1100]] },

  { name: "Spell", start: 10000, end: 15000, looping: false, lane: 72, keys: linear(5000, 1000) },

  { name: "Death", start: 16000, end: 46000, looping: false, lane: 84, keys: linear(30000, 1000) },
];

export const RULER_DEATH_SECONDS = 30;


export const CLIP_SEQUENCES: readonly RulerSequence[] = [
  { name: "Stand", start: 80435, end: 81435, looping: false, lane: 24, keys: [[0, 0], [300, 300], [500, 500], [600, 600], [1000, 1000]] },
];


export const GLOBAL_LENGTH = 2000;

export const CLOCK_DX = 40;
export const CLOCK_DY = -15;





export const ORIGIN_DY = -35;
export const ORIGIN_HALF = 10;

export const MARK_DY = -60;

export const RULER_LENGTH = 1000;


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






  readonly timing: number;
  readonly issue: 58 | 59;
}

const COLUMNS = [-1750, -550, 650];
const ROWS = 10;
const ROW_TOP = 500;
const ROW_PITCH = 160;
const UNTIMED = 2000;

const NAMES: readonly (readonly [name: string, timing: number, issue: 58 | 59])[] = [
  ["unit-stand", 0, 58], ["unit-stand-hit", 0, 58], ["birth-during", 35, 58], ["birth-after", 35, 58], ["global-frozen", 0, 58],
  ["global-kept", 35, 58], ["index-out-of-range", 0, 58], ["clip-shown", 0, 58], ["clip-second-seek", 0, 58], ["select-freeze-seek", 35, 58],
  ["freeze-then-select-seek", 35, 58], ["loop-played", 35, 58], ["loop-reference", 35, 58], ["nonloop-held", 35, 58],
  ["loop-seek-past-end", 35, 58], ["nonloop-seek-past-end", 35, 58],
  ["blend-150", 50, 58], ["blend-0", 35, 58], ["blend-switch-frozen", 35, 58], ["timescale-then-select", 35, 58],
  ["death-reference", UNTIMED, 59], ["death-at-0", UNTIMED, 59], ["death-at-1", UNTIMED, 59], ["death-at-2", UNTIMED, 59],
  ["death-frozen", 35, 59], ["no-death-frozen", 0, 59], ["teardown-hidden", 0, 59],
  ["matrix-scale-once", 70, 59], ["matrix-scale-twice", 70, 59], ["matrix-scale-reset", 70, 59],
];
export const SLOTS: readonly Slot[] = NAMES.map(([name, timing, issue], index) => {
  const column = floorDiv(index, ROWS);
  return { name, x: COLUMNS[column] ?? 0, y: ROW_TOP - ROW_PITCH * floorMod(index, ROWS), timing, issue };
});

export const BOARD_EXTENT = { low: [(COLUMNS[0] ?? 0) - 80, ROW_TOP - ROW_PITCH * (ROWS - 1) + MARK_DY - 20], high: [(COLUMNS[2] ?? 0) + 1180, ROW_TOP + 110] } as const;





export const ORIENTATION_MARK: readonly [number, number] = [(COLUMNS[0] ?? 0) - 60, ROW_TOP + MARK_DY];

export function slotNamed(name: string): Slot {
  for (const slot of SLOTS) if (slot.name === name) return slot;
  throw new Error(`no ruler named ${name}`);
}






export const CAMERA = { x: 0, y: 20, distance: 2700, fieldOfView: 70 };





export const START_SECONDS = 3;

export const DEATH_SECONDS = 5.25;

export const READY_SECONDS = 8;

export const CAPTURE_FRAME = (START_SECONDS + READY_SECONDS + 1) * 60;
