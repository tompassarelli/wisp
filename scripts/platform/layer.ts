import { Effect, Layer } from "effect";
import { DesktopFailure } from "../warcraft/desktop";
import { linuxLayer } from "./linux/layer";
import {
  AudioIsolation, BackgroundServices, CapacityAdmission, GameLauncher, InputInjection, Namespaces, type Platform, PlatformUnsupported, ProcessTable,
  ResourceAccounting, ScreenCapture,
} from "./services";

export const hostPlatform = () => process.platform;

export const unsupportedLayer = (platform: string): Layer.Layer<Platform> => {
  const refuse = (capability: string) => Effect.fail(new PlatformUnsupported({ capability, platform }));
  const desktop = (capability: string) => (client: { readonly name: string }) =>
    Effect.fail(new DesktopFailure({ operation: capability, client: client.name, cause: new PlatformUnsupported({ capability, platform }) }));
  return Layer.mergeAll(
    Layer.succeed(ProcessTable, ProcessTable.of({
      list: refuse("process discovery"),
      games: () => refuse("process discovery"),
      launcher: () => refuse("process discovery"),
      alive: () => refuse("process discovery"),
      residentKiB: () => refuse("process accounting"),
      networkInterfaces: () => refuse("network namespace inspection"),
    })),
    Layer.succeed(ResourceAccounting, ResourceAccounting.of({
      cpuPressure: () => undefined,
      cpuLimit: () => undefined,
      insideCapacityLease: () => false,
      childCpuSeconds: () => undefined,
      threadCpuMillis: () => {
        const { user, system } = process.cpuUsage();
        return (user + system) / 1000;
      },
    })),
    Layer.succeed(BackgroundServices, BackgroundServices.of({
      start: () => refuse("background services"),
      state: () => refuse("background services"),
      stop: () => refuse("background services"),
      owner: () => refuse("background services"),
    })),
    Layer.succeed(GameLauncher, GameLauncher.of({ inPrefix: () => refuse("game launch") })),
    Layer.succeed(Namespaces, Namespaces.of({ offline: () => refuse("network isolation"), enter: () => refuse("process namespaces") })),
    Layer.succeed(AudioIsolation, AudioIsolation.of({ sink: (name) => Effect.succeed({ env: {}, problem: `${name}: audio isolation is not supported on this platform (${platform}); it shares the default output` }) })),
    Layer.succeed(CapacityAdmission, CapacityAdmission.of({ probe: () => refuse("capacity admission"), session: () => refuse("capacity admission") })),
    Layer.succeed(ScreenCapture, ScreenCapture.of({ frame: desktop("screen capture") })),
    Layer.succeed(InputInjection, InputInjection.of({
      windows: (_config, entry) => desktop("input injection")(entry),
      sessionEnvironment: () => ({}),
      placer: Effect.succeedNone,
      display: desktop("input injection"),
      focus: desktop("input injection"),
      activeWindow: desktop("input injection"),
      windowRegion: desktop("input injection"),
      windowPid: desktop("input injection"),
      keys: desktop("input injection"),
      pressKeys: desktop("input injection"),
      typeText: desktop("input injection"),
      typeSecret: desktop("input injection"),
      pressAt: desktop("input injection"),
      batch: desktop("input injection"),
    })),
  );
};

export const platformLayer = (platform: string = hostPlatform()): Layer.Layer<Platform> => (platform === "linux" ? linuxLayer : unsupportedLayer(platform));

export const runPlatformSync = <A, E>(effect: Effect.Effect<A, E, Platform>, platform?: string): A => Effect.runSync(effect.pipe(Effect.provide(platformLayer(platform))));
