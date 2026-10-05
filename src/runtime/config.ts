/** File, synchronized-message and persistent-state identities shared across reloads. */
export interface RuntimeConfiguration {
  readonly filePrefix: string;
  /** Prefix of the synchronized messages in which clients answer each hot reload. */
  readonly readyPrefix: string;
  readonly globalPrefix: string;
  /**
   * Whether an error report is also displayed on screen as `error in HANDLER: ...`.
   * Default true. A shipped build sets false so players never read handler names or
   * script positions; the report still reaches the error file `wisp hot` reads.
   */
  readonly errorsOnScreen?: boolean;
}

let configuration: RuntimeConfiguration = {
  filePrefix: "wisp",
  readyPrefix: "WS_HRR",
  globalPrefix: "__wisp",
};

/** Call before installing handlers in every bundle. Retain these values across live reloads. */
export function configureRuntime(next: RuntimeConfiguration): void {
  configuration = next;
}

export function runtimeConfiguration(): RuntimeConfiguration {
  return configuration;
}
