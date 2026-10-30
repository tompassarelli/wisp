/** The module and export a worker thread imports to get the game, which cannot cross threads as an object. */
export interface NativeGameModule {
  readonly module: string;
  readonly export: string;
}

/** The parts of a run's options the worker thread's player reads. */
export interface WorkerPlayOptions {
  readonly script?: string;
  readonly frames?: number;
  readonly out?: string;
  readonly captureFrames?: readonly number[];
  readonly recordChecksums?: boolean;
  readonly gamepadIndex?: number;
}

export interface SimWorkerInit {
  readonly type: "init";
  readonly game: NativeGameModule;
  readonly options: WorkerPlayOptions;
  readonly library?: string | undefined;
  readonly box: SharedArrayBuffer;
  /** A measured run: its figures include the raw series, the log carries markers around the measured frames and `readAsset` is timed. */
  readonly probe?: { readonly frames: number; readonly warmupFrames: number } | undefined;
}

export type SimWorkerMessage =
  | { readonly type: "ready" }
  | { readonly type: "completed"; readonly result: Readonly<Record<string, unknown>> }
  | { readonly type: "failed"; readonly problem: string };

export interface SimWorkerAttach {
  readonly type: "attach";
  readonly handle: number;
}
