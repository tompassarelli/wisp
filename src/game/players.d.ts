import type { Events } from "./events";
import type { Opaque } from "./opaque";

export type Player = Opaque<"Player">;
export type PlayerControl = Opaque<"PlayerControl">;
export type PlayerSlotState = Opaque<"PlayerSlotState">;

export declare const PlayerControl: {
  readonly user: PlayerControl;
  readonly computer: PlayerControl;
};

export declare const PlayerSlotState: {
  readonly playing: PlayerSlotState;
};

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
