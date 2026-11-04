import { createLocation, locationZ } from "wisp/game/bodies";
import { createTimer, destroyTimer, startTimer } from "wisp/game/clock";
import { createEffect, setEffectPosition, setEffectTeamColor } from "wisp/game/effects";
import { hideOriginFrames, namedFrame, screenHeight, screenWidth, setFrameVisible } from "wisp/game/frames";
import { player, playerColor, setPlayerColor } from "wisp/game/players";
import { CameraField, cameraEyeX, cameraEyeY, cameraEyeZ, cameraField, cameraTargetX, cameraTargetY, cameraTargetZ, enableFog, enableFogMask, setCameraBounds, setCameraField, setCameraPosition } from "wisp/game/view";
import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../gameApiLines";
import { floorMod } from "../../src/sim/intMath";
import { BOARD, CAMERA, GLOW, HIDDEN_Y, PHASES, PHASE_SECONDS, START_SECONDS, STATUS_FILE, TWIN } from "./layout";

export const GLOW_NOOPS = {
  FogEnable: "headless has no fog of war; the fixture turns it off so the real game shows the quads",
  FogMaskEnable: "headless has no black mask; the fixture turns it off so the real game shows the quads",
  BlzHideOriginFrames: "headless draws no game UI; the fixture hides it so the real game draws nothing over the board",
  SetCameraBounds: "headless has no camera bounds; the fixture pins the real camera over the quads",
};

function view(this: void): void {
  const { x, y } = CAMERA;
  setCameraBounds(x, y, x, y, x, y, x, y);
  setCameraField(CameraField.rotation, 90, 0);
  setCameraField(CameraField.angleOfAttack, CAMERA.angleOfAttack, 0);
  setCameraField(CameraField.roll, 0, 0);
  setCameraField(CameraField.targetDistance, CAMERA.distance, 0);
  setCameraField(CameraField.zOffset, 0, 0);
  setCameraField(CameraField.fieldOfView, CAMERA.fieldOfView, 0);
  setCameraField(CameraField.farZ, 5000, 0);
  setCameraPosition(x, y);
}

const hundredths = (value: number) => Math.floor(value * 100);

function cameraRow(this: void): string {
  return [CameraField.rotation, CameraField.angleOfAttack, CameraField.targetDistance, CameraField.fieldOfView, CameraField.zOffset].map((field) => hundredths(cameraField(field))).join(",");
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "glow6", readyPrefix: "GL_HRR", globalPrefix: "__glow6" });
}

export function start(this: void): void {
  install();
  enableFog(false);
  enableFogMask(false);
  hideOriginFrames(true);
  setFrameVisible(namedFrame("ConsoleUIBackdrop", 0), false);
  setPlayerColor(player(0), 0);
  view();
  createEffect(BOARD, CAMERA.x, CAMERA.y);
  const quad = (model: string) => {
    const created = createEffect(model, CAMERA.x, HIDDEN_Y);
    setEffectTeamColor(created, player(0));
    return created;
  };
  const glow = quad(GLOW), twin = quad(TWIN);
  const ground = createLocation(CAMERA.x, CAMERA.y);
  let step = 0;
  const show = function(this: void): void {
    const phase = PHASES[floorMod(step, PHASES.length)] ?? "hidden";
    view();
    setEffectPosition(glow, CAMERA.x, phase === "glow" ? CAMERA.y : HIDDEN_Y, 0);
    setEffectPosition(twin, CAMERA.x, phase === "twin" ? CAMERA.y : HIDDEN_Y, 0);
    writeLines(STATUS_FILE, [`phase=${phase}`, `step=${step}`, `width=${screenWidth()}`, `height=${screenHeight()}`,
      `color=${playerColor(player(0))}`, `ground=${hundredths(locationZ(ground))}`, `camera=${cameraRow()}`,
      `target=${hundredths(cameraTargetX())},${hundredths(cameraTargetY())},${hundredths(cameraTargetZ())}`,
      `eye=${hundredths(cameraEyeX())},${hundredths(cameraEyeY())},${hundredths(cameraEyeZ())}`]);
    step++;
  };
  const begin = createTimer();
  startTimer(begin, START_SECONDS, false, () => {
    destroyTimer(begin);
    show();
    startTimer(createTimer(), PHASE_SECONDS, true, show);
  });
}
