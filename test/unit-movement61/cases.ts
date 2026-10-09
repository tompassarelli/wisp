export const UNIT_TYPE = 0x68666f6f;
/** Crow Form, added and removed so a ground unit's flying height can change. */
const CROW_FORM = 0x416d7266;

const LOCUST = 0x416c6f63;

export const UNIT_MOVEMENT_NOOPS = {
  SetUnitPathing: "the fixture's bodies mirror Smashcraft's, which turn off pathing; headless has no pathing to turn off",
  PauseUnit: "the fixture's bodies mirror Smashcraft's paused bodies; headless runs no unit AI",
};


function body(crowForm: boolean): unit {
  const created = CreateUnit(Player(2), UNIT_TYPE, 0, 0, 180);
  SetUnitPathing(created, false);
  if (crowForm) {
    UnitAddAbility(created, CROW_FORM);
    UnitRemoveAbility(created, CROW_FORM);
  }
  UnitAddAbility(created, LOCUST);
  PauseUnit(created, true);
  return created;
}

function row(name: string, values: readonly number[]): string {
  return `${name}=${values.map(value => `${Math.floor(value * 128)}`).join(",")}`;
}

/** Each recorded integer is the observed native value times 128. */
export function unitMovementCases(this: void, done: (this: void, rows: readonly string[]) => void): void {
  const rows: string[] = [];
  const ground = body(false);
  const lifted = body(true);
  SetUnitFlyHeight(ground, 300, 0);
  SetUnitFlyHeight(lifted, 300, 0);
  rows.push(row("fly-height-needs-crow-form", [GetUnitFlyHeight(ground), GetUnitFlyHeight(lifted)]));
  RemoveUnit(ground);
  RemoveUnit(lifted);

  const u = body(true);
  SetUnitMoveSpeed(u, 270);
  rows.push(row("move-speed-set-and-read", [GetUnitMoveSpeed(u)]));
  RemoveUnit(u);
  done(rows);
}
