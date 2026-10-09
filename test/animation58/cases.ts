import { f32 } from "../../src/sim/f32";
import { BOARD, CAMERA, CLIP, DEATH_SECONDS, MARK, MARK_DY, ORIENTATION_MARK, READY_SECONDS, RULER, RULER_LENGTH, RULER_UNIT, SLOTS, START_SECONDS, slotNamed } from "./layout";


const LOCUST = 0x416c6f63;

const PRELOAD_Y = -1300;

export const ANIMATION_NOOPS = {
  FogEnable: "headless has no fog of war; the fixture turns it off so the real game shows every ruler",
  FogMaskEnable: "headless has no black mask; the fixture turns it off so the real game shows every ruler",
  BlzHideOriginFrames: "headless draws no game UI; the fixture hides it so the real game's console covers no ruler",
  SetCameraBounds: "headless has no camera bounds; the fixture pins the real camera over the rulers",
  SetUnitPathing: "the fixture's units mirror Smashcraft's bodies, which turn off pathing; headless has no pathing to turn off",
  PauseUnit: "the fixture's units mirror Smashcraft's paused bodies; headless runs no unit AI",
};


function view(this: void): void {
  const { x, y } = CAMERA;
  SetCameraBounds(x, y, x, y, x, y, x, y);
  SetCameraField(CAMERA_FIELD_ROTATION, 90, 0);
  SetCameraField(CAMERA_FIELD_ANGLE_OF_ATTACK, 270, 0);
  SetCameraField(CAMERA_FIELD_ROLL, 0, 0);
  SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, CAMERA.distance, 0);
  SetCameraField(CAMERA_FIELD_ZOFFSET, 0, 0);
  SetCameraField(CAMERA_FIELD_FIELD_OF_VIEW, CAMERA.fieldOfView, 0);
  SetCameraField(CAMERA_FIELD_FARZ, 5000, 0);
  SetCameraPosition(x, y);
}

function at(this: void, seconds: number, body: (this: void) => void): void {
  TimerStart(CreateTimer(), seconds, false, () => {
    DestroyTimer(GetExpiredTimer());
    body();
  });
}

function colored(this: void, model: string, x: number, y: number, player: number): effect {
  const created = AddSpecialEffect(model, x, y);
  BlzSetSpecialEffectColorByPlayer(created, Player(player));
  return created;
}


function rulerEffect(this: void, name: string): effect {
  const slot = slotNamed(name);
  return colored(RULER, slot.x, slot.y, 0);
}


function rulerUnit(this: void, name: string, blendTime: number): unit {
  const slot = slotNamed(name);
  const created = CreateUnit(Player(0), RULER_UNIT, slot.x, slot.y, 0);
  SetUnitPathing(created, false);
  UnitAddAbility(created, LOCUST);
  PauseUnit(created, true);
  SetUnitX(created, slot.x);
  SetUnitY(created, slot.y);
  SetUnitBlendTime(created, blendTime);
  return created;
}


function poolClip(this: void, name: string): effect {
  const slot = slotNamed(name);
  const clip = colored(CLIP, slot.x, slot.y, 0);
  BlzSetSpecialEffectAnimationBlendTime(clip, 0);
  BlzSetSpecialEffectAnimation(clip, "Stand");
  BlzSetSpecialEffectTimeScale(clip, 0);
  BlzSetSpecialEffectScale(clip, 0);
  BlzSetSpecialEffectPosition(clip, slot.x, slot.y, -4096);
  return clip;
}


function showClip(this: void, clip: effect, name: string): void {
  const slot = slotNamed(name);
  BlzSetSpecialEffectPosition(clip, slot.x, slot.y, 0);
  BlzSetSpecialEffectYaw(clip, 0);
  BlzSetSpecialEffectScale(clip, 1);
  BlzSetSpecialEffectTime(clip, f32(0.4));
}


