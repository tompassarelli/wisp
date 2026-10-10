# Platforms

Wisp is built on and for Linux. Windows and macOS consumers (map makers, and
players running the standalone player) should fit without the Linux code
spreading into what they run
([wisp#108](https://github.com/tompassarelli/wisp/issues/108)). This page maps
each module to the platform-neutral core or to a platform service, lists every
Linux assumption found, and says where the boundary sits.

## The boundary

Platform-specific work sits behind Effect services
(wisp:scripts/platform/services.ts). Each is a `Context.Service` tag with a
Linux layer under wisp:scripts/platform/linux/. Nothing outside that folder
reads `/proc`, cgroup files or runs `nsenter`, `wine`, `grim`, `xdotool`,
`wlrctl`, `systemd-run`, `systemctl`, `steam-run`, `bwrap`, PipeWire or niri.

| Service | What it does | Linux layer |
| --- | --- | --- |
| `ProcessTable` | process discovery: the process table, a prefix's game processes, a launcher's working directory and environment, whether a pid lives, its resident memory and network interfaces | `/proc` (linux/procfs.ts) |
| `ResourceAccounting` | process and resource accounting: CPU pressure, the CPU limit, whether this run holds a capacity lease, thread CPU time | `/proc/pressure`, cgroup `cpu.max`, `clock_gettime` from libc |
| `ScreenCapture` | screen capture of a client's desktop | `grim` (linux/desktop.ts) |
| `InputInjection` | input injection: finding, focusing and placing windows, keys, text, pointer presses and input batches | `xdotool` and `wlrctl` on a private X11/Wayland desktop |
| `GameLauncher` | game launch in a prefix | Proton under `steam-run`, optionally offline (`bwrap`) and with its own session bus |
| `PlayMachine`, `PlayDesktop` | game launch, processes and windows for [`wisp play`](play.md) and [`wisp client doctor`](doctor.md) | Battle.net under Wine via `nsenter`, niri, `grim`, `xdotool` (linux/play.ts) |
| `Namespaces` | entering a process's namespaces, or running offline | `nsenter`, `bwrap --unshare-net` |
| `AudioIsolation` | a client's own audio sink | PipeWire null sinks (`pw-dump`, `pw-cli`) |
| `BackgroundServices` | background services and which service owns a process | `systemd-run --user`, `systemctl --user`, cgroups |
| `CapacityAdmission` | capacity admission: probing and leasing the machine-capacity helper | the cgroup-based helper |

Layers are composed at the application boundary. `cliProgram`
(wisp:scripts/wisp/cli.ts) provides `platformLayer()`
(wisp:scripts/platform/layer.ts) to every command, so a `Command` may require
any platform service. Standalone programs (`pairAgent`, `pairSession`,
`dummySession`, the test runner) provide it in their `runMain`, and the
synchronous boundaries that can't (soak's thread clock and the LAN plugin's
`isolatedNetworkProblem`) read it with `runPlatformSync`.

`platformLayer` picks the Linux layer on Linux and `unsupportedLayer` anywhere
else. There, a capability with no implementation fails with
`PlatformUnsupported`, printed as `<capability> is not supported on this
platform (<platform>)`, instead of crashing; desktop calls carry it inside
their `DesktopFailure`. Accounting reads that have a portable meaning report
nothing instead: no CPU pressure, no CPU limit, no lease, and thread CPU from
`process.cpuUsage()`.

wisp:test/platform-boundary.test.ts holds the boundary: it fails on any new
direct use outside wisp:scripts/platform/linux/, checks that it catches a
planted one, and runs each service and a command against the Windows layer
for the named error.

## Core and platform-specific modules

The core should run anywhere Bun runs. Only the native side is per platform.

| Module | Side |
| --- | --- |
| wisp:src/ (headless runtime, simulation, natives, Lua runtime, renderer pieces) | core |
| wisp:scripts/compiler.ts, `lua.ts`, `luaBundle.ts`, `mapScript.ts`, `objectData.ts`, `natives.ts`, `numberRules.ts`, `sourceMaps.ts`, `cleanRoom.ts`, `package.ts` | core |
| wisp:scripts/wisp/ map build, headless, Lua32, hot reload, dev, test runner, soak, repro, tune, terrain, render and replay modules | core; the test runner and soak read `ResourceAccounting` |
| wisp:scripts/wisp/net/ (Wisp's own transport) and the LAN protocol in wisp:scripts/wisp/lan/ (`host`, `w3gs`, `join`, `actions`, `actionLog`, `map`) | core |
| wisp:scripts/warcraft/ (`battleNet`, `war3Log`, `preferences`, `inputBatch`, `desktop`) | core logic over services; `desktop.ts` drives clients through `ScreenCapture` and `InputInjection` |
| wisp:scripts/wisp/watch.ts, `clients.ts`, `accept.ts`, `doctor.ts`, `play.ts` | core logic over `ProcessTable`, `InputInjection`, `PlayMachine` and `PlayDesktop` |
| wisp:scripts/platform/services.ts, `layer.ts` | the boundary |
| wisp:scripts/platform/linux/ | Linux layers |

Linux-only tooling stays out of the consumer path. It goes through the same
services but only has a Linux layer, so elsewhere it stops at its first
platform call with the named error:

- the offline LAN pool: wisp:scripts/wisp/lan/ `pool`, `pairSession`,
  `pairAgent`, `setup`, `dummy`, `dummySession`, `offline`, `admission`,
  `plugin` and `wisp lan` (wisp:scripts/wisp/commands/lan.ts);
- signed-in client services: wisp:scripts/wisp/clientServices.ts,
  `clientServicesCommand.ts`, `doctorHost.ts`, `clientDoctorCommand.ts`;
- playing on the owner's desktop: wisp:scripts/wisp/playHost.ts selects
  wisp:scripts/platform/linux/play.ts.

## Linux assumptions found

Before #108, by file (all now inside wisp:scripts/platform/linux/):

| Assumption | Where it was | Where it is |
| --- | --- | --- |
| `/proc` process table, cmdline, environ, stat, cwd, exe | scripts/warcraft/processes.ts, scripts/wisp/lan/processes.ts, scripts/wisp/playHost.ts, scripts/wisp/clientServices.ts | linux/procfs.ts |
| `/proc/<pid>/status`, `/proc/<pid>/net/dev` | scripts/wisp/lan/dummy.ts, scripts/wisp/lan/offline.ts | linux/procfs.ts |
| `/proc/pressure/cpu` (and `/proc/self/stat`, which the test-cost preload stopped reading in 0d3dd85) | scripts/wisp/testRunner.ts, scripts/wisp/testCostPreload.ts | linux/procfs.ts |
| cgroups (`/proc/<pid>/cgroup`, `/sys/fs/cgroup/.../cpu.max`, `cgroup.procs`) | scripts/wisp/clientServices.ts, scripts/wisp/commands/dev.ts, scripts/wisp/commands/soak.ts, scripts/wisp/testRunner.ts | linux/procfs.ts |
| libc `clock_gettime` thread clock and the only `process.platform` branch | scripts/wisp/soak.ts | linux/procfs.ts, layer.ts |
| Wine (`wine`, `wineserver`, `WINEPREFIX`) | scripts/wisp/playHost.ts, scripts/warcraft/processes.ts | linux/play.ts, linux/procfs.ts |
| Wine's runtime recognised by its `wineserver` name | scripts/warcraft/battleNet.ts (`prefixUse`) | linux/procfs.ts sets `ProcessInfo.runtime`; `prefixUse` reads the flag |
| Proton and `steam-run` | scripts/wisp/lan/pairAgent.ts, scripts/wisp/lan/setup.ts | linux/layer.ts (`GameLauncher`) |
| `nsenter` | scripts/wisp/playHost.ts, scripts/wisp/commands/lan.ts | linux/play.ts, linux/layer.ts (`Namespaces`) |
| `bwrap --unshare-net` | scripts/wisp/lan/pairSession.ts, scripts/wisp/lan/setup.ts | linux/layer.ts (`Namespaces`, `GameLauncher`) |
| `grim` | scripts/warcraft/desktop.ts, scripts/wisp/playHost.ts, scripts/wisp/lan/pool.ts | linux/desktop.ts, linux/play.ts, linux/tools.ts |
| `xdotool` | scripts/warcraft/desktop.ts, scripts/wisp/playHost.ts, scripts/wisp/lan/pairAgent.ts, scripts/wisp/lan/pool.ts | linux/desktop.ts, linux/play.ts, linux/tools.ts |
| `wlrctl`, Wayland (`WAYLAND_DISPLAY`, private desktop run folders) | scripts/warcraft/desktop.ts, scripts/wisp/lan/pairAgent.ts, scripts/wisp/lan/pool.ts | linux/desktop.ts, linux/tools.ts |
| niri | scripts/wisp/playHost.ts | linux/play.ts |
| `systemd-run --user`, `systemctl --user` | scripts/wisp/clientServices.ts | linux/systemd.ts |
| `/run/user/<uid>`, PipeWire sinks, `dbus-run-session` | scripts/wisp/lan/pairAgent.ts | linux/layer.ts (`AudioIsolation`, `GameLauncher`) |

## Windows CI

The `windows` job (wisp:.github/workflows/windows.yml) runs the core on
`windows-latest` with no Linux layer: the type check, the Lua32 runner, the
sample's tests (`wisp test`), its headless journey (`wisp headless`), the
map build tests and the platform boundary test. The map build test that
interrupts a step is left out there: its stand-in child is `sh -c 'echo $$'`,
whose pid is Git Bash's, not the Windows process `process.kill` checks, so it
still needs a Windows-native stand-in. It is a separate workflow from CI, so a Windows failure
shows on the commit without opening the "main is red" issue
([CI](ci.md)).

Not done here: Windows or macOS layers for the native side (game launch,
capture, input, accounting), and macOS CI. A Windows or macOS layer is a new
folder beside wisp:scripts/platform/linux/ that `platformLayer` selects; it
needs a real machine of that kind to write and check.
