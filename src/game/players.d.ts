import type { Events } from "./events";

export type Player = player;
export type PlayerControl = mapcontrol;
export type PlayerSlotState = playerslotstate;

export declare function player(slot: number): Player;
export declare function playerSlot(player: Player): number;

/** @local */
export declare function localPlayer(): Player;
export declare function eventPlayer(): Player;
export declare function playerControl(player: Player): PlayerControl;
export declare function playerSlotState(player: Player): PlayerSlotState;
export declare function playerName(player: Player): string;
export declare function setPlayerColor(player: Player, color: number): void;
export declare function addLeaveEvent(events: Events, player: Player): void;
