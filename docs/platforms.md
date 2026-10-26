# Platforms

On Linux, keys, chat and the key runs of input batches reach a client through
its private desktop's own VNC server (`private-desktop.sh control RUN ...`, from
the private-desktop-development skill on `agents path`), one control run per
stretch of key actions between clicks. Clicks stay on XTEST, because every VNC
pointer event, a button included, moves the game's pointer to the compositor's
cursor: each click moves the pointer with `xdotool mousemove_relative` until
`getmouselocation` reads the target (sending one VNC move first on a retry,
because headless labwc drops XTEST motion until a compositor pointer exists),
then presses and releases with `xdotool`. Wine ignores the Shift
that VNC sends only as modifier state, so shifted characters are typed with a
real Shift held around them; text with a character a US layout can't type is
refused before anything is sent. Sign-in secrets still go to `xdotool type` on
stdin, so a secret never sits on a command line. `xdotool`, `wlrctl`, `grim`
and `tesseract` come from `PATH`, else from `nix build nixpkgs#NAME`.

`InputInjection.preflight(client)` verifies focus on the client's private Warcraft
window and that its VNC server takes a control run, and fails within twelve
seconds naming the display and failed boundary. `Clients.preflight(client)`
exposes the same check to native runners. Call it after map startup and verify
a harmless key with the map's own fresh receipt; a reachable VNC server alone
does not establish keyboard delivery.

