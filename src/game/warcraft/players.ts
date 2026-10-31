import type { ConstantLowering, Lowering } from "./lowering";

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

export const playersConstants: ConstantLowering = {
  PlayerControl: {
    user: "MAP_CONTROL_USER",
    computer: "MAP_CONTROL_COMPUTER",
  },
  PlayerSlotState: {
    playing: "PLAYER_SLOT_STATE_PLAYING",
  },
};
