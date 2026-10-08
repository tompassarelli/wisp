import { f32 } from "../../src/sim/f32";
import { floorDiv, floorMod } from "../../src/sim/intMath";

export const UNIT_TYPE = 0x68666f6f;
/** Crow Form, added and removed so a ground unit's flying height can change. */
const CROW_FORM = 0x416d7266;
/** Locust: no selection, no collision. */
const LOCUST = 0x416c6f63;
/** A stock model every Warcraft install has; headless never loads it. */
const PROBE_MODEL = "Abilities\\Spells\\Other\\Silence\\SilenceTarget.mdx";

export const UNIT_MOTION_NOOPS = {
  SetUnitPathing: "the fixture's bodies mirror Smashcraft's, which turn off pathing; headless has no pathing to turn off",
  PauseUnit: "the fixture's bodies mirror Smashcraft's paused bodies; headless runs no unit AI",
};

/** Facings written with BlzSetUnitFacingEx and read straight back, each labeled with its source value. */
const FACINGS: readonly (readonly [string, number])[] = [
  ["0", 0], ["0.1", f32(0.1)], ["1/3", f32(1 / 3)], ["0.5", 0.5], ["1", 1], ["30", 30], ["45", 45], ["57.29578", f32(57.29578)],
  ["60", 60], ["90", 90], ["100.25", 100.25], ["135", 135], ["179.9", f32(179.9)], ["180", 180], ["180.1", f32(180.1)],
  ["225", 225], ["270", 270], ["315", 315], ["359.9", f32(359.9)], ["359.99", f32(359.99)], ["360", 360], ["360.5", 360.5],
  ["450", 450], ["540", 540], ["720", 720], ["720.5", 720.5], ["1080", 1080], ["3600", 3600], ["36000", 36000],
  ["-0.001", f32(-0.001)], ["-90", -90], ["-180", -180], ["-360", -360], ["-720", -720], ["-3600", -3600],
];
/** Facings passed to CreateUnit and read straight back. */
const CREATED_FACINGS: readonly (readonly [string, number])[] = [
  ["0", 0], ["0.1", f32(0.1)], ["90", 90], ["179.9", f32(179.9)], ["180", 180], ["360", 360], ["720.5", 720.5], ["-90", -90],
];

const TICK = f32(1 / 60);
/** Ticks the dashing body is held still before and after the dash. */
const DASH_REST_TICKS = 30;
const DASH_TICKS = 30;
/** 1200 units a second, past a footman's move speed of 270. */
const DASH_STEP = 20;
const DASH_START = -300;
/** Behind by more than this many ticks of travel is lag, not the drawn frame trailing the set position by a frame or two. */
const DASH_TRAIL_TICKS = 3;

/** A body set up as Smashcraft's fighter bodies are. */
function body(): unit {
  const created = CreateUnit(Player(2), UNIT_TYPE, 0, 0, 180);
  SetUnitPathing(created, false);
  UnitAddAbility(created, CROW_FORM);
  UnitRemoveAbility(created, CROW_FORM);
  UnitAddAbility(created, LOCUST);
  PauseUnit(created, true);
  return created;
}

function row(name: string, values: readonly number[]): string {
  return `${name}=${values.map(value => `${Math.floor(value * 128)}`).join(",")}`;
}

/** A binary32 value exactly: "M p E" is M × 2^E with M an odd integer, and 0 is "0". Doubling and halving are exact. */
export function exact(value: number): string {
  if (value === 0) return "0";
  let magnitude = value < 0 ? -value : value;
  let exponent = 0;
  while (magnitude < 8388608) {
    magnitude = magnitude * 2;
    exponent = exponent - 1;
  }
  while (magnitude >= 16777216) {
    magnitude = magnitude / 2;
    exponent = exponent + 1;
  }
  let mantissa = Math.floor(magnitude);
  while (floorMod(mantissa, 2) === 0) {
    mantissa = floorDiv(mantissa, 2);
    exponent = exponent + 1;
  }
  return `${value < 0 ? "-" : ""}${mantissa}p${exponent}`;
}

