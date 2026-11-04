import { bodyX, bodyY, createBody, setBodyPathing, addBodyAbility, pauseBody, setBodyX, setBodyY, setBodyBlendTime, setBodyScale, setBodyAnimationIndex, setBodyAnimation, setBodyTimeScale, type Body } from "wisp/game/bodies";
import { createTimer, destroyTimer, startTimer } from "wisp/game/clock";
import { createEffect, destroyEffect, setEffectAnimation, setEffectBlendTime, setEffectPosition, setEffectTeamColor, setEffectTime, setEffectTimeScale, setEffectScale, setEffectYaw, setEffectMatrixScale, resetEffectMatrix, type Effect } from "wisp/game/effects";
import { hideOriginFrames, namedFrame, setFrameVisible } from "wisp/game/frames";
import { player } from "wisp/game/players";
import { CameraField, enableFog, enableFogMask, setCameraBounds, setCameraField, setCameraPosition } from "wisp/game/view";
import { f32 } from "../../src/sim/f32";
import { BOARD, CAMERA, CLIP, DEATH_SECONDS, MARK, MARK_DY, ORIENTATION_MARK, READY_SECONDS, RULER, RULER_LENGTH, RULER_UNIT, SLOTS, START_SECONDS, slotNamed } from "./layout";

const LOCUST = 0x416c6f63;

const PRELOAD_Y = -1300;

export const ANIMATION_NOOPS = {
  FogEnable: "headless has no fog of war; the fixture turns it off so the real game shows every ruler",
  FogMaskEnable: "headless has no black mask; the fixture turns it off so the real game shows every ruler",
  BlzHideOriginFrames: "headless draws no game UI; the fixture hides it so the real game's console covers no ruler",
  SetCameraBounds: "headless has no camera bounds; the fixture pins the real camera over the rulers",
  SetUnitPathing: "the fixture's units mirror Mak'gora's bodies, which turn off pathing; headless has no pathing to turn off",
  PauseUnit: "the fixture's units mirror Mak'gora's paused bodies; headless runs no unit AI",
};

function view(this: void): void {
  const { x, y } = CAMERA;
  setCameraBounds(x, y, x, y, x, y, x, y);
  setCameraField(CameraField.rotation, 90, 0);
  setCameraField(CameraField.angleOfAttack, 270, 0);
  setCameraField(CameraField.roll, 0, 0);
  setCameraField(CameraField.targetDistance, CAMERA.distance, 0);
  setCameraField(CameraField.zOffset, 0, 0);
  setCameraField(CameraField.fieldOfView, CAMERA.fieldOfView, 0);
  setCameraField(CameraField.farZ, 5000, 0);
  setCameraPosition(x, y);
}

function at(this: void, seconds: number, body: (this: void) => void): void {
  const once = createTimer();
  startTimer(once, seconds, false, () => {
    destroyTimer(once);
    body();
  });
}

function colored(this: void, model: string, x: number, y: number, owner: number): Effect {
  const created = createEffect(model, x, y);
  setEffectTeamColor(created, player(owner));
  return created;
}

function rulerEffect(this: void, name: string): Effect {
  const slot = slotNamed(name);
  return colored(RULER, slot.x, slot.y, 0);
}

function rulerUnit(this: void, name: string, blendTime: number): Body {
  const slot = slotNamed(name);
  const created = createBody(player(0), RULER_UNIT, slot.x, slot.y, 0);
  setBodyPathing(created, false);
  addBodyAbility(created, LOCUST);
  pauseBody(created, true);
  setBodyX(created, slot.x);
  setBodyY(created, slot.y);
  setBodyBlendTime(created, blendTime);
  return created;
}

function poolClip(this: void, name: string): Effect {
  const slot = slotNamed(name);
  const clip = colored(CLIP, slot.x, slot.y, 0);
  setEffectBlendTime(clip, 0);
  setEffectAnimation(clip, "Stand");
  setEffectTimeScale(clip, 0);
  setEffectScale(clip, 0);
  setEffectPosition(clip, slot.x, slot.y, -4096);
  return clip;
}

function showClip(this: void, clip: Effect, name: string): void {
  const slot = slotNamed(name);
  setEffectPosition(clip, slot.x, slot.y, 0);
  setEffectYaw(clip, 0);
  setEffectScale(clip, 1);
  setEffectTime(clip, f32(0.4));
}

function preload(this: void): void {
  for (const model of [RULER, CLIP]) setEffectScale(createEffect(model, 0, PRELOAD_Y), 0);
  const body = createBody(player(0), RULER_UNIT, 0, PRELOAD_Y, 0);
  addBodyAbility(body, LOCUST);
  pauseBody(body, true);
  setBodyScale(body, 0, 0, 0);
}

function unitPositions(this: void, units: readonly (readonly [string, Body])[]): string[] {
  return units.map(([name, body]) => `${name}-at=${Math.floor(bodyX(body) * 128)},${Math.floor(bodyY(body) * 128)}`);
}

