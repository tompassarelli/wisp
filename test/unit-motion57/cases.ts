export const UNIT_TYPE = 0x68666f6f;
/** Crow Form, added and removed so a ground unit's flying height can change. */
const CROW_FORM = 0x416d7266;
/** Locust: no selection, no collision. */
const LOCUST = 0x416c6f63;

export const UNIT_MOTION_NOOPS = {
  SetUnitPathing: "the fixture's bodies mirror Smashcraft's, which turn off pathing; headless has no pathing to turn off",
  PauseUnit: "the fixture's bodies mirror Smashcraft's paused bodies; headless runs no unit AI",
};

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

/** Each recorded integer is the observed native value times 128. The held case reads 0.25 seconds after its writes. */
export function unitMotionCases(this: void, done: (this: void, rows: readonly string[]) => void): void {
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
  RemoveUnit(u);

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
    done(rows);
  });
}