/**
 * A body dashes along X at 1200 units a second, each tick read before it moves: the drawn position is an
 * effect attached at its origin, read with the local position getter, less the offset measured at rest.
 * 3.0.1 reads an attached effect at 0, 0 wherever its unit is, so the count is 26 and says nothing of drawing.
 * `samples` gets each read as tick, set X, drawn X, drawn Y, times 128; `done` gets how many dash ticks
 * read the drawn body more than DASH_TRAIL_TICKS ticks of travel behind its set position.
 */
function dash(this: void, samples: string[], done: (this: void, behind: number) => void): void {
  const u = body();
  SetUnitX(u, DASH_START);
  SetUnitY(u, 0);
  BlzSetUnitFacingEx(u, 0);
  const probe = AddSpecialEffectTarget(PROBE_MODEL, u, "origin");
  let tick = 0;
  let set = DASH_START;
  let offset = 0;
  let behind = 0;
  TimerStart(CreateTimer(), TICK, true, () => {
    tick++;
    const drawn = BlzGetLocalSpecialEffectX(probe);
    samples.push(row(`dash-${tick}`, [set, drawn, BlzGetLocalSpecialEffectY(probe)]));
    if (tick === DASH_REST_TICKS) offset = drawn - set;
    if (tick > DASH_REST_TICKS && tick <= DASH_REST_TICKS + DASH_TICKS) {
      if (set - (drawn - offset) > DASH_TRAIL_TICKS * DASH_STEP) behind++;
      set = set + DASH_STEP;
      SetUnitX(u, set);
    }
    if (tick < 2 * DASH_REST_TICKS + DASH_TICKS) return;
    DestroyEffect(probe);
    RemoveUnit(u);
    DestroyTimer(GetExpiredTimer());
    done(behind);
  });
}

/**
 * Each recorded integer is the observed native value times 128; `exact` rows give the read value exactly.
 * The held case reads 0.25 seconds after its writes, then the dash runs; `dashSamples` gets its raw reads.
 */
export function unitMotionCases(this: void, done: (this: void, rows: readonly string[], dashSamples: readonly string[]) => void): void {
  const rows: string[] = [];
  let u = body();
  SetUnitX(u, 100.25);
  SetUnitY(u, -50.5);
  rows.push(row("position-read-in-same-call", [GetUnitX(u), GetUnitY(u)]));
  RemoveUnit(u);

  u = body();
  SetUnitFlyHeight(u, 300.5, 0);
  rows.push(row("fly-height-rate-zero", [GetUnitFlyHeight(u)]));
  RemoveUnit(u);

  u = body();
  BlzSetUnitFacingEx(u, 0);
  const right = GetUnitFacing(u);
  BlzSetUnitFacingEx(u, 180);
  rows.push(row("facing-ex-left-right", [right, GetUnitFacing(u)]));
  RemoveUnit(u);

  u = body();
  const normalized: number[] = [];
  for (const facing of [-90, 450, 360, 720.5, -720]) {
    BlzSetUnitFacingEx(u, facing);
    normalized.push(GetUnitFacing(u));
  }
  rows.push(row("facing-ex-normalized", normalized));
  for (const [label, facing] of FACINGS) {
    BlzSetUnitFacingEx(u, facing);
    rows.push(`facing-ex-exact-${label}=${exact(GetUnitFacing(u))}`);
  }
  RemoveUnit(u);

  for (const [label, facing] of CREATED_FACINGS) {
    u = CreateUnit(Player(2), UNIT_TYPE, 0, 0, facing);
    rows.push(`facing-created-exact-${label}=${exact(GetUnitFacing(u))}`);
    RemoveUnit(u);
  }

  const first = body();
  const second = body();
  for (const held of [first, second]) {
    SetUnitX(held, 64);
    SetUnitY(held, 32);
    SetUnitFlyHeight(held, 50, 0);
    BlzSetUnitFacingEx(held, 0);
  }
  TimerStart(CreateTimer(), 0.25, false, () => {
    rows.push(row("overlapping-bodies-held", [GetUnitX(first), GetUnitY(first), GetUnitFlyHeight(first), GetUnitFacing(first),
      GetUnitX(second), GetUnitY(second), GetUnitFlyHeight(second), GetUnitFacing(second)]));
    RemoveUnit(first);
    RemoveUnit(second);
    DestroyTimer(GetExpiredTimer());
    const samples: string[] = [];
    dash(samples, behind => {
      rows.push(`dash-ticks-drawn-behind=${behind}`);
      done(rows, samples);
    });
  });
}
