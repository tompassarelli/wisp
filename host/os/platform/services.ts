import { Context, type Effect, type Option, Schema } from "effect";
import type { ProcessInfo } from "../warcraft/battleNet";
import type { Client, ClientEntry, ClientsConfig, DesktopFailure, Region } from "../warcraft/desktopClient";
import type { InputAction } from "../warcraft/inputBatch";

export class PlatformUnsupported extends Schema.TaggedError<PlatformUnsupported>()("PlatformUnsupported", {
  capability: Schema.String,
  platform: Schema.String,
}) {
  override get message(): string {
    return `${this.capability} is not supported on this platform (${this.platform})`;
  }
}

export class PlatformFailure extends Schema.TaggedError<PlatformFailure>()("PlatformFailure", {
  capability: Schema.String,
  problem: Schema.String,
}) {
  override get message(): string {
    return `${this.capability}: ${this.problem}`;
  }
}

export type PlatformError = PlatformUnsupported | PlatformFailure;

export interface GameProcess {
  readonly pid: number;

  readonly exe: string;
}

export interface LauncherProcess {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;

  readonly runtime: string;
}

export class ProcessTable extends Context.Service<ProcessTable, {
  readonly list: Effect.Effect<readonly ProcessInfo[], PlatformUnsupported>;

  readonly games: (prefix: string) => Effect.Effect<readonly GameProcess[], PlatformUnsupported>;
  readonly launcher: (pid: number) => Effect.Effect<LauncherProcess, PlatformError>;
  readonly alive: (pid: number) => Effect.Effect<boolean, PlatformUnsupported>;
  readonly residentKiB: (pid: number) => Effect.Effect<number, PlatformUnsupported>;

  readonly networkInterfaces: (pid: number) => Effect.Effect<readonly string[], PlatformError>;
}>()("wisp/platform/ProcessTable") {}

export interface CpuPressure {

  readonly avg10: number;

  readonly totalUs: number;
}

export class ResourceAccounting extends Context.Service<ResourceAccounting, {

  readonly cpuPressure: () => CpuPressure | undefined;

  readonly cpuLimit: () => number | undefined;
  readonly insideCapacityLease: () => boolean;
  readonly threadCpuMillis: () => number;
}>()("wisp/platform/ResourceAccounting") {}

export type ServiceOwner = { readonly unit: string } | { readonly pid: number; readonly command: string };

export interface ServiceState {
  readonly active: string;
  readonly since: string;
  readonly pid: number;
}

export class BackgroundServices extends Context.Service<BackgroundServices, {
  readonly start: (unit: string, command: readonly string[], log?: string) => Effect.Effect<void, PlatformError>;
  readonly state: (unit: string) => Effect.Effect<ServiceState, PlatformError>;
  readonly stop: (unit: string) => Effect.Effect<void, PlatformError>;
  readonly owner: (pid: number) => Effect.Effect<ServiceOwner | undefined, PlatformUnsupported>;
}>()("wisp/platform/BackgroundServices") {}

export interface PrefixLaunch {

  readonly root: string;
  readonly exe: string;
  readonly args: readonly string[];
  readonly appId: string;

  readonly isolateNetwork?: boolean;

  readonly sessionBus?: boolean;
}

export class GameLauncher extends Context.Service<GameLauncher, {

  readonly inPrefix: (launch: PrefixLaunch) => Effect.Effect<{ readonly command: readonly string[]; readonly env: Readonly<Record<string, string>> }, PlatformUnsupported>;
}>()("wisp/platform/GameLauncher") {}

export type Namespace = "user" | "net" | "mount";

export class Namespaces extends Context.Service<Namespaces, {

  readonly offline: (command: readonly string[]) => Effect.Effect<readonly string[], PlatformUnsupported>;
  readonly enter: (pid: number, namespaces: readonly Namespace[], command: readonly string[], options?: { readonly workingDirectory?: string; readonly keepCapabilities?: boolean }) => Effect.Effect<readonly string[], PlatformUnsupported>;
}>()("wisp/platform/Namespaces") {}

export class AudioIsolation extends Context.Service<AudioIsolation, {

  readonly sink: (name: string, sinkName: string) => Effect.Effect<{ readonly env: Readonly<Record<string, string>>; readonly problem?: string }>;
}>()("wisp/platform/AudioIsolation") {}