function preload(this: void): void {
  for (const model of [RULER, CLIP]) BlzSetSpecialEffectScale(AddSpecialEffect(model, 0, PRELOAD_Y), 0);
  const body = CreateUnit(Player(0), RULER_UNIT, 0, PRELOAD_Y, 0);
  UnitAddAbility(body, LOCUST);
  PauseUnit(body, true);
  SetUnitScale(body, 0, 0, 0);
}


function unitPositions(this: void, units: readonly (readonly [string, unit])[]): string[] {
  return units.map(([name, body]) => `${name}-at=${Math.floor(GetUnitX(body) * 128)},${Math.floor(GetUnitY(body) * 128)}`);
}








export function animationCases(this: void, done: (this: void, rows: readonly string[]) => void): void {
  FogEnable(false);
  FogMaskEnable(false);
  BlzHideOriginFrames(true);
  BlzFrameSetVisible(BlzGetFrameByName("ConsoleUIBackdrop", 0), false);
  view();
  colored(BOARD, 0, 0, 11);
  colored(MARK, ORIENTATION_MARK[0], ORIENTATION_MARK[1], 4);
  for (const slot of SLOTS) {
    colored(MARK, slot.x, slot.y + MARK_DY, 4);
    colored(MARK, slot.x + RULER_LENGTH, slot.y + MARK_DY, 4);
  }
  preload();
  at(f32(0.1), view);
  at(START_SECONDS, () => cases(done));
}

