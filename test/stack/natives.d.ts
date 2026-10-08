/** @noSelfInFile */
declare interface player { readonly __player: unique symbol }
declare function GetLocalPlayer(): player;
declare function GetPlayerId(whichPlayer: player): number;
declare function DisplayTextToPlayer(toPlayer: player, x: number, y: number, message: string): void;
declare function Preload(filename: string): void;
declare function PreloadGenClear(): void;
declare function PreloadGenStart(): void;
declare function PreloadGenEnd(filename: string): void;
