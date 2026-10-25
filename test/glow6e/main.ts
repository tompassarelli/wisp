import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/map/fileio";
import { floorMod } from "../../src/sim/intMath";
import { BODY_OFF, BODY_ON, FAR_Z, HOLD_SECONDS, FLOOR, HIDDEN, PHASES, PHASE_SECONDS, REPLICAS, SHOTS, START_SECONDS, STATUS_FILE, TWIN, WALL, replicaPath, type View } from "./layout";

export const GLOW_NOOPS = {
  FogEnable: "headless has no fog of war; the fixture turns it off so the real game shows the models",
  FogMaskEnable: "headless has no black mask; the fixture turns it off so the real game shows the models",
  BlzHideOriginFrames: "headless draws no game UI; the fixture hides it so the real game draws nothing over the board",
  SetCameraBounds: "headless has no camera bounds; the fixture pins the real camera over the models",
};

function view(this: void, camera: View): void {
  const { x, y } = camera;
  SetCameraBounds(x, y, x, y, x, y, x, y);
  SetCameraField(CAMERA_FIELD_ROTATION, 90, 0);
  SetCameraField(CAMERA_FIELD_ANGLE_OF_ATTACK, camera.angleOfAttack, 0);
  SetCameraField(CAMERA_FIELD_ROLL, 0, 0);
  SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, camera.distance, 0);
  SetCameraField(CAMERA_FIELD_ZOFFSET, camera.zOffset, 0);
  SetCameraField(CAMERA_FIELD_FIELD_OF_VIEW, camera.fieldOfView, 0);
  SetCameraField(CAMERA_FIELD_FARZ, FAR_Z, 0);
  SetCameraPosition(x, y);
}

const hundredths = (value: number) => Math.floor(value * 100);

function cameraRow(this: void): string {
  return [CAMERA_FIELD_ROTATION, CAMERA_FIELD_ANGLE_OF_ATTACK, CAMERA_FIELD_TARGET_DISTANCE, CAMERA_FIELD_FIELD_OF_VIEW, CAMERA_FIELD_ZOFFSET].map((field) => hundredths(GetCameraField(field))).join(",");
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "glow6e", readyPrefix: "GE_HRR", globalPrefix: "__glow6e" });
}

export function start(this: void): void {
  install();
  FogEnable(false);
  FogMaskEnable(false);
  BlzHideOriginFrames(true);
  BlzFrameSetVisible(BlzGetFrameByName("ConsoleUIBackdrop", 0), false);
  SetPlayerColor(Player(0), PLAYER_COLOR_RED);
  const first = PHASES[0];
  if (first !== undefined) view(first.camera);
  AddSpecialEffect(FLOOR, 0, 0);
  AddSpecialEffect(WALL, 0, 0);
  const models = [BODY_ON, BODY_OFF, TWIN, ...SHOTS.flatMap((shot) => REPLICAS.map((replica) => replicaPath(replica, shot.frame)))];
  const effects = models.map((model) => {
    const created = AddSpecialEffect(model, HIDDEN.x, HIDDEN.y);
    BlzSetSpecialEffectColorByPlayer(created, Player(0));
    BlzSetSpecialEffectAnimationBlendTime(created, 0);
    BlzSetSpecialEffectAnimation(created, "Stand");
    BlzSetSpecialEffectTimeScale(created, 0);
    BlzSetSpecialEffectPosition(created, HIDDEN.x, HIDDEN.y, HIDDEN.z);
    return created;
  });
  const ground = Location(0, 0);
  let step = 0;
  const show = function(this: void): void {
    const phase = PHASES[floorMod(step, PHASES.length)];
    if (phase === undefined) return;
    view(phase.camera);
    models.forEach((model, index) => {
      const effect = effects[index];
      if (effect === undefined) return;
      const placed = phase.shown.find((entry) => entry.model === model);
      if (placed === undefined) { BlzSetSpecialEffectPosition(effect, HIDDEN.x, HIDDEN.y, HIDDEN.z); return; }
      BlzSetSpecialEffectPosition(effect, placed.x, placed.y, placed.z);
      if (placed.seconds !== undefined) BlzSetSpecialEffectTime(effect, placed.seconds);
    });
    writeLines(STATUS_FILE, [`phase=${phase.name}`, `step=${step}`, `width=${BlzGetLocalClientWidth()}`, `height=${BlzGetLocalClientHeight()}`,
      `color=${GetHandleId(GetPlayerColor(Player(0)))}`, `ground=${hundredths(GetLocationZ(ground))}`, `camera=${cameraRow()}`,
      `target=${hundredths(GetCameraTargetPositionX())},${hundredths(GetCameraTargetPositionY())},${hundredths(GetCameraTargetPositionZ())}`,
      `eye=${hundredths(GetCameraEyePositionX())},${hundredths(GetCameraEyePositionY())},${hundredths(GetCameraEyePositionZ())}`]);
    step++;
  };
  const hold = function(this: void): void {
    const phase = PHASES[floorMod(step - 1, PHASES.length)];
    if (phase === undefined) return;
    models.forEach((model, index) => {
      const effect = effects[index], placed = phase.shown.find((entry) => entry.model === model);
      if (effect !== undefined && placed?.seconds !== undefined) BlzSetSpecialEffectTime(effect, placed.seconds);
    });
  };
  TimerStart(CreateTimer(), START_SECONDS, false, () => {
    DestroyTimer(GetExpiredTimer());
    show();
    TimerStart(CreateTimer(), PHASE_SECONDS, true, show);
    TimerStart(CreateTimer(), HOLD_SECONDS, true, hold);
  });
}
