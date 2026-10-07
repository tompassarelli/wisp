export const UNIT_TYPE = 0x68666f6f;
export const UNIT_FIXTURE = { [UNIT_TYPE]: { life: 100, maxLife: 100, mana: 80, maxMana: 80 } };

function fixture(): unit {
  const created = CreateUnit(Player(2), UNIT_TYPE, 0, 0, 180);
  BlzSetUnitMaxHP(created, 100);
  BlzSetUnitMaxMana(created, 80);
  SetWidgetLife(created, 100);
  SetUnitState(created, UNIT_STATE_MANA, 80);
  return created;
}

/** Each recorded integer is the observed native value times 128. */
export function unitStateCases(this: void): string[] {
  const rows: string[] = [];
  const record = (name: string, values: readonly number[]) => {
    rows.push(`${name}=${values.map(value => `${Math.floor(value * 128)}`).join(",")}`);
  };
  let u = fixture();
  record("owner-retained", [GetPlayerId(GetOwningPlayer(u))]);
  RemoveUnit(u);

  u = fixture();
  SetUnitFacing(u, 180);
  BlzSetUnitFacingEx(u, 90);
  record("facing-writes", [GetUnitFacing(u)]);
  RemoveUnit(u);

  u = fixture();
  SetUnitState(u, UNIT_STATE_LIFE, 37.5);
  const life = [GetWidgetLife(u), GetUnitState(u, UNIT_STATE_LIFE)];
  SetWidgetLife(u, 25);
  record("life-getter-setter-agreement", [...life, GetWidgetLife(u), GetUnitState(u, UNIT_STATE_LIFE)]);
  RemoveUnit(u);

  u = fixture();
  SetUnitState(u, UNIT_STATE_MANA, 12.5);
  record("mana-getter-setter-agreement", [GetUnitState(u, UNIT_STATE_MANA)]);
  RemoveUnit(u);

  u = fixture();
  BlzSetUnitMaxHP(u, 200);
  const maxLife = [BlzGetUnitMaxHP(u), GetUnitState(u, UNIT_STATE_MAX_LIFE)];
  SetUnitState(u, UNIT_STATE_MAX_LIFE, 240);
  record("max-life-writes", [...maxLife, BlzGetUnitMaxHP(u), GetUnitState(u, UNIT_STATE_MAX_LIFE)]);
  RemoveUnit(u);

  u = fixture();
  BlzSetUnitMaxMana(u, 160);
  const maxMana = [BlzGetUnitMaxMana(u), GetUnitState(u, UNIT_STATE_MAX_MANA)];
  SetUnitState(u, UNIT_STATE_MAX_MANA, 180);
  record("max-mana-writes", [...maxMana, BlzGetUnitMaxMana(u), GetUnitState(u, UNIT_STATE_MAX_MANA)]);
  RemoveUnit(u);

  u = fixture();
  SetWidgetLife(u, 0.40625);
  const above = GetWidgetLife(u);
  SetUnitState(u, UNIT_STATE_LIFE, 10);
  record("fractional-boundary-alive", [above, GetWidgetLife(u)]);
  RemoveUnit(u);

  u = fixture();
  SetUnitState(u, UNIT_STATE_LIFE, 0.3984375);
  const below = GetWidgetLife(u);
  SetWidgetLife(u, 10);
  record("fractional-boundary-dead", [below, GetWidgetLife(u)]);
  RemoveUnit(u);

  u = fixture();
  KillUnit(u);
  record("life-after-kill", [GetWidgetLife(u), GetUnitState(u, UNIT_STATE_LIFE)]);
  RemoveUnit(u);

  u = fixture();
  KillUnit(u);
  SetWidgetLife(u, 50);
  record("dead-widget-life-write", [GetWidgetLife(u)]);
  RemoveUnit(u);

  u = fixture();
  KillUnit(u);
  SetUnitState(u, UNIT_STATE_LIFE, 50);
  record("dead-unit-state-write", [GetUnitState(u, UNIT_STATE_LIFE)]);
  RemoveUnit(u);

  u = fixture();
  RemoveUnit(u);
  SetWidgetLife(u, 50);
  record("removal", [GetUnitTypeId(u), GetWidgetLife(u)]);
  return rows;
}
