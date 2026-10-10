export interface RuntimeConfiguration {
  readonly filePrefix: string;

  readonly readyPrefix: string;
  readonly globalPrefix: string;

  readonly errorsOnScreen?: boolean;
}

let configuration: RuntimeConfiguration = {
  filePrefix: "wisp",
  readyPrefix: "WS_HRR",
  globalPrefix: "__wisp",
};

export function configureRuntime(next: RuntimeConfiguration): void {
  configuration = next;
}

export function runtimeConfiguration(): RuntimeConfiguration {
  return configuration;
}
