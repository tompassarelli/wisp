import { f32 } from "../../src/sim/f32";


const MODEL = "Abilities\\Spells\\Other\\Silence\\SilenceTarget.mdx";

export const DYING = "Abilities\\Spells\\NightElf\\FaerieFire\\FaerieFireTarget.mdx";

export const EFFECT_NOOPS = {};

function row(name: string, values: readonly number[]): string {
  return `${name}=${values.map(value => `${Math.floor(value * 128)}`).join(",")}`;
}

function at(this: void, model: effect): number[] {
  return [BlzGetLocalSpecialEffectX(model), BlzGetLocalSpecialEffectY(model), BlzGetLocalSpecialEffectZ(model)];
}

// Native observations are scaled by 128; held rows read 0.25 seconds after writes.


export function effectCases(this: void, done: (this: void, rows: readonly string[]) => void): void {
  const rows: string[] = [];
  let e = AddSpecialEffect(MODEL, 100.25, -50.5);
  rows.push(row("created-at-point", at(e)));
  DestroyEffect(e);

  e = AddSpecialEffect(MODEL, 0, 0);
  BlzSetSpecialEffectPosition(e, 0.75, -20.25, 300.75);
  rows.push(row("position-read-in-same-call", at(e)));
  DestroyEffect(e);

  e = AddSpecialEffect(MODEL, 0, 0);
  BlzSetSpecialEffectPosition(e, 64, 32, 16);
  BlzSetSpecialEffectX(e, -8);
  BlzSetSpecialEffectZ(e, 4.5);
  rows.push(row("axis-setters-independent", at(e)));
  DestroyEffect(e);


  e = AddSpecialEffect(MODEL, 0, 0);
  BlzSetSpecialEffectScale(e, 0);
  BlzSetSpecialEffectPosition(e, 64, 32, -4196);
  rows.push(row("scale-zero-parked", at(e)));
  DestroyEffect(e);

  e = AddSpecialEffect(MODEL, 0, 0);
  BlzSetSpecialEffectPosition(e, 10, 20, 30);
  BlzSetSpecialEffectScale(e, 2.5);
  BlzSetSpecialEffectMatrixScale(e, 2, 1, 0.5);
  BlzSetSpecialEffectYaw(e, f32(3.141592654));
  BlzSetSpecialEffectTimeScale(e, 0);
  BlzSetSpecialEffectTime(e, 0.5);
  rows.push(row("scale-orientation-time-keep-position", at(e)));
  DestroyEffect(e);


  e = AddSpecialEffect(DYING, -200, 0);
  BlzSetSpecialEffectTimeScale(e, 0);
  DestroyEffect(e);
  rows.push(row("destroyed-frozen-reads", at(e)));
  DestroyEffect(AddSpecialEffect(DYING, 200, 0));

  const frozen = AddSpecialEffect(MODEL, 0, 0);
  const playing = AddSpecialEffect(MODEL, 0, 0);
  BlzSetSpecialEffectTimeScale(frozen, 0);
  for (const held of [frozen, playing]) BlzSetSpecialEffectPosition(held, 0.75, 48, 96);
  TimerStart(CreateTimer(), 0.25, false, () => {
    rows.push(row("held-after-quarter-second", [...at(frozen), ...at(playing)]));
    DestroyEffect(frozen);
    DestroyEffect(playing);
    DestroyTimer(GetExpiredTimer());
    done(rows);
  });
}
