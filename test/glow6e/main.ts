import { createLocation, locationZ } from "wisp/game/bodies";
import { createTimer, destroyTimer, startTimer } from "wisp/game/clock";
import { createEffect, setEffectAnimation, setEffectBlendTime, setEffectPosition, setEffectTeamColor, setEffectTime, setEffectTimeScale } from "wisp/game/effects";
import { hideOriginFrames, namedFrame, screenHeight, screenWidth, setFrameVisible } from "wisp/game/frames";
import { player, playerColor, setPlayerColor } from "wisp/game/players";
import { CameraField, cameraEyeX, cameraEyeY, cameraEyeZ, cameraField, cameraTargetX, cameraTargetY, cameraTargetZ, enableFog, enableFogMask, setCameraBounds, setCameraField, setCameraPosition } from "wisp/game/view";
import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../gameApiLines";
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
  setCameraBounds(x, y, x, y, x, y, x, y);
  setCameraField(CameraField.rotation, 90, 0);
  setCameraField(CameraField.angleOfAttack, camera.angleOfAttack, 0);
  setCameraField(CameraField.roll, 0, 0);
  setCameraField(CameraField.targetDistance, camera.distance, 0);
  setCameraField(CameraField.zOffset, camera.zOffset, 0);
  setCameraField(CameraField.fieldOfView, camera.fieldOfView, 0);
  setCameraField(CameraField.farZ, FAR_Z, 0);
  setCameraPosition(x, y);
}

const hundredths = (value: number) => Math.floor(value * 100);

function cameraRow(this: void): string {
  return [CameraField.rotation, CameraField.angleOfAttack, CameraField.targetDistance, CameraField.fieldOfView, CameraField.zOffset].map((field) => hundredths(cameraField(field))).join(",");
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "glow6e", readyPrefix: "GE_HRR", globalPrefix: "__glow6e" });
}

export function start(this: void): void {
  install();
  enableFog(false);
  enableFogMask(false);
  hideOriginFrames(true);
  setFrameVisible(namedFrame("ConsoleUIBackdrop", 0), false);
  setPlayerColor(player(0), 0);
  const first = PHASES[0];
  if (first !== undefined) view(first.camera);
  createEffect(FLOOR, 0, 0);
  createEffect(WALL, 0, 0);
  const models = [BODY_ON, BODY_OFF, TWIN, ...SHOTS.flatMap((shot) => REPLICAS.map((replica) => replicaPath(replica, shot.frame)))];
  const effects = models.map((model) => {
    const created = createEffect(model, HIDDEN.x, HIDDEN.y);
    setEffectTeamColor(created, player(0));
    setEffectBlendTime(created, 0);
    setEffectAnimation(created, "Stand");
    setEffectTimeScale(created, 0);
    setEffectPosition(created, HIDDEN.x, HIDDEN.y, HIDDEN.z);
    return created;
  });
  const ground = createLocation(0, 0);
  let step = 0;
  const show = function(this: void): void {
    const phase = PHASES[floorMod(step, PHASES.length)];
    if (phase === undefined) return;
    view(phase.camera);
    models.forEach((model, index) => {
      const effect = effects[index];
      if (effect === undefined) return;
      const placed = phase.shown.find((entry) => entry.model === model);
      if (placed === undefined) { setEffectPosition(effect, HIDDEN.x, HIDDEN.y, HIDDEN.z); return; }
      setEffectPosition(effect, placed.x, placed.y, placed.z);
      if (placed.seconds !== undefined) setEffectTime(effect, placed.seconds);
    });
    writeLines(STATUS_FILE, [`phase=${phase.name}`, `step=${step}`, `width=${screenWidth()}`, `height=${screenHeight()}`,
      `color=${playerColor(player(0))}`, `ground=${hundredths(locationZ(ground))}`, `camera=${cameraRow()}`,
      `target=${hundredths(cameraTargetX())},${hundredths(cameraTargetY())},${hundredths(cameraTargetZ())}`,
      `eye=${hundredths(cameraEyeX())},${hundredths(cameraEyeY())},${hundredths(cameraEyeZ())}`]);
    step++;
  };
  const hold = function(this: void): void {
    const phase = PHASES[floorMod(step - 1, PHASES.length)];
    if (phase === undefined) return;
    models.forEach((model, index) => {
      const effect = effects[index], placed = phase.shown.find((entry) => entry.model === model);
      if (effect !== undefined && placed?.seconds !== undefined) setEffectTime(effect, placed.seconds);
    });
  };
  const begin = createTimer();
  startTimer(begin, START_SECONDS, false, () => {
    destroyTimer(begin);
    show();
    startTimer(createTimer(), PHASE_SECONDS, true, show);
    startTimer(createTimer(), HOLD_SECONDS, true, hold);
  });
}
