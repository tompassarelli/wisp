import type { Players } from "../../game/native/playerStore";
import type { NativeBehavior } from "../clientTypes";

export function playerNatives(players: Players): Readonly<Record<string, NativeBehavior>> {
  return {
    GetLocalPlayer: () => players.local(),
    Player: (slot: number) => slot,
    GetPlayerId: (player: number) => player,
    GetPlayerName: (player: number) => players.name(player),
    GetPlayerController: (player: number) => players.control(player),
    GetPlayerSlotState: (player: number) => players.slotState(player),
    SetPlayerColor: (player: number, color: unknown) => { players.setColor(player, color); },
  };
}
