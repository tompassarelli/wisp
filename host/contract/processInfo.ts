export interface ProcessInfo {

  readonly cpuMs?: number;
  readonly pid: number;

  readonly name: string;
  readonly args: readonly string[];

  readonly prefix?: string;
  readonly display?: string;
  readonly ownerUnit?: string;
  readonly proton?: ProtonRunner;
  readonly runtimeDir?: string;

  /** The prefix's runtime process (wineserver on Linux), as the process table's layer recognises it. */
  readonly runtime?: boolean;

  readonly cwd?: string;

  readonly started?: number;
}

export interface ProtonRunner {
  readonly pid: number;
  readonly command: string;
  readonly environment: Readonly<Record<string, string>>;
}
