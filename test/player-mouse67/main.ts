import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/map/fileio";

export const PLAYER_MOUSE_SECONDS = 0.5;

export function install(this: void): void {
  configureRuntime({ filePrefix: "player-mouse67", readyPrefix: "PM67_HRR", globalPrefix: "__playerMouse67" });
}

const buttonName = (button: mousebuttontype) =>
  button === MOUSE_BUTTON_TYPE_LEFT ? "left" : button === MOUSE_BUTTON_TYPE_MIDDLE ? "middle" : button === MOUSE_BUTTON_TYPE_RIGHT ? "right" : "none";

export function start(this: void): void {
  install();
  const lines: string[] = [];
  let frame = 0;
  TimerStart(CreateTimer(), 1.0 / 60.0, true, () => {
    frame++;
  });
  const events: readonly (readonly [string, playerevent])[] = [["move", EVENT_PLAYER_MOUSE_MOVE], ["down", EVENT_PLAYER_MOUSE_DOWN], ["up", EVENT_PLAYER_MOUSE_UP]];
  for (const [name, event] of events) {
    const trigger = CreateTrigger();
    for (let player = 0; player < 2; player++) TriggerRegisterPlayerEvent(trigger, Player(player), event);
    TriggerAddAction(trigger, () => {
      const at = BlzGetTriggerPlayerMousePosition();
      const button = name === "move" ? "" : ` button=${buttonName(BlzGetTriggerPlayerMouseButton())}`;
      lines.push(`frame=${frame} ${name} player=${GetPlayerId(GetTriggerPlayer())} x=${R2S(BlzGetTriggerPlayerMouseX())} y=${R2S(BlzGetTriggerPlayerMouseY())}`
        + ` at=${R2S(GetLocationX(at))},${R2S(GetLocationY(at))}${button}`);
      RemoveLocation(at);
    });
  }
  TimerStart(CreateTimer(), PLAYER_MOUSE_SECONDS, false, () => writeLines(`player-mouse67-p${GetPlayerId(GetLocalPlayer())}.txt`, lines));
}
