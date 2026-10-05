# Wisp and the other Warcraft III toolchains

This page compares Wisp with the maintained Warcraft III map toolchains on one
map: the [sample map](sample-map.md)'s fixed behavior (two Footmen walk a square
lap from one pure function, `-ping` prints a counter, one unit test for the
function), ported to each toolchain's own project template. Measured
2026-10-05 16:09–16:31 UTC on one NixOS x86-64 machine (24 logical CPUs),
every run inside a 6-CPU, 8 GiB capacity scope while other work shared the
machine.

**Conclusion:** Wisp leads on type-check latency, tests in Warcraft's 32-bit
number model, live code changes in one and two running clients, and desync
diagnosis; it ties on full-build time (with the w3ts template), error reports
and language support; it trails warcraft-vscode's uncompiled Lua on build and
rebuild time, and Wurst on default call stacks for explicitly thrown errors.

## Results

Times are medians of 5 runs (range in brackets), each after a one-line source
edit, following one unmeasured warm-up. "Add-on" marks a test the toolchain
does not ship, written for this comparison with the language's usual runner.

| | Wisp | Wurst | TypeScript template (w3ts) | WCSharp (C#) | warcraft-vscode (Lua) | Wisp's standing |
| --- | --- | --- | --- | --- | --- | --- |
| Edit to type-check | **0.39 s** [0.38–0.43] `tsc --build` (TypeScript 7); the hot watcher's warm compile, 0.064 s [0.047–0.078] | 6.23 s [5.81–6.72] `grill typecheck` | 1.85 s [1.76–2.49] `tsc --noEmit` (TypeScript 5.8) | 1.40 s [1.33–1.50] `dotnet build` | None: a Lua syntax error compiles and builds with exit 0 | Leads |
| Test run | **1.25 s** [1.19–1.30] Bun and emitted 32-bit Lua; Bun only 0.63 s [0.61–0.69] | 6.33 s [6.21–6.65] Wurstunit in the compiler's interpreter | None shipped; add-on `bun test` 0.016 s, JavaScript numbers | None shipped; add-on xUnit 3.60 s [3.35–3.89], .NET numbers | None shipped; add-on 32-bit Lua script 0.002 s | Leads: the only one that runs Warcraft's number model |
| Full build, source to .w3x | 2.31 s [2.13–2.42] | 10.28 s [9.76–11.37] | 2.47 s [2.38–2.62] | 13.76 s [13.30–15.43] | **0.014 s** [0.013–0.014] | Ties w3ts; trails warcraft-vscode |
| Script-only rebuild | 1.95 s [1.89–2.09] `rebuild` | No separate mode: full build | No separate mode: full build | No separate mode: full build | **0.014 s**, no separate mode: full build | Leads typed toolchains; trails warcraft-vscode |
| Edit running in a live game, 1 client | Yes: `hot --watch` compiles each save and installs it without rehosting | Lua (default): no. JASS: JHCR, a separate alpha tool | No: rebuild and restart the map | No | No | Leads |
| Edit running in a live game, 2 multiplayer clients | Yes: every client loads, verifies and installs on the same frame or none does. Smashcraft on Waygate dd4812f: 1.68 s from save to both acknowledgements, 6/6 checksums matched | No | No | No | No | Leads |
| Error reports with source lines | Runtime fault: shown in game; its Lua position maps to `src/main.ts:49` through the retained source map. Thrown `Error`: shown in game and reported from its TypeScript throw site by default, `src/main.ts:48: Error: …` (Wisp a80f622); TypeScript stacks opt-in ([stack traces](stack-traces.md)) | Runtime fault: generated Lua line. `error()`: message and Wurst stack, `Sample, line 21`, on by default | None: errors escape uncaught; generated Lua line | None for natives' callbacks; debug wrappers cover WCSharp's own systems | Debug build: `main.lua:29`, no stack | Ties |
| Desync detection | `hot --watch` names the subsystem each client's Desync.txt diverged in; the compiler rejects nondeterministic APIs | None | None | None | None | Leads |
| Language server | TypeScript language service; Warcraft number-rule errors in `bun run check` and, through a plugin, the TypeScript 6 language service (TypeScript 7's language server loads no plugins) | Wurst's own, in the compiler | TypeScript language service | C# (Roslyn) | None shipped | Ties |

Error reports come from a headless probe: each built map's war3map.lua ran in
32-bit Lua 5.3 with stub natives declared by patch 3.0's common.j and
blizzard.j, no `debug` library, and a fault injected into the `-ping` handler:
an integer division by zero (a nil index in w3ts) and an explicitly thrown
error. It records what each toolchain's own handler shows, not the game's
handling of an error that escapes. Wisp's thrown-error cell was measured again
on 2026-10-06 at a80f622: the sample's compiled bundle in 32-bit Lua 5.3 without
`debug`, stubs for the natives it calls, and `throw new Error(...)` injected
into the `-ping` handler. The 2-client Wisp time comes from a native
Smashcraft trial (smashcraft:evidence/waygate-extraction-native-20261005/README.md),
not from this sample map.

## What ran

| Toolchain | Revision and runtime | Port |
| --- | --- | --- |
| Wisp | wisp 3e422ab, its examples/sample; Bun 1.3.13, TypeScript 7.0.2 checker, TypeScriptToLua 1.37.1 | The sample itself, built from its documented 16,814-byte format-39 base map |
| Wurst | wurstscript/WurstScript nightly 1.9.0.0-nightly-2-g28edde9a2 (linux-x64 zip with its bundled Temurin 25); grill from wurstscript/WurstSetup e55cf33; WurstStdlib2 110252d | `grill generate --script-mode lua` project, wc3Patch v3.0 |
| w3ts template | cipherxof/wc3-ts-template e3267f0; w3ts 3.0.2, TypeScript 5.8.2, TypeScriptToLua 1.31.0; Bun 1.3.13 | The template's map and build script |
| WCSharp | Orden4/WCSharp 77fbe8e, WCSharpTemplate; WCSharp 3.2.10, WCSharp.CSharpLua 6.0.2, War3Net.Build 5.7.3; .NET SDK 8.0.424 | The template's launcher, compile-map action |
| warcraft-vscode | warcraft-iii/warcraft-vscode 3cebe7d (0.3.9-rc.0), `wc3` CLI built with Rust 1.95.0; warcraft-iii/warcraft-template 7b2a38e | The template project, debug build |

Not compared: Ceres (ceres-wc3/ceres), archived on GitHub with its last commit
on 2020-09-09; eiriksgata/wc3-map-ts-template, which targets patch 1.27a
through Windows-only editors; editor-only plugins.

## Running the rivals here

Each rival built on this NixOS machine only after these changes:

- Wurst: the linux-x64 zip stores no execute permission for its bundled Java
  or launchers, and map builds load AWT's libX11.so.6, which the system's
  nix-ld library set lacks.
- w3ts template: its scripts run through `ts-node`, which exits 0 without
  building under Bun; `bun run --bun scripts/build.ts` builds.
- WCSharp: the launcher waits for a menu key and uses Windows `\` paths, also
  in the core-system file list it compiles. WCSharp.CSharpLua 6.0.2 looks up
  NuGet packages by their original-case names, which Linux's lowercase
  package folders do not match. The compile reads common.j and Blizzard.j
  from ~/Documents/Warcraft III/JassHelper/; the port used patch 3.0's files.
- warcraft-vscode: `wc3 build` could not open the template's
  objediting/main.lua, so the port declares no object data, like the others.
