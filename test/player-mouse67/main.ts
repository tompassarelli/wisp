import { configureRuntime } from "../../src/runtime/config";
import { writeLines } from "../../src/map/fileio";
import { PLAYER_MOUSE_REPORT_SECONDS } from "./journey";

export function install(this: void): void {
  configureRuntime({ filePrefix: "mouse", readyPrefix: "PM67_HRR", globalPrefix: "__mouse" });
}

function buttonName(this: void, button: mousebuttontype): string {
  if (button === MOUSE_BUTTON_TYPE_LEFT) return "left";
  if (button === MOUSE_BUTTON_TYPE_MIDDLE) return "middle";
  return button === MOUSE_BUTTON_TYPE_RIGHT ? "right" : "none";
}

export function playerMouseRows(this: void, done: (this: void, rows: readonly string[]) => void): void {
  const rows: string[] = [];
  let frame = 0;
  TimerStart(CreateTimer(), 1.0 / 60.0, true, () => {
    frame++;
  });
  const at = (name: string) => `frame=${frame} player=${GetPlayerId(GetTriggerPlayer())} ${name} x=${R2I(BlzGetTriggerPlayerMouseX() * 4.0)} y=${R2I(BlzGetTriggerPlayerMouseY() * 4.0)}`;
  for (let player = 0; player < 2; player++) {
    const moved = CreateTrigger();
    TriggerRegisterPlayerEvent(moved, Player(player), EVENT_PLAYER_MOUSE_MOVE);
    TriggerAddAction(moved, () => {
      rows.push(at("move"));
    });
    for (const [name, event] of [["down", EVENT_PLAYER_MOUSE_DOWN], ["up", EVENT_PLAYER_MOUSE_UP]] as const) {
      const pressed = CreateTrigger();
      TriggerRegisterPlayerEvent(pressed, Player(player), event);
      TriggerAddAction(pressed, () => {
        const position = BlzGetTriggerPlayerMousePosition();
        rows.push(`${at(name)} button=${buttonName(BlzGetTriggerPlayerMouseButton())} position=${R2I(GetLocationX(position) * 4.0)},${R2I(GetLocationY(position) * 4.0)}`);
        RemoveLocation(position);
      });
    }
  }
  TimerStart(CreateTimer(), PLAYER_MOUSE_REPORT_SECONDS, false, () => done(rows));
}

export function start(this: void): void {
  install();
  playerMouseRows(rows => writeLines(`player-mouse-p${GetPlayerId(GetLocalPlayer())}.txt`, rows));
}