Wisp is built on and for Linux. Windows and macOS consumers (map makers, and
players running the standalone player) should fit without the Linux code
spreading into what they run
([wisp#108](https://github.com/tompassarelli/wisp/issues/108)). This page maps
each module to the platform-neutral core or to a platform service, lists every
Linux assumption found, and says where the boundary sits.

## The boundary

Platform-specific work sits behind Effect services
(wisp:host/os/platform/services.ts). Each is a `Context.Service` tag with a
Linux layer under wisp:host/os/platform/linux/. Nothing outside that folder
reads `/proc`, cgroup files or runs `nsenter`, `wine`, `grim`, `xdotool`,
`wlrctl`, `systemd-run`, `systemctl`, `steam-run`, `bwrap`, `xdg-open`, PipeWire
or niri.

| Service | What it does | Linux layer |
| --- | --- | --- |
| `ProcessTable` | process discovery: the process table, a prefix's game processes, a launcher's working directory and environment, whether a pid lives, its resident memory and network interfaces | `/proc` (linux/procfs.ts) |
| `ResourceAccounting` | process and resource accounting: CPU pressure, the CPU limit, whether this run holds a capacity lease, thread CPU time | `/proc/pressure`, cgroup `cpu.max`, `clock_gettime` from libc |
| `ScreenCapture` | screen capture of a client's desktop | `grim` (linux/desktop.ts) |
| `InputInjection` | input injection: finding, focusing and placing windows, keys, text, pointer presses and input batches | the private desktop's VNC server for input; `xdotool` and `wlrctl` for windows and focus |
| `GameLauncher` | game launch in a prefix | Proton under `steam-run`, optionally offline (`bwrap`) and with its own session bus |
| `PlayMachine`, `PlayDesktop` | game launch, processes and windows for [`wisp play`](play.md) and [`wisp client doctor`](doctor.md) | Battle.net under Wine via `nsenter`, niri, `grim`, `xdotool` (linux/play.ts) |
| `Namespaces` | entering a process's namespaces, or running offline | `nsenter`, `bwrap --unshare-net` |
| `AudioIsolation` | a client's own audio sink | PipeWire null sinks (`pw-dump`, `pw-cli`) |
| `BackgroundServices` | background services and which service owns a process | `systemd-run --user`, `systemctl --user`, cgroups |
| `CapacityAdmission` | capacity admission: probing and leasing the machine-capacity helper | the cgroup-based helper |
| `PageOpener` | opening a local page in the owner's browser ([`wisp repro --view`](repro.md)) | `xdg-open` |

Layers are composed at the application boundary. `cliProgram`
(wisp:host/cli/cli.ts) provides `platformLayer()`
(wisp:host/os/platform/layer.ts) to every command, so a `Command` may require
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
direct use outside wisp:host/os/platform/linux/, checks that it catches a
planted one, and runs each service and a command against the Windows layer
for the named error.

## Core and platform-specific modules

The core should run anywhere Bun runs. Only the native side is per platform.

| Module | Side |
| --- | --- |
| wisp:src/ (headless runtime, simulation, natives, Lua runtime, renderer pieces) | core |
| wisp:host/toolchain/compiler.ts, `lua.ts`, `luaBundle.ts`, `mapScript.ts`, `objectData.ts`, `natives.ts`, `numberRules.ts`, `sourceMaps.ts`, `package.ts`, wisp:host/checks/cleanRoom.ts | core |
| wisp:host/ map build, headless, Lua32, hot reload, dev, test runner, soak, repro, tune, terrain, render and replay modules | core; the test runner and soak read `ResourceAccounting` |
| wisp:host/net/ (Wisp's own transport) and the LAN protocol in wisp:host/lan/ (`host`, `w3gs`, `join`, `actions`, `actionLog`, `map`) | core |
| wisp:host/os/warcraft/ (`battleNet`, `war3Log`, `preferences`, `inputBatch`, `desktop`) | core logic over services; `desktop.ts` drives clients through `ScreenCapture` and `InputInjection` |
| wisp:host/dev/watch.ts, `clients.ts`, `accept.ts`, `doctor.ts`, `play.ts` | core logic over `ProcessTable`, `InputInjection`, `PlayMachine` and `PlayDesktop` |
| wisp:host/os/platform/services.ts, `layer.ts`, `play.ts` | the boundary |
| wisp:host/os/platform/linux/ | Linux layers |

Linux-only tooling stays out of the consumer path. It goes through the same
services but only has a Linux layer, so elsewhere it stops at its first
platform call with the named error:

- the offline LAN pool: wisp:host/lan/ `pool`, `pairSession`,
  `pairAgent`, `setup`, `dummy`, `dummySession`, `offline`, `admission`,
  `plugin` and `wisp lan` (wisp:host/commands/lan.ts);
- signed-in client services: wisp:host/client/clientServices.ts,
  `clientServicesCommand.ts`, `doctorHost.ts`, `clientDoctorCommand.ts`;
- playing on the owner's desktop: wisp:host/os/platform/play.ts selects
  wisp:host/os/platform/linux/play.ts, or a layer that refuses on other
  platforms.

## Linux assumptions found

Before #108, by file (all now inside wisp:host/os/platform/linux/):

| Assumption | Where it was | Where it is |
| --- | --- | --- |
| `/proc` process table, cmdline, environ, stat, cwd, exe | host/os/warcraft/processes.ts, host/lan/processes.ts, scripts/wisp/playHost.ts, host/client/clientServices.ts | linux/procfs.ts |
| `/proc/<pid>/status`, `/proc/<pid>/net/dev` | host/lan/dummy.ts, host/lan/offline.ts | linux/procfs.ts |
| `/proc/pressure/cpu` (and `/proc/self/stat`, which the test-cost preload stopped reading in 0d3dd85) | host/testing/testRunner.ts, host/testing/testCostPreload.ts | linux/procfs.ts |
| cgroups (`/proc/<pid>/cgroup`, `/sys/fs/cgroup/.../cpu.max`, `cgroup.procs`) | host/client/clientServices.ts, host/dev/context.ts, host/commands/soak.ts, host/testing/testRunner.ts | linux/procfs.ts |
| libc `clock_gettime` thread clock and the only `process.platform` branch | host/soak/clock.ts | linux/procfs.ts, layer.ts |
| Wine (`wine`, `wineserver`, `WINEPREFIX`) | scripts/wisp/playHost.ts, host/os/warcraft/processes.ts | linux/play.ts, linux/procfs.ts |
| Wine's runtime recognised by its `wineserver` name | host/os/warcraft/battleNet.ts (`prefixUse`) | linux/procfs.ts sets `ProcessInfo.runtime`; `prefixUse` reads the flag |
| Proton and `steam-run` | host/lan/pairAgent.ts, host/lan/setup.ts | linux/layer.ts (`GameLauncher`) |
| `nsenter` | scripts/wisp/playHost.ts, host/commands/lan.ts | linux/play.ts, linux/layer.ts (`Namespaces`) |
| `bwrap --unshare-net` | host/lan/pairSession.ts, host/lan/setup.ts | linux/layer.ts (`Namespaces`, `GameLauncher`) |
| `grim` | host/os/warcraft/desktopClient.ts, scripts/wisp/playHost.ts, host/lan/pool.ts | linux/desktop.ts (`InputInjection.tools` names it for the pool), linux/play.ts |
| `xdotool` | host/os/warcraft/desktopClient.ts, scripts/wisp/playHost.ts, host/lan/pairAgent.ts, host/lan/pool.ts | linux/desktop.ts (`InputInjection.tools` names it for the pool), linux/play.ts |
| `wlrctl`, Wayland (`WAYLAND_DISPLAY`, private desktop run folders) | host/os/warcraft/desktopClient.ts, host/lan/pairAgent.ts, host/lan/pool.ts | linux/desktop.ts (`InputInjection.tools` names it for the pool) |
| niri | scripts/wisp/playHost.ts | linux/play.ts |
| `systemd-run --user`, `systemctl --user` | host/client/clientServices.ts | linux/systemd.ts |
| `/run/user/<uid>`, PipeWire sinks, `dbus-run-session` | host/lan/pairAgent.ts | linux/layer.ts (`AudioIsolation`, `GameLauncher`) |

## Windows tools

On Windows a map maker needs only Bun: Wisp's native tools ship prebuilt in
wisp:native/windows/, statically linked 64-bit MinGW executables of map-pack
(over StormLib 9.30 with its bundled zlib, bzip2, LibTomCrypt and
LibTomMath), both 32-bit-number Lua 5.3.6 variants and that Lua's `luac`
for the script syntax check. On `win32`, wisp:host/compile/windowsTools.ts
checks each against wisp:native/windows/manifest.json before use: its SHA-256,
and that it was built from today's sources (map-pack.c's SHA-256, the Lua32
build key). A stale or altered tool fails the build naming it; Wisp never
calls nix, gcc or make there. Linux keeps building them from source.
Licenses are in wisp:docs/notices/.

To rebuild them, change the sources and run the Windows workflow's `tools`
job, which builds them with the runner's MinGW and CMake
(`bun host/compile/buildWindowsTools.ts OUT`) and uploads the
`windows-tools` artifact; commit its files into wisp:native/windows/. The
builds are reproducible on the runner (two runs gave the same bytes), so the
job also fails when the committed manifest differs from the one it built: a
source change without a rebuild, or a new MinGW on the runner image.

## Windows CI

The `windows` job (wisp:.github/workflows/windows.yml) runs the core on
`windows-latest` with no Linux layer and with every directory holding gcc,
make or nix removed from `PATH`, as on a map maker's machine: the type check,
the Lua32 runner, the sample's tests (`bun run test examples/sample`), its
32-bit Lua tests, its headless journey (`wisp headless`), the map build tests,
and a real `sample.ts map build` from a synthetic base map
(wisp:test/syntheticBaseMap.ts, written by map-pack's `create`). The map build test that
interrupts a step is left out there: its stand-in child is `sh -c 'echo $$'`,
whose pid is Git Bash's, not the Windows process `process.kill` checks, so it
still needs a Windows-native stand-in. It is a separate workflow from CI, so a Windows failure
shows on the commit without opening the "main is red" issue
([CI](ci.md)).

Not done here: Windows or macOS layers for the native side (game launch,
capture, input, accounting), and macOS CI. A Windows or macOS layer is a new
folder beside wisp:host/os/platform/linux/ that `platformLayer` selects; it
needs a real machine of that kind to write and check.
