import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/map/fileio";
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
  SetCameraBounds(x, y, x, y, x, y, x, y);
  SetCameraField(CAMERA_FIELD_ROTATION, 90, 0);
  SetCameraField(CAMERA_FIELD_ANGLE_OF_ATTACK, CAMERA.angleOfAttack, 0);
  SetCameraField(CAMERA_FIELD_ROLL, 0, 0);
  SetCameraField(CAMERA_FIELD_TARGET_DISTANCE, CAMERA.distance, 0);
  SetCameraField(CAMERA_FIELD_ZOFFSET, 0, 0);
  SetCameraField(CAMERA_FIELD_FIELD_OF_VIEW, CAMERA.fieldOfView, 0);
  SetCameraField(CAMERA_FIELD_FARZ, 5000, 0);
  SetCameraPosition(x, y);
}

const hundredths = (value: number) => Math.floor(value * 100);

function cameraRow(this: void): string {
  return [CAMERA_FIELD_ROTATION, CAMERA_FIELD_ANGLE_OF_ATTACK, CAMERA_FIELD_TARGET_DISTANCE, CAMERA_FIELD_FIELD_OF_VIEW, CAMERA_FIELD_ZOFFSET].map((field) => hundredths(GetCameraField(field))).join(",");
}

export function install(this: void): void {
  configureRuntime({ filePrefix: "glow6", readyPrefix: "GL_HRR", globalPrefix: "__glow6" });
}

export function start(this: void): void {
  install();
  FogEnable(false);
  FogMaskEnable(false);
  BlzHideOriginFrames(true);
  BlzFrameSetVisible(BlzGetFrameByName("ConsoleUIBackdrop", 0), false);
  SetPlayerColor(Player(0), PLAYER_COLOR_RED);
  view();
  AddSpecialEffect(BOARD, CAMERA.x, CAMERA.y);
  const quad = (model: string) => {
    const created = AddSpecialEffect(model, CAMERA.x, HIDDEN_Y);
    BlzSetSpecialEffectColorByPlayer(created, Player(0));
    return created;
  };
  const glow = quad(GLOW), twin = quad(TWIN);
  const ground = Location(CAMERA.x, CAMERA.y);
  let step = 0;
  const show = function(this: void): void {
    const phase = PHASES[floorMod(step, PHASES.length)] ?? "hidden";
    view();
    BlzSetSpecialEffectPosition(glow, CAMERA.x, phase === "glow" ? CAMERA.y : HIDDEN_Y, 0);
    BlzSetSpecialEffectPosition(twin, CAMERA.x, phase === "twin" ? CAMERA.y : HIDDEN_Y, 0);
    writeLines(STATUS_FILE, [`phase=${phase}`, `step=${step}`, `width=${BlzGetLocalClientWidth()}`, `height=${BlzGetLocalClientHeight()}`,
      `color=${GetHandleId(GetPlayerColor(Player(0)))}`, `ground=${hundredths(GetLocationZ(ground))}`, `camera=${cameraRow()}`,
      `target=${hundredths(GetCameraTargetPositionX())},${hundredths(GetCameraTargetPositionY())},${hundredths(GetCameraTargetPositionZ())}`,
      `eye=${hundredths(GetCameraEyePositionX())},${hundredths(GetCameraEyePositionY())},${hundredths(GetCameraEyePositionZ())}`]);
    step++;
  };
  TimerStart(CreateTimer(), START_SECONDS, false, () => {
    DestroyTimer(GetExpiredTimer());
    show();
    TimerStart(CreateTimer(), PHASE_SECONDS, true, show);
  });
}
