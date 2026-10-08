import { f32 } from "../../src/sim/f32";
import { BOARD, CAMERA, CLIP, MARK, MARK_DY, ORIENTATION_MARK, READY_SECONDS, RULER, RULER_LENGTH, RULER_UNIT, SLOTS, slotNamed } from "./layout";

/** Locust: no selection, no collision. */
const LOCUST = 0x416c6f63;

export const ANIMATION_NOOPS = {
  FogEnable: "headless has no fog of war; the fixture turns it off so the real game shows every ruler",
  FogMaskEnable: "headless has no black mask; the fixture turns it off so the real game shows every ruler",
  BlzHideOriginFrames: "headless draws no game UI; the fixture hides it so the real game's console covers no ruler",
  SetCameraBounds: "headless has no camera bounds; the fixture pins the real camera over the rulers",
  SetUnitPathing: "the fixture's units mirror Smashcraft's bodies, which turn off pathing; headless has no pathing to turn off",
  PauseUnit: "the fixture's units mirror Smashcraft's paused bodies; headless runs no unit AI",
};

/** Straight down on the rulers, world X to the right and Y up, with the console hidden. */
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

/** A ruler effect, red, at its case's origin. */
function rulerEffect(this: void, name: string): effect {
  const slot = slotNamed(name);
  return colored(RULER, slot.x, slot.y, 0);
}

/** A ruler unit, red, set up as Smashcraft's bodies are, with its blend time set before anything plays. */
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

/** A clip set up as Smashcraft's fighter pool sets up each clip: frozen on Stand, collapsed and parked below the floor. */
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

/** The pool showing a clip at 0.4 s: placed, turned, scaled, then sought. */
function showClip(this: void, clip: effect, name: string): void {
  const slot = slotNamed(name);
  BlzSetSpecialEffectPosition(clip, slot.x, slot.y, 0);
  BlzSetSpecialEffectYaw(clip, 0);
  BlzSetSpecialEffectScale(clip, 1);
  BlzSetSpecialEffectTime(clip, f32(0.4));
}

/**
 * Sets up every case of wisp:docs/warsmash-notes.md's "Animation playback"
 * capture list and the effect lifetime and matrix scale cases of "Effects:
 * attachment, scale and lifetime", freezes each at its moment and, at
 * READY_SECONDS, reports that the scene can be captured.
 */
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

  // 1. Selection by name on a model listing Stand Hit before Stand.
  const stand = rulerUnit("unit-stand", 0);
  SetUnitAnimation(stand, "stand");
  SetUnitTimeScale(stand, 0);
  const standHit = rulerUnit("unit-stand-hit", 0);
  SetUnitAnimation(standHit, "stand hit");
  SetUnitTimeScale(standHit, 0);

  // 2. Loop ends and holds: played for 4.5 s beside a five-second reference clock, and sought past the end.
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
    BlzSetSpecialEffectTimeScale(sought, 0);
    BlzSetSpecialEffectTime(sought, 1.5);
  }

  // 3. An effect never told what to play: during Birth and after it.
  const birthDuring = rulerEffect("birth-during");
  at(0.25, () => BlzSetSpecialEffectTimeScale(birthDuring, 0));
  const birthAfter = rulerEffect("birth-after");
  at(1, () => BlzSetSpecialEffectTimeScale(birthAfter, 0));

  // 4. Blends: 0.15 s and 0 caught 50 ms after a switch; a switch made at time scale 0, with and without a blend.
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
  // A selection that set the speed back to 1 would have run these since 0.5 s.
  at(1, () => {
    SetUnitTimeScale(switchFrozen, 0);
    SetUnitTimeScale(frozenSelect, 0);
  });

  // 5. Global sequences: frozen from creation, and kept across a selection and a seek; an index the model lacks.
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

  // 6. Blademaster frame 262's calls on a ruler clip: hidden, then shown at 0.4 s, with and without a second seek.
  const shown = poolClip("clip-shown");
  const reseek = poolClip("clip-second-seek");
  at(1, () => {
    showClip(shown, "clip-shown");
    showClip(reseek, "clip-second-seek");
  });
  at(f32(1.05), () => BlzSetSpecialEffectTime(reseek, f32(0.4)));

  // wisp#59. DestroyEffect on a frozen ruler (Death's first frame, for good), a frozen clip without Death (gone at
  // once) and a ruler collapsed first as Smashcraft's victory pose is (nothing shown); on a ruler mid-Stand, beside one
  // told to play Death at the same moment.
  const deathFrozen = rulerEffect("death-frozen");
  const teardown = rulerEffect("teardown-hidden");
  for (const frozen of [deathFrozen, teardown]) {
    BlzSetSpecialEffectAnimation(frozen, "stand");
    BlzSetSpecialEffectTimeScale(frozen, 0);
  }
  const noDeath = colored(CLIP, slotNamed("no-death-frozen").x, slotNamed("no-death-frozen").y, 0);
  BlzSetSpecialEffectAnimation(noDeath, "stand");
  BlzSetSpecialEffectTimeScale(noDeath, 0);
  at(0.5, () => {
    DestroyEffect(deathFrozen);
    DestroyEffect(noDeath);
    BlzSetSpecialEffectScale(teardown, 0);
    DestroyEffect(teardown);
  });
  const deathPlaying = rulerEffect("death-playing");
  const deathReference = rulerEffect("death-reference");
  BlzSetSpecialEffectAnimation(deathPlaying, "stand");
  BlzSetSpecialEffectAnimation(deathReference, "stand");
  at(1.25, () => {
    DestroyEffect(deathPlaying);
    BlzSetSpecialEffectAnimation(deathReference, "death");
  });
  // Matrix scale on a ruler frozen at 125 ms, X doubled once, twice, and twice with a reset between: whether
  // Smashcraft's `-dev backdrop on`, which scales existing scenery again, compounds.
  for (const [name, reset, calls] of [["matrix-scale-once", false, 1], ["matrix-scale-twice", false, 2], ["matrix-scale-reset", true, 2]] as const) {
    const scaled = rulerEffect(name);
    BlzSetSpecialEffectAnimation(scaled, "stand");
    BlzSetSpecialEffectTimeScale(scaled, 0);
    BlzSetSpecialEffectTime(scaled, 0.125);
    for (let call = 0; call < calls; call++) {
      if (reset && call > 0) BlzResetSpecialEffectMatrix(scaled);
      BlzSetSpecialEffectMatrixScale(scaled, 2, 1, 1);
    }
  }

  at(f32(0.1), view);
  at(READY_SECONDS, () => {
    view();
    done([`ready=${SLOTS.length}`]);
  });
}
