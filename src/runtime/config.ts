/** File, synchronized-message and persistent-state identities shared across reloads. */
export interface RuntimeConfiguration {
  readonly filePrefix: string;
  readonly announcePrefix: string;
  readonly readyPrefix: string;
  readonly globalPrefix: string;
}

let configuration: RuntimeConfiguration = {
  filePrefix: "wisp",
  announcePrefix: "WS_HR",
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
