import { Context, type Effect, type Option, Schema } from "effect";
import type { ProcessInfo } from "../warcraft/battleNet";
import type { Client, ClientEntry, ClientsConfig, DesktopFailure, InputAction, Region } from "../warcraft/desktop";

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
  readonly enter: (pid: number, namespaces: readonly Namespace[], command: readonly string[], workingDirectory?: string) => Effect.Effect<readonly string[], PlatformUnsupported>;
}>()("wisp/platform/Namespaces") {}

export class AudioIsolation extends Context.Service<AudioIsolation, {

  readonly sink: (name: string, sinkName: string) => Effect.Effect<{ readonly env: Readonly<Record<string, string>>; readonly problem?: string }>;
}>()("wisp/platform/AudioIsolation") {}

export interface AdmissionProbe {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class CapacityAdmission extends Context.Service<CapacityAdmission, {
  readonly probe: (helper: string, memoryGib: number) => Effect.Effect<AdmissionProbe, PlatformError>;
  readonly session: (helper: string, owner: string, memoryGib?: number) => Effect.Effect<readonly string[], PlatformUnsupported>;
}>()("wisp/platform/CapacityAdmission") {}

export class ScreenCapture extends Context.Service<ScreenCapture, {

  readonly frame: (client: Client, region?: Region) => Effect.Effect<Uint8Array, DesktopFailure>;
}>()("wisp/platform/ScreenCapture") {}

export type WindowPlacer = (env: Readonly<Record<string, string>>, title: string, place: Region) => Effect.Effect<number>;

export class InputInjection extends Context.Service<InputInjection, {
  readonly windows: (config: ClientsConfig, entry: ClientEntry, title: string, strict: boolean) => Effect.Effect<readonly Client[], DesktopFailure>;

  readonly sessionEnvironment: (run: string) => Readonly<Record<string, string>>;

  readonly placer: Effect.Effect<Option.Option<WindowPlacer>>;
  readonly display: (entry: ClientEntry) => Effect.Effect<string, DesktopFailure>;
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

export type Platform = ScreenCapture | InputInjection | ProcessTable | ResourceAccounting | BackgroundServices | GameLauncher | Namespaces | AudioIsolation | CapacityAdmission;