function cases(this: void, done: (this: void, rows: readonly string[]) => void): void {

  const stand = rulerUnit("unit-stand", 0);
  SetUnitAnimation(stand, "stand");
  SetUnitTimeScale(stand, 0);
  const standHit = rulerUnit("unit-stand-hit", 0);
  SetUnitAnimation(standHit, "stand hit");
  SetUnitTimeScale(standHit, 0);


  const loop = rulerEffect("loop-played");
  BlzSetSpecialEffectAnimation(loop, "walk");
  const reference = rulerEffect("loop-reference");
  BlzSetSpecialEffectAnimation(reference, "spell");
  const held = rulerEffect("nonloop-held");
  BlzSetSpecialEffectAnimation(held, "attack");
  at(4.5, () => {
    for (const played of [loop, reference, held]) BlzSetSpecialEffectTimeScale(played, 0);
  });
  for (const [name, animation] of [["loop-seek-past-end", "walk"], ["nonloop-seek-past-end", "attack"]] as const) {
    const sought = rulerEffect(name);
    BlzSetSpecialEffectAnimation(sought, animation);
    at(0.5, () => BlzSetSpecialEffectTimeScale(sought, 0));
    at(1, () => BlzSetSpecialEffectTime(sought, 1.5));
  }


  const birthDuring = rulerEffect("birth-during");
  at(0.25, () => BlzSetSpecialEffectTimeScale(birthDuring, 0));
  const birthAfter = rulerEffect("birth-after");
  at(1, () => BlzSetSpecialEffectTimeScale(birthAfter, 0));


  const blended = rulerUnit("blend-150", f32(0.15));
  const unblended = rulerUnit("blend-0", 0);
  const switchFrozen = rulerUnit("blend-switch-frozen", f32(0.15));
  const frozenSelect = rulerUnit("timescale-then-select", 0);
  for (const body of [blended, unblended, switchFrozen, frozenSelect]) SetUnitAnimation(body, "stand");
  at(0.5, () => {
    SetUnitAnimation(blended, "walk");
    SetUnitAnimation(unblended, "walk");
    for (const body of [switchFrozen, frozenSelect]) {
      SetUnitTimeScale(body, 0);
      SetUnitAnimation(body, "walk");
    }
  });
  at(f32(0.55), () => {
    SetUnitTimeScale(blended, 0);
    SetUnitTimeScale(unblended, 0);
  });

  at(1, () => {
    SetUnitTimeScale(switchFrozen, 0);
    SetUnitTimeScale(frozenSelect, 0);
  });


  const globalFrozen = rulerEffect("global-frozen");
  BlzSetSpecialEffectAnimation(globalFrozen, "stand");
  BlzSetSpecialEffectTimeScale(globalFrozen, 0);
  const globalKept = rulerEffect("global-kept");
  BlzSetSpecialEffectAnimation(globalKept, "stand");
  at(f32(0.3), () => BlzSetSpecialEffectAnimation(globalKept, "walk"));
  at(f32(0.6), () => {
    BlzSetSpecialEffectTimeScale(globalKept, 0);
    BlzSetSpecialEffectTime(globalKept, 0.875);
  });
  const outOfRange = rulerUnit("index-out-of-range", 0);
  SetUnitTimeScale(outOfRange, 0);
  SetUnitAnimationByIndex(outOfRange, 99);

  const selectFreeze = rulerEffect("select-freeze-seek");
  at(1, () => {
    BlzSetSpecialEffectAnimation(selectFreeze, "walk");
    BlzSetSpecialEffectTimeScale(selectFreeze, 0);
    BlzSetSpecialEffectTime(selectFreeze, 0.25);
  });
  const freezeFirst = rulerEffect("freeze-then-select-seek");
  at(0.5, () => BlzSetSpecialEffectTimeScale(freezeFirst, 0));
  at(1, () => {
    BlzSetSpecialEffectAnimation(freezeFirst, "walk");
    BlzSetSpecialEffectTime(freezeFirst, 0.25);
  });


  const shown = poolClip("clip-shown");
  const reseek = poolClip("clip-second-seek");
  at(1, () => {
    showClip(shown, "clip-shown");
    showClip(reseek, "clip-second-seek");
  });
  at(f32(1.05), () => BlzSetSpecialEffectTime(reseek, f32(0.4)));




  const deathReference = rulerEffect("death-reference");
  BlzSetSpecialEffectAnimation(deathReference, "stand");
  at(DEATH_SECONDS, () => BlzSetSpecialEffectAnimation(deathReference, "death"));
  for (const [name, after] of [["death-at-0", 0], ["death-at-1", 1], ["death-at-2", 2]] as const) {
    const dying = rulerEffect(name);
    BlzSetSpecialEffectAnimation(dying, "stand");
    at(DEATH_SECONDS + after, () => DestroyEffect(dying));
  }
  const deathFrozen = rulerEffect("death-frozen");
  const teardown = rulerEffect("teardown-hidden");
  const noDeath = colored(CLIP, slotNamed("no-death-frozen").x, slotNamed("no-death-frozen").y, 0);
  for (const frozen of [deathFrozen, teardown, noDeath]) {
    BlzSetSpecialEffectAnimation(frozen, "stand");
    at(0.5, () => BlzSetSpecialEffectTimeScale(frozen, 0));
  }
  at(DEATH_SECONDS, () => {
    DestroyEffect(deathFrozen);
    DestroyEffect(noDeath);
    BlzSetSpecialEffectScale(teardown, 0);
    DestroyEffect(teardown);
  });


  for (const [name, reset, calls] of [["matrix-scale-once", false, 1], ["matrix-scale-twice", false, 2], ["matrix-scale-reset", true, 2]] as const) {
    const scaled = rulerEffect(name);
    BlzSetSpecialEffectAnimation(scaled, "stand");
    at(f32(0.1), () => BlzSetSpecialEffectTimeScale(scaled, 0));
    at(0.5, () => {
      BlzSetSpecialEffectTime(scaled, 0.125);
      for (let call = 0; call < calls; call++) {
        if (reset && call > 0) BlzResetSpecialEffectMatrix(scaled);
        BlzSetSpecialEffectMatrixScale(scaled, 2, 1, 1);
      }
    });
  }

  const units = [["unit-stand", stand], ["unit-stand-hit", standHit], ["index-out-of-range", outOfRange], ["blend-150", blended],
    ["blend-0", unblended], ["blend-switch-frozen", switchFrozen], ["timescale-then-select", frozenSelect]] as const;
  at(READY_SECONDS, () => {
    view();
    done([`ready=${SLOTS.length}`, ...unitPositions(units)]);
  });
}
