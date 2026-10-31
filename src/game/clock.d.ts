export type Timer = timer;
export type GameSpeed = gamespeed;

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
