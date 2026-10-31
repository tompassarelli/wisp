import type { Opaque } from "./opaque";

export type Timer = Opaque<"Timer">;
export type GameSpeed = Opaque<"GameSpeed">;

export declare const GameSpeed: {
  readonly slowest: GameSpeed;
  readonly slow: GameSpeed;
  readonly normal: GameSpeed;
  readonly fast: GameSpeed;
  readonly fastest: GameSpeed;
};

export declare function createTimer(): Timer;
export declare function startTimer(timer: Timer, seconds: number, periodic: boolean, handler: (this: void) => void): void;
export declare function pauseTimer(timer: Timer): void;
export declare function destroyTimer(timer: Timer): void;
/** @local */
export declare function localElapsed(timer: Timer): number;
export declare function setNormalSpeed(): void;
export declare function lockSpeed(): void;
/** @local */
export declare function gameSpeed(): GameSpeed;
export declare function restartMatch(scoreScreen: boolean): void;
