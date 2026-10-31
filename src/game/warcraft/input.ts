import type { Lowering } from "./lowering";

export const input: Lowering = {
  osKey: "ConvertOsKeyType($1)",
  addKeyEvent: "BlzTriggerRegisterPlayerKeyEvent($1, $2, $3, $4, $5)",
  eventKey: "GetHandleId(BlzGetTriggerPlayerKey())",
  keyDown: "BlzIsKeyPressed($1)",
  windowFocused: "BlzIsLocalClientActive()",
  pointerX: "BlzGetMouseScreenPosX()",
  pointerY: "BlzGetMouseScreenPosY()",
  eventPointerX: "BlzGetTriggerPlayerMouseX()",
  eventPointerY: "BlzGetTriggerPlayerMouseY()",
  mouseDown: "BlzIsMouseButtonPressed($1)",
  setPointer: "BlzSetMousePos($1, $2)",
  showCursor: "BlzEnableCursor($1)",
  addChatEvent: "TriggerRegisterPlayerChatEvent($1, $2, $3, $4)",
  chatText: "GetEventPlayerChatString()",
  addPointerMoveEvent: "TriggerRegisterPlayerEvent($1, $2, EVENT_PLAYER_MOUSE_MOVE)",
  enableSelections: "BlzEnableSelections($1, $2)",
  enableUserControl: "EnableUserControl($1)",
};
