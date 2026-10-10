import { existsSync } from "node:fs";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { collect } from "../../wisp/hostProcess";
import {
  AudioIsolation, BackgroundServices, CapacityAdmission, GameLauncher, Namespaces, PlatformFailure, ProcessTable, ResourceAccounting,
} from "../services";
import { linuxDesktopLayer } from "./desktop";
import * as procfs from "./procfs";
import { startUnit, stopUnit, unitState } from "./systemd";

const failure = (capability: string) => (cause: unknown) =>
  new PlatformFailure({ capability, problem: typeof cause === "object" && cause !== null && "problem" in cause ? String(cause.problem) : cause instanceof Error ? cause.message : String(cause) });

const steam = () => join(process.env["HOME"] ?? "", ".local/share/Steam");
const PROTON = "compatibilitytools.d/GE-Proton11-7-x86_64/proton";
const STEAM_RUNTIME = "steamapps/common/SteamLinuxRuntime_4/_v2-entry-point";

const OFFLINE = ["bwrap", "--dev-bind", "/", "/", "--unshare-net", "--die-with-parent", "--"];

const NAMESPACE_FLAGS = { user: ["--user"], net: ["--net"], mount: ["--mount"] } as const;

const userRuntime = () => `/run/user/${process.getuid?.() ?? 1000}`;

const quiet = (command: string, args: readonly string[], env: Record<string, string>) =>
  ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.string(ChildProcess.make(command, args, { env, extendEnv: true, stderr: "ignore" }))).pipe(
    Effect.timeout("5 seconds"),
    Effect.orElseSucceed(() => ""),
  );

const audio = Layer.effect(AudioIsolation, Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return AudioIsolation.of({
    sink: (name, sink) => Effect.gen(function*() {
      const pulse = join(userRuntime(), "pulse/native");
      if (!existsSync(pulse)) return { env: {} };
      const pw = { XDG_RUNTIME_DIR: userRuntime() };
      const nodes = yield* quiet("pw-dump", [], pw);
      if (!nodes.includes(`"node.name": "${sink}"`)) {
        const made = yield* Effect.scoped(Effect.gen(function*() {
          const child = yield* ChildProcess.make("pw-cli", ["create-node", "adapter", `{ factory.name=support.null-audio-sink node.name=${sink} node.description="Wisp ${name}" media.class=Audio/Sink object.linger=true audio.position=[ FL FR ] priority.session=0 priority.driver=0 }`], { env: pw, extendEnv: true, stdout: "ignore" });
          const [said, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(child.stderr)), child.exitCode], { concurrency: 2 });
          return { said, code };
        })).pipe(Effect.timeout("5 seconds"), Effect.orElseSucceed(() => ({ said: "pw-cli failed", code: 1 })));
        if (made.code !== 0) return { env: {}, problem: `no sink for ${name} (${made.said.trim()}): it runs without sound` };
      }
      return { env: { PULSE_SERVER: `unix:${pulse}`, PULSE_SINK: sink } };
    }).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)),
  });
}));

const admission = Layer.effect(CapacityAdmission, Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return CapacityAdmission.of({
    probe: (helper, memoryGib) => collect(ChildProcess.make(process.execPath, [helper, "probe", "--class", "native", "--memory-gib", String(memoryGib)], { stdin: "ignore" })).pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.map(({ exitCode, stdout, stderr }) => ({ exitCode, stdout: new TextDecoder().decode(stdout), stderr })),
      Effect.mapError(failure("capacity admission")),
    ),
    session: (helper, owner, memoryGib) => Effect.succeed([
      process.execPath, helper, "session", "--class", "native", ...(memoryGib === undefined ? [] : ["--memory-gib", String(memoryGib)]), "--owner", owner, "--",
    ]),
  });
}));

const synchronous = Layer.mergeAll(
  Layer.succeed(ProcessTable, ProcessTable.of({
    list: Effect.sync(procfs.listProcesses),
    games: (prefix) => Effect.sync(() => procfs.findGameProcesses(prefix)),
    launcher: (pid) => Effect.try({ try: () => procfs.launcherProcess(pid), catch: failure("process discovery") }),
    alive: (pid) => Effect.sync(() => procfs.alive(pid)),
    residentKiB: (pid) => Effect.sync(() => procfs.residentKiB(pid)),
    networkInterfaces: (pid) => Effect.try({ try: () => procfs.networkInterfaces(pid), catch: failure(`pid ${pid}'s network namespace`) }),
  })),
  Layer.sync(ResourceAccounting, () => {
    let clock: (() => number) | undefined;
    return ResourceAccounting.of({
      cpuPressure: procfs.cpuPressure,
      cpuLimit: procfs.cpuLimit,
      insideCapacityLease: procfs.insideCapacityLease,
      threadCpuMillis: () => (clock ??= procfs.threadClock())(),
    });
  }),
  Layer.succeed(BackgroundServices, BackgroundServices.of({
    start: (unit, command, log) => startUnit(unit, command, log).pipe(Effect.mapError(failure("background services"))),
    state: (unit) => unitState(unit).pipe(Effect.mapError(failure("background services"))),
    stop: (unit) => stopUnit(unit).pipe(Effect.mapError(failure("background services"))),
    owner: (pid) => Effect.sync(() => procfs.ownerOf(pid)),
  })),
  Layer.succeed(GameLauncher, GameLauncher.of({
    inPrefix: (launch) => Effect.succeed({
      command: [
        ...(launch.isolateNetwork === true ? OFFLINE : []),
        ...(launch.sessionBus === true ? ["dbus-run-session", "--"] : []),
        "steam-run", "env", join(steam(), STEAM_RUNTIME), "--verb=waitforexitandrun", "--",
        join(steam(), PROTON), "waitforexitandrun", launch.exe, ...launch.args,
      ],
      env: {
        ...(launch.sessionBus === true ? { XDG_RUNTIME_DIR: userRuntime(), DBUS_SESSION_BUS_ADDRESS: `unix:path=${userRuntime()}/bus` } : {}),
        STEAM_COMPAT_DATA_PATH: launch.root, STEAM_COMPAT_CLIENT_INSTALL_PATH: steam(), STEAM_COMPAT_APP_ID: launch.appId, SteamAppId: launch.appId,
      },
    }),
  })),
  Layer.succeed(Namespaces, Namespaces.of({
    offline: (command) => Effect.succeed([...OFFLINE, ...command]),
    enter: (pid, namespaces, command, options) => Effect.succeed([
      "nsenter", "--target", String(pid), ...namespaces.flatMap((namespace) => NAMESPACE_FLAGS[namespace]), "--preserve-credentials",
      ...(options?.keepCapabilities === true ? ["--keep-caps"] : []),
      ...(options?.workingDirectory === undefined ? [] : [`--wd=${options.workingDirectory}`]), ...command,
    ]),
  })),
);

export const linuxLayer = Layer.mergeAll(synchronous, linuxDesktopLayer, audio, admission).pipe(Layer.provide(BunServices.layer));
