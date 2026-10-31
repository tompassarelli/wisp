import type { Lowering } from "./lowering";

export const players: Lowering = {
  player: "Player($1)",
  playerSlot: "GetPlayerId($1)",
  localPlayer: "GetLocalPlayer()",
  eventPlayer: "GetTriggerPlayer()",
  playerControl: "GetPlayerController($1)",
  playerSlotState: "GetPlayerSlotState($1)",
  playerName: "GetPlayerName($1)",
  setPlayerColor: "SetPlayerColor($1, ConvertPlayerColor($2))",
  addLeaveEvent: "TriggerRegisterPlayerEvent($1, $2, EVENT_PLAYER_LEAVE)",
};
