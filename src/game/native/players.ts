import type { Events } from "../events";
import type { Player, PlayerControl, PlayerSlotState } from "../players";
import { asHandle, asNumber, fromValue } from "./types";
import { boundWorld } from "./world";

const slotOf = (player: Player): number => asNumber(player);

export function player(slot: number): Player {
  boundWorld().log?.("Player", [slot]);
  return fromValue<Player>(slot);
}

export function playerSlot(player: Player): number {
  boundWorld().log?.("GetPlayerId", [player]);
  return slotOf(player);
}

export function localPlayer(): Player {
  const world = boundWorld();
  world.log?.("GetLocalPlayer", []);
  return fromValue<Player>(world.players.local());
}

export function eventPlayer(): Player {
  const world = boundWorld();
  world.log?.("GetTriggerPlayer", []);
  return fromValue<Player>(world.events.triggerPlayer());
}

export function playerControl(player: Player): PlayerControl {
  const world = boundWorld();
  world.log?.("GetPlayerController", [player]);
  return fromValue<PlayerControl>(world.players.control(slotOf(player)));
}

export function playerSlotState(player: Player): PlayerSlotState {
  const world = boundWorld();
  world.log?.("GetPlayerSlotState", [player]);
  return fromValue<PlayerSlotState>(world.players.slotState(slotOf(player)));
}

export function playerName(player: Player): string {
  const world = boundWorld();
  world.log?.("GetPlayerName", [player]);
  return world.players.name(slotOf(player));
}

export function setPlayerColor(player: Player, color: number): void {
  const world = boundWorld();
  world.log?.("ConvertPlayerColor", [color]);
  world.log?.("SetPlayerColor", [player, color]);
  world.players.setColor(slotOf(player), color);
}

export function addLeaveEvent(events: Events, player: Player): void {
  const world = boundWorld();
  world.log?.("TriggerRegisterPlayerEvent", [events, player, "EVENT_PLAYER_LEAVE"]);
  world.events.registerLeave(asHandle(events), slotOf(player));
}