export function animationCases(this: void, done: (this: void, rows: readonly string[]) => void): void {
  enableFog(false);
  enableFogMask(false);
  hideOriginFrames(true);
  setFrameVisible(namedFrame("ConsoleUIBackdrop", 0), false);
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
  setBodyAnimation(stand, "stand");
  setBodyTimeScale(stand, 0);
  const standHit = rulerUnit("unit-stand-hit", 0);
  setBodyAnimation(standHit, "stand hit");
  setBodyTimeScale(standHit, 0);

  const loop = rulerEffect("loop-played");
  setEffectAnimation(loop, "walk");
  const reference = rulerEffect("loop-reference");
  setEffectAnimation(reference, "spell");
  const held = rulerEffect("nonloop-held");
  setEffectAnimation(held, "attack");
  at(4.5, () => {
    for (const played of [loop, reference, held]) setEffectTimeScale(played, 0);
  });
  for (const [name, animation] of [["loop-seek-past-end", "walk"], ["nonloop-seek-past-end", "attack"]] as const) {
    const sought = rulerEffect(name);
    setEffectAnimation(sought, animation);
    at(0.5, () => setEffectTimeScale(sought, 0));
    at(1, () => setEffectTime(sought, 1.5));
  }

  const birthDuring = rulerEffect("birth-during");
  at(0.25, () => setEffectTimeScale(birthDuring, 0));
  const birthAfter = rulerEffect("birth-after");
  at(1, () => setEffectTimeScale(birthAfter, 0));

  const blended = rulerUnit("blend-150", f32(0.15));
  const unblended = rulerUnit("blend-0", 0);
  const switchFrozen = rulerUnit("blend-switch-frozen", f32(0.15));
  const frozenSelect = rulerUnit("timescale-then-select", 0);
  for (const body of [blended, unblended, switchFrozen, frozenSelect]) setBodyAnimation(body, "stand");
  at(0.5, () => {
    setBodyAnimation(blended, "walk");
    setBodyAnimation(unblended, "walk");
    for (const body of [switchFrozen, frozenSelect]) {
      setBodyTimeScale(body, 0);
      setBodyAnimation(body, "walk");
    }
  });
  at(f32(0.55), () => {
    setBodyTimeScale(blended, 0);
    setBodyTimeScale(unblended, 0);
  });

  at(1, () => {
    setBodyTimeScale(switchFrozen, 0);
    setBodyTimeScale(frozenSelect, 0);
  });

  const globalFrozen = rulerEffect("global-frozen");
  setEffectAnimation(globalFrozen, "stand");
  setEffectTimeScale(globalFrozen, 0);
  const globalKept = rulerEffect("global-kept");
  setEffectAnimation(globalKept, "stand");
  at(f32(0.3), () => setEffectAnimation(globalKept, "walk"));
  at(f32(0.6), () => {
    setEffectTimeScale(globalKept, 0);
    setEffectTime(globalKept, 0.875);
  });
  const outOfRange = rulerUnit("index-out-of-range", 0);
  setBodyTimeScale(outOfRange, 0);
  setBodyAnimationIndex(outOfRange, 99);

  const selectFreeze = rulerEffect("select-freeze-seek");
  at(1, () => {
    setEffectAnimation(selectFreeze, "walk");
    setEffectTimeScale(selectFreeze, 0);
    setEffectTime(selectFreeze, 0.25);
  });
  const freezeFirst = rulerEffect("freeze-then-select-seek");
  at(0.5, () => setEffectTimeScale(freezeFirst, 0));
  at(1, () => {
    setEffectAnimation(freezeFirst, "walk");
    setEffectTime(freezeFirst, 0.25);
  });

  const shown = poolClip("clip-shown");
  const reseek = poolClip("clip-second-seek");
  at(1, () => {
    showClip(shown, "clip-shown");
    showClip(reseek, "clip-second-seek");
  });
  at(f32(1.05), () => setEffectTime(reseek, f32(0.4)));

  const deathReference = rulerEffect("death-reference");
  setEffectAnimation(deathReference, "stand");
  at(DEATH_SECONDS, () => setEffectAnimation(deathReference, "death"));
  for (const [name, after] of [["death-at-0", 0], ["death-at-1", 1], ["death-at-2", 2]] as const) {
    const dying = rulerEffect(name);
    setEffectAnimation(dying, "stand");
    at(DEATH_SECONDS + after, () => destroyEffect(dying));
  }
  const deathFrozen = rulerEffect("death-frozen");
  const teardown = rulerEffect("teardown-hidden");
  const noDeath = colored(CLIP, slotNamed("no-death-frozen").x, slotNamed("no-death-frozen").y, 0);
  for (const frozen of [deathFrozen, teardown, noDeath]) {
    setEffectAnimation(frozen, "stand");
    at(0.5, () => setEffectTimeScale(frozen, 0));
  }
  at(DEATH_SECONDS, () => {
    destroyEffect(deathFrozen);
    destroyEffect(noDeath);
    setEffectScale(teardown, 0);
    destroyEffect(teardown);
  });

  for (const [name, reset, calls] of [["matrix-scale-once", false, 1], ["matrix-scale-twice", false, 2], ["matrix-scale-reset", true, 2]] as const) {
    const scaled = rulerEffect(name);
    setEffectAnimation(scaled, "stand");
    at(f32(0.1), () => setEffectTimeScale(scaled, 0));
    at(0.5, () => {
      setEffectTime(scaled, 0.125);
      for (let call = 0; call < calls; call++) {
        if (reset && call > 0) resetEffectMatrix(scaled);
        setEffectMatrixScale(scaled, 2, 1, 1);
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
