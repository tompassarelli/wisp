/** @local */
export declare function clearFileLines(): void;
/** @local */
export declare function startFile(): void;
/** @local */
export declare function addFileLine(text: string): void;
/** @local */
export declare function endFile(path: string): void;
/** @local Asks the game to load the model, texture or sound at `path` ahead of its first use; it writes no file. */
export declare function preloadAsset(path: string): void;
