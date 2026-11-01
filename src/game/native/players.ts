import type { Events } from "../events";
import type { Player, PlayerControl as PlayerControlType, PlayerSlotState as PlayerSlotStateType } from "../players";
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

export function playerControl(player: Player): PlayerControlType {
  const world = boundWorld();
  world.log?.("GetPlayerController", [player]);
  return fromValue<PlayerControlType>(world.players.control(slotOf(player)));
}

export function playerSlotState(player: Player): PlayerSlotStateType {
  const world = boundWorld();
  world.log?.("GetPlayerSlotState", [player]);
  return fromValue<PlayerSlotStateType>(world.players.slotState(slotOf(player)));
}

export function playerName(player: Player): string {
  const world = boundWorld();
  world.log?.("GetPlayerName", [player]);
  return world.players.name(slotOf(player));
}

export function connectionRoundTripMs(player: Player): number {
  const world = boundWorld();
  world.log?.("ConnectionRoundTripMs", [player]);
  return world.players.roundTripMs(slotOf(player));
}

export function setPlayerColor(player: Player, color: number): void {
  const world = boundWorld();
  world.log?.("ConvertPlayerColor", [color]);
  world.log?.("SetPlayerColor", [player, color]);
  world.players.setColor(slotOf(player), color);
}

export function playerColor(player: Player): number {
  const world = boundWorld();
  world.log?.("GetPlayerColor", [player]);
  const color = world.players.color(slotOf(player));
  const index = typeof color === "number" ? color : slotOf(player);
  world.log?.("GetHandleId", [index]);
  return index;
}

export function addLeaveEvent(events: Events, player: Player): void {
  const world = boundWorld();
  world.log?.("TriggerRegisterPlayerEvent", [events, player, "EVENT_PLAYER_LEAVE"]);
  world.events.registerLeave(asHandle(events), slotOf(player));
}

export const PlayerControl = {
  user: fromValue<PlayerControlType>("MAP_CONTROL_USER"),
  computer: fromValue<PlayerControlType>("MAP_CONTROL_COMPUTER"),
};

export const PlayerSlotState = {
  playing: fromValue<PlayerSlotStateType>("PLAYER_SLOT_STATE_PLAYING"),
};
