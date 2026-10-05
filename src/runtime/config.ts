/** File, synchronized-message and persistent-state identities shared across reloads. */
export interface RuntimeConfiguration {
  readonly filePrefix: string;
  readonly announcePrefix: string;
  readonly readyPrefix: string;
  readonly globalPrefix: string;
}

let configuration: RuntimeConfiguration = {
  filePrefix: "waygate",
  announcePrefix: "WG_HR",
  readyPrefix: "WG_HRR",
  globalPrefix: "__waygate",
};

/** Call before installing handlers in every bundle. Retain these values across live reloads. */
export function configureRuntime(next: RuntimeConfiguration): void {
  configuration = next;
}

export function runtimeConfiguration(): RuntimeConfiguration {
  return configuration;
}
