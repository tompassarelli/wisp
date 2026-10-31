import type { Events } from "./events";
import type { Player } from "./players";

export type OsKey = oskeytype;
export type MouseButton = mousebuttontype;

export declare function osKey(code: number): OsKey;
export declare function addKeyEvent(events: Events, player: Player, key: OsKey, modifiers: number, down: boolean): void;
export declare function eventKey(): number;
/** @local */
export declare function keyDown(key: OsKey): boolean;
/** @local */
export declare function windowFocused(): boolean;
/** @local */
export declare function pointerX(): number;
/** @local */
export declare function pointerY(): number;
export declare function eventPointerX(): number;
export declare function eventPointerY(): number;
/** @local */
export declare function mouseDown(button: MouseButton): boolean;
/** @local */
export declare function setPointer(x: number, y: number): void;
/** @local */
export declare function showCursor(shown: boolean): void;
export declare function addChatEvent(events: Events, player: Player, text: string, exact: boolean): void;
export declare function chatText(): string;
export declare function addPointerMoveEvent(events: Events, player: Player): void;
export declare function enableSelections(selection: boolean, only: boolean): void;
export declare function enableUserControl(enabled: boolean): void;
