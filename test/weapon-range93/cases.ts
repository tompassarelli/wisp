export const ATTACKER_TYPES = [0x77523030, 0x77523031] as const;
export const TARGET_TYPE = 0x77525430;
export const OLD_RANGE = 256;
export const NEW_RANGE = 512;

export function weaponRangeCases(this: void, done: (this: void, rows: readonly string[]) => void): void {
  const rows: string[] = [];
  SetPlayerAlliance(Player(0), Player(1), ALLIANCE_PASSIVE, false);
  SetPlayerAlliance(Player(1), Player(0), ALLIANCE_PASSIVE, false);
  let weapon = 0;
  let changed = false;
  let distanceIndex = 0;
  const distances = [128, 384, 640];
  const run = () => {
    const type = ATTACKER_TYPES[weapon];
    const distance = distances[distanceIndex];
    if (type === undefined || distance === undefined) throw new Error("invalid weapon-range case");
    const attacker = CreateUnit(Player(0), type, 0, 0, 0);
    const target = CreateUnit(Player(1), TARGET_TYPE, distance, 0, 180);
    PauseUnit(target, true);
    const before = BlzGetUnitWeaponRealField(attacker, UNIT_WEAPON_RF_ATTACK_RANGE, weapon);
    const result = changed ? BlzSetUnitWeaponRealField(attacker, UNIT_WEAPON_RF_ATTACK_RANGE, weapon, NEW_RANGE) : undefined;
    const after = BlzGetUnitWeaponRealField(attacker, UNIT_WEAPON_RF_ATTACK_RANGE, weapon);
    const life = GetWidgetLife(target);
    const x = GetUnitX(attacker);
    const y = GetUnitY(attacker);
    const order = IssueTargetOrder(attacker, "attack", target);
    const timer = CreateTimer();
    TimerStart(timer, 2, false, () => {
      rows.push(`weapon=${weapon},changed=${changed},distance=${distance},before=${before},setter=${result === undefined ? "not-called" : `${result}`},after=${after},order=${order},damaged=${GetWidgetLife(target) < life},lifeBefore=${life},lifeAfter=${GetWidgetLife(target)},moved=${GetUnitX(attacker) !== x || GetUnitY(attacker) !== y}`);
      DestroyTimer(timer);
      RemoveUnit(attacker);
      RemoveUnit(target);
      distanceIndex++;
      if (distanceIndex === distances.length) {
        distanceIndex = 0;
        if (changed) { weapon++; changed = false; }
        else changed = true;
      }
      if (weapon === ATTACKER_TYPES.length) done(rows);
      else run();
    });
  };
  run();
}