export class CapacityAdmission extends Context.Service<CapacityAdmission, {
  readonly session: (helper: string, owner: string, memoryGib?: number) => Effect.Effect<readonly string[], PlatformUnsupported>;
  readonly signalLease: (lease: string, signal: "SIGTERM" | "SIGKILL") => Effect.Effect<void, PlatformError>;
  readonly leaseLive: (lease: string) => Effect.Effect<boolean, PlatformError>;
}>()("wisp/platform/CapacityAdmission") {}

/** A decoded capture: ScreenCapture frames are binary PPM (P6) bytes. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
}

const PPM_HEADER = /^P6\s+(\d+)\s+(\d+)\s+255\s/;

export function decodePpm(bytes: Uint8Array): Frame | undefined {
  const header = PPM_HEADER.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 32)));
  if (header === null) return undefined;
  const width = Number(header[1]);
  const height = Number(header[2]);
  const rgb = bytes.subarray(header[0].length);
  return rgb.length < width * height * 3 ? undefined : { width, height, rgb };
}

export function encodePpm({ width, height, rgb }: Frame): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  const bytes = new Uint8Array(header.length + width * height * 3);
  bytes.set(header);
  bytes.set(rgb.subarray(0, width * height * 3), header.length);
  return bytes;
}

export class ScreenCapture extends Context.Service<ScreenCapture, {

  readonly frame: (client: Client, region?: Region) => Effect.Effect<Uint8Array, DesktopFailure>;
}>()("wisp/platform/ScreenCapture") {}

export interface WindowTools {
  readonly place: (env: Readonly<Record<string, string>>, title: string, place: Region) => Effect.Effect<number>;
  readonly shown: (env: Readonly<Record<string, string>>, title: string) => Effect.Effect<boolean, DesktopFailure>;
  /** Whether the session's compositor lists a toplevel titled `title`, which focusing the game window needs; fails when it can't be asked. */
  readonly listed: (env: Readonly<Record<string, string>>, title: string) => Effect.Effect<boolean, DesktopFailure>;
}

export class InputInjection extends Context.Service<InputInjection, {
  readonly tools: Effect.Effect<Client["tools"], PlatformUnsupported>;
  readonly windows: (config: ClientsConfig, entry: ClientEntry, title: string, strict: boolean) => Effect.Effect<readonly Client[], DesktopFailure>;

  readonly sessionEnvironment: (run: string) => Readonly<Record<string, string>>;

  readonly windowTools: Effect.Effect<Option.Option<WindowTools>>;
  readonly display: (entry: ClientEntry) => Effect.Effect<string, DesktopFailure>;
  readonly preflight: (client: Client) => Effect.Effect<void, DesktopFailure>;
  readonly focus: (client: Client, title: string, strict: boolean) => Effect.Effect<void, DesktopFailure>;
  readonly activeWindow: (client: Client) => Effect.Effect<string, DesktopFailure>;
  readonly windowRegion: (client: Client) => Effect.Effect<Region, DesktopFailure>;
  readonly windowPid: (client: Client) => Effect.Effect<number, DesktopFailure>;
  readonly keys: (client: Client, names: readonly string[]) => Effect.Effect<void, DesktopFailure>;
  readonly pressKeys: (client: Client, names: readonly string[], operation: string) => Effect.Effect<void, DesktopFailure>;
  readonly typeText: (client: Client, value: string, delayMillis?: number) => Effect.Effect<void, DesktopFailure>;

  readonly typeSecret: (client: Client, secret: Uint8Array) => Effect.Effect<void, DesktopFailure>;
  readonly pressAt: (client: Client, x: number, y: number) => Effect.Effect<void, DesktopFailure>;
  readonly batch: (client: Client, actions: readonly InputAction[]) => Effect.Effect<void, DesktopFailure>;
}>()("wisp/platform/InputInjection") {}

export class PageOpener extends Context.Service<PageOpener, {
  readonly open: (url: string) => Effect.Effect<void, PlatformError>;
}>()("wisp/platform/PageOpener") {}

export type Platform = ScreenCapture | InputInjection | ProcessTable | ResourceAccounting | BackgroundServices | GameLauncher | Namespaces | AudioIsolation | CapacityAdmission | PageOpener;
