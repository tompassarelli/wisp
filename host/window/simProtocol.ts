/**
 * The module and export a worker thread imports to get the game, which cannot cross threads as an object. The export is the game, or a
 * function from `arguments` to the game, which is how the worker builds it with the flags the player ran with (`--map MAP.w3x --player-assets-only`)
 * and so reads the same map imports and Warcraft files the main thread's game does.
 */
export interface NativeGameModule {
  readonly module: string;
  readonly export: string;
  readonly arguments?: readonly string[];
}

/** The parts of a run's options the worker thread's player reads. */
export interface WorkerPlayOptions {
  readonly script?: string;
  readonly frames?: number;
  readonly out?: string;
  readonly captureFrames?: readonly number[];
  readonly recordChecksums?: boolean;
  readonly gamepadIndex?: number;
  readonly emulatedCalls?: string;
}

export interface SimWorkerInit {
  readonly type: "init";
  readonly game: NativeGameModule;
  readonly options: WorkerPlayOptions;
  readonly library?: string | undefined;
  /** A measured run: its figures include the raw series, the log carries markers around the measured frames and `readAsset` is timed. */
  readonly probe?: { readonly frames: number; readonly warmupFrames: number } | undefined;
}

export type SimWorkerMessage =
  | { readonly type: "ready" }
  | { readonly type: "closed" }
  | { readonly type: "completed"; readonly result: Readonly<Record<string, unknown>> }
  | { readonly type: "failed"; readonly problem: string };

export interface SimWorkerAttach {
  readonly type: "attach";
  /** A reference to the window that `NativeWindow.lend` took for the worker, which releases it when it stops. */
  readonly handle: number;
}
