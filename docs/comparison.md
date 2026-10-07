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
| Full build, source to .w3x | 2.31 s [2.13–2.42] ([phases](#where-wisps-build-time-goes)) | 10.28 s [9.76–11.37] | 2.47 s [2.38–2.62] | 13.76 s [13.30–15.43] | **0.014 s** [0.013–0.014] | Ties w3ts; trails warcraft-vscode |
| Script-only rebuild | 1.95 s [1.89–2.09] `rebuild`; 0.26 s when its bundle is current | No separate mode: full build | No separate mode: full build | No separate mode: full build | **0.014 s**, no separate mode: full build | Leads typed toolchains; trails warcraft-vscode |
| Edit running in a live game, 1 client | **0.27 s** [0.24–0.32] from the watcher seeing the save to the client's acknowledgement; `hot --watch` installs it without rehosting | Lua (default): no. JASS: JHCR, a separate alpha tool | No: rebuild and restart the map | No | No | Leads |
| Edit running in a live game, 2 multiplayer clients | **0.30 s** [0.28–0.38] from the watcher seeing the save to both acknowledgements; every client loads, verifies and installs on the same frame or none does | No | No | No | No | Leads |
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
into the `-ping` handler.

The live-game times were measured on 2026-10-06 at Wisp 4e95889 with the sample
map itself on signed-in Warcraft III clients, each on its own private desktop:
a Battle.net game between two clients, then a one-player game for 1 client.
Each run timed five saves alternating `ping`/`pong` in src/main.ts after the
watcher's unmeasured first publish; each time is the first number on the
watcher's `vN running in N client(s)` line. The two clients acknowledged the
same game clock, the next `-ping` printed the new text in every client, and
the Footmen kept walking, at the same minimap positions on both clients.

## Where Wisp's build time goes

The same sample after a one-line edit to src/main.ts, each run a fresh process,
timed by the steps `bun examples/sample/scripts/sample.ts build|rebuild` prints
for itself. Medians of 9 interleaved runs at wisp 4e95889 with its compile phases
timed, then with the Lua compiler link below, on 2026-10-06, in the same 6-CPU,
8 GiB scope with the machine's load average between 6 and 10 on 24 CPUs, so each
time sits about 0.1 s above the table's.

| Phase | Rebuild | Build | Build, Lua compiler linked |
| --- | --- | --- | --- |
| Process start and host modules (wall minus the command's own steps) | 0.23 s | 0.23 s | 0.24 s |
| Verify toolchain | | 0.01 s | 0.01 s |
| Load the compiler (TypeScript 6.0.2, TypeScriptToLua 1.37.1) | 0.55 s | 0.53 s | 0.53 s |
| Read config | 0.02 s | 0.02 s | 0.02 s |
| Create program (parse 119 files, 1.1 MB) | 0.43 s | 0.41 s | 0.42 s |
| Type-check | 0.34 s | 0.31 s | 0.32 s |
| Declaration signatures, reused by the next hot edit | 0.07 s | 0.07 s | 0.06 s |
| Transpile to Lua | 0.31 s | 0.27 s | 0.28 s |
| Bundle | 0.02 s | 0.02 s | 0.02 s |
| Extract base script, check its syntax, extract base files | | 0.01 + 0.14 + 0.02 s | 0.01 + 0.00 + 0.03 s |
| Package and verify | 0.02 s | 0.05 s | 0.04 s |
| **Wall** | **2.01 s** | **2.16 s** | **2.11 s** |

The compile is 1.8 s of the 2.0 s, and almost all of it is the TypeScript
compiler's own cost, the price of type safety: stock
`tstl -p examples/sample/tsconfig.map.json`, with no Wisp code, takes 1.63 s
[1.50–1.84] in the same scope. A cold rebuild at or under 1 s needs a compiler
that is already running. `hot --watch` compiles each save in 0.06 s, and
`rebuild` reuses a bundle it compiled, or an earlier build did: 0.26 s
[0.24–0.30], the process start plus 0.04 s of packaging.

The build's script syntax check ran `nix shell` each time, 0.14 s; the build now
links nixpkgs' Lua compiler into wisp:build/tools/lua once and runs it from there.

Cuts measured and not adopted, each against the same rebuild (7–9 interleaved
runs):

- A one-shot compile without the incremental builder's signature priming, and
  with TypeScriptToLua's declaration emit and diagnostics gates replaced by one
  explicit check: within ±0.05 s; the transpile phase absorbs the work.
- TypeScript 7's native checker in a parallel process, with the compiler API only
  transpiling: 0.2 s faster (1.86 s against 2.06 s over 9 runs), because the
  transform does most of the type work itself. It also has to skip the pinned
  compiler's diagnostics pass by patching its emit resolver.
- A Bun bytecode bundle of TypeScript and TypeScriptToLua: it loads in 0.22 s
  instead of 0.51 s when timed alone. Sharing it with the numeric plugin's own
  TypeScript import was not tried.
- Effect's submodule imports instead of its barrel: loading the barrel takes
  0.14 s, its Effect and Schema modules alone 0.10 s.
- JavaScriptCore JIT settings: no gain; an interpreter-only run takes twice as long.

Together these remove about 0.55 s and leave a cold rebuild near 1.5 s.

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

## What Wurst does that Wisp doesn't

Capability survey for [#41](https://github.com/tompassarelli/wisp/issues/41),
7 October 2026. Wisp coverage was read at `f81edc82bbdf526fb55479f290ffdcb03c43e711`
against its [feature index](index.md) and the implementations linked below.
This extends the latency measurements above; it does not rerun them.

Source revisions, all available in the upstream repositories:

- **C**: `wurst-compiler@9913e1bd300c2053637d756a11bae8c3c8ed568f`, read from
  `~/code/wurst-compiler/pins/9913e1bd300c2053637d756a11bae8c3c8ed568f`.
  Compiler paths below are relative to
  `de.peeeq.wurstscript/src/main/java/de/peeeq/`.
- **S**: `wurst-stdlib@e3714f629113ee682353c3244065fee3e7d9ae16`, read from
  `~/code/wurst-stdlib/pins/e3714f629113`.
- **G**: `WurstSetup@2c676ddf1aaa6a729c5c495f91a4e863716c6d9b`, read from
  `~/WurstSetup`.

The savings and effort columns are implementation estimates, not new measured
results. For checks moved from native to headless, the target is at most 2 s
per check: 1,800 checks/hour instead of the approximately 24 s/check,
150 checks/hour baseline in [#38](https://github.com/tompassarelli/wisp/issues/38),
before setup time. That is a target for the named small checks, not a prediction
for an entire match. Effort means focused agent implementation time, including
the row's check, using Wisp's existing TypeScript and Lua runners.

| Capability and actual gap | Wurst source (`repo:path` at revision above) | Wisp coverage now | What it would save Wisp or Smashcraft; effort |
| --- | --- | --- | --- |
| **1. Report an unsupported native instead of silently passing with a default.** | **C**: [`wurstscript/intermediatelang/interpreter/ILInterpreter.java`](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/de.peeeq.wurstscript/src/main/java/de/peeeq/wurstscript/intermediatelang/interpreter/ILInterpreter.java): exhausted providers record a compilation error; the interpreter can then return a default. | [`src/headless/client.ts`](../src/headless/client.ts) installs every declared native. Without a built-in or consumer behavior, `defaultNative` returns zero, false, empty text, a new handle or nothing, without reporting missing behavior. Agreement between clients can therefore pass a check whose native behavior was never modeled. | Find the missing behavior in one ≤2 s headless run, before spending a native setup/check on it. Explicitly declare intentional no-ops so existing display-only calls stay usable. **2–4 h**; highest impact because it makes every headless verdict more useful. Follow-up: native coverage issue below. |
| **2. Stateful unit life, death, mana, owner and facing in the interpreter.** | **C**: [`wurstio/jassinterpreter/providers/UnitProvider.java`](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/de.peeeq.wurstscript/src/main/java/de/peeeq/wurstio/jassinterpreter/providers/UnitProvider.java), including the measured 0.405 death threshold; `GetOwningPlayer`, unit states, kill/remove and facing operate on a unit mock. | [`src/headless/client.ts`](../src/headless/client.ts)'s unit stores type, position, move speed and attack cooldown. `CreateUnit` discards owner; life/mana/death and facing calls take the default path. Smashcraft's own fighting simulation already runs headless; this gap is in Warcraft unit interactions, not its damage/stock calculations. | Move small map-unit state and cleanup checks to ≤2 s, targeting 1,800 rather than 150 checks/hour; catch incorrect life/death assumptions without a new game. **4–8 h** for the named states, with one native comparison, not combat/pathing. Follow-up: unit state issue below. |
| **3. Typed compile-time object definitions, including ability data columns and unreal fields.** | **S**: [`wurst/objediting/UnitObjEditing.wurst`](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/objediting/UnitObjEditing.wurst), [`AbilityObjEditing.wurst`](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/objediting/AbilityObjEditing.wurst); **C**: [`wurstio/intermediateLang/interpreter/CompiletimeNatives.java`](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/de.peeeq.wurstscript/src/main/java/de/peeeq/wurstio/intermediateLang/interpreter/CompiletimeNatives.java). Wurst executes authored definitions during its build; setters carry field types, levels and data columns. | [`scripts/objectData.ts`](../scripts/objectData.ts) already generates binary custom objects and FileIO's ability in Bun; no new compile-time interpreter is needed. Its fields are arbitrary four-character strings, values have int/real/string only, and the ability data-column slot is always zero. | A typed unit/ability builder removes raw field lookups while authoring; a nonzero ability column becomes expressible, and wrong value types fail before building a map. Target: author a unit and two-level ability without raw field IDs; malformed examples fail before packaging. **4–8 h** for a useful subset, not the whole library. Follow-up: object authoring issue below. |
| Game-free test discovery and execution in the compiler's intermediate-language interpreter. | **C**: [`wurstio/languageserver/requests/RunTests.java`](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/de.peeeq.wurstscript/src/main/java/de/peeeq/wurstio/languageserver/requests/RunTests.java), [`wurstscript/intermediatelang/interpreter/ILInterpreter.java`](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/de.peeeq.wurstscript/src/main/java/de/peeeq/wurstscript/intermediatelang/interpreter/ILInterpreter.java); **S**: [`wurst/_wurst/Wurstunit.wurst`](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/_wurst/Wurstunit.wurst). Tests have name filters, failures, timeouts and timer completion. | Already covered by [dual Bun/Lua tests](index.md), [headless journeys](headless.md), [affected tests after a save](dev.md), and [CI](ci.md). Wisp executes the actual emitted Lua in its 32-bit runner rather than adding a second compiler interpreter. The measured test latency above is lower. | **No runner gap and no new ticket.** Improve native behaviors in that runner (rows 1–2), rather than paying **days** for a redundant interpreter with no measured checks/hour gain. |
| Standard-library packages for geometry, collections and spatial queries. | **S**: [`wurst/math/Vectors.wurst`](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/math/Vectors.wurst), [`wurst/data/KeyedMap.wurst`](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/data/KeyedMap.wurst), [`wurst/util/UnitSpatialIndex.wurst`](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/util/UnitSpatialIndex.wurst). The surveyed library contains **230 `.wurst` files**, including tests and generated definitions, not 230 independent packages. | TypeScript/TSTL provide collections; Wisp has numeric helpers and `src/sim/`. Wisp has no comparable Warcraft unit spatial index. Smashcraft supplies its game-specific geometry, so counting all Wurst math as missing would overstate the gap. | A reusable unit-radius query could remove a consumer's hand-built index: target one API with tests instead of native enumeration glue. **4–8 h** for one requested index. Lower priority until a consuming map needs it; importing the entire library brings no demonstrated current gain. |
| Managed one-shot, counted and periodic timer callbacks; event and damage systems. | **S**: [`wurst/closures/ClosureTimers.wurst`](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/closures/ClosureTimers.wurst), [`wurst/event/DamageEvent.wurst`](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/event/DamageEvent.wurst). The timer API includes callback destruction and timer reuse; damage listeners are a reusable game system. | [`src/platform/dispatch.ts`](../src/platform/dispatch.ts) supplies reloadable callbacks; timers/triggers work in headless. Wisp has no general timer-pool API or Warcraft damage-event framework. Smashcraft's synchronized frame loop and custom fighting damage already own those behaviors. | A conventional spell map could save repeated timer cleanup and event glue. Target one cancellable callback with no live timer after completion. **2–4 h** for timers, **1–2 days** for a tested damage system. Current Smashcraft benefit is smaller than the first three rows. |
| Runtime frame-event helpers, including releasing button focus and edit-box callbacks. | **S**: [`wurst/closures/ClosureFrames.wurst`](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/wurst/closures/ClosureFrames.wurst), `onClickReleaseFocus`, `onEditboxEnter`, `onEditboxChange`. | [Typed frames](ui.md) generate FDF and handles; behavior remains consumer code. Headless has click/focus/text state but does not emulate edit-box change/Enter events. Wurst's own **C** `wurstio/jassinterpreter/providers/FrameProvider.java` is smaller than Wisp's frame model and does not close that gap. | A release-focus helper saves repeated button glue; modeled edit events would move menu-input checks to ≤2 s. **1–2 h** for the helper, **2–4 h** for event behavior and one native comparison. Below current look-check rendering [#40](https://github.com/tompassarelli/wisp/issues/40). |
| Compiler static checks: definite assignment, return/reachability, visibility, override and initialization order. | **C**: [`wurstscript/validation/WurstValidator.java`](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/de.peeeq.wurstscript/src/main/java/de/peeeq/wurstscript/validation/WurstValidator.java), `checkUninitializedVars`, `checkReachability`, `checkOverride`, `checkClassMemberInitializerOrder`, `checkLocalShadowing`. | [`tsconfig.game.json`](../tsconfig.game.json) enables strict typing and unchecked-index/optional checks; TypeScript covers assignment, visibility and override rules. [`scripts/numberRules.ts`](../scripts/numberRules.ts) adds Warcraft-specific guards. Wisp does not add Wurst's local-shadowing warning or equivalent cross-field initializer diagnostics for arbitrary map globals. | Most benefit is already present at the measured 0.39 s check. A specific shadowing/initializer mistake could be caught before launch; target a failing source fixture if one occurs. **1–3 h** for a narrow diagnostic. No new static-check ticket without a current defect. |
| Export existing map object data back into authored source, resolving WTS strings and skin object files. | **C**: [`wurstio/objectreader/ObjectExportService.java`](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/de.peeeq.wurstscript/src/main/java/de/peeeq/wurstio/objectreader/ObjectExportService.java). | Wisp's object writer and map packager preserve/package supplied data; there is no object-to-TypeScript importer. | Saves re-entering object fields when moving an existing authored map to code. Target one exported unit and ability rebuild with identical field values. **1–2 days**. Useful for a migration, but no current migration beats runtime coverage or the native frontier. |
| CLI patch-aware core JASS, standard-library selection and explicit project/client alignment. | **G**: [`src/main/kotlin/file/CoreJassProvider.kt`](https://github.com/wurstscript/WurstSetup/blob/2c676ddf1aaa6a729c5c495f91a4e863716c6d9b/src/main/kotlin/file/CoreJassProvider.kt), [`SetupApp.kt`](https://github.com/wurstscript/WurstSetup/blob/2c676ddf1aaa6a729c5c495f91a4e863716c6d9b/src/main/kotlin/file/SetupApp.kt), `grill patch` and `grill patch align`. | Wisp pins its TS toolchain and has engine offsets per client build. Its map format/natives are the current consumer's target; there is no multi-patch project alignment command. | Could turn a future patch mismatch into one setup error before launch. **4–8 h** for a read-only mismatch check. Tom's current main-only target needs no legacy compatibility or automatic patch migration. |

### Three follow-ups and the current frontier

The first three rows are the highest-impact additions found in this survey:
native coverage reporting, a bounded unit-state model, and typed object
authoring. The concrete follow-ups are:

- Headless native coverage: report unmodeled calls instead of silently passing on defaults.
- Headless unit states: model owner, life, mana, facing, death and removal.
- Typed object authoring: unit and ability setters with data columns and unreal fields.

They reuse Wisp's current runtime and Bun build; none adopts WurstScript or
copies its interpreter.

[#38](https://github.com/tompassarelli/wisp/issues/38) still addresses the observed
native setup failures, [#39](https://github.com/tompassarelli/wisp/issues/39)
accelerates checks that need the engine, and
[#40](https://github.com/tompassarelli/wisp/issues/40) removes look checks from the
native queue. The new gaps do not replace those current priorities: coverage
reporting improves the meaning of today's headless results; unit state expands
which small checks can run there; object builders reduce authoring mistakes.
No Wurst source inspected supplies the inside-game driver, native fast-forward
or headless asset renderer those frontier issues ask for.

### Reuse rights

Checked with the `external-code` skill at the exact revisions above. This
survey copies no code; the proposed tickets are original TypeScript work using
Wurst's observed behavior and APIs as prior art. Each implementation must name
any actual derived files and retain the required notices when it chooses to
adapt source rather than independently implement a capability.

| Proposed reference/reuse | Revision and licence source | Decision and obligations |
| --- | --- | --- |
| Compiler native providers, interpreter diagnostics and object writer behavior | **C**, [WurstScript LICENSE](https://github.com/wurstscript/WurstScript/blob/9913e1bd300c2053637d756a11bae8c3c8ed568f/LICENSE): **Apache-2.0** | Permissive adaptation is compatible with Wisp's MIT project if Apache-derived files retain Apache terms: include the licence and existing attribution/copyright notices, mark changed files, and retain applicable NOTICE material if present. No root NOTICE file was found at this revision. Native semantics are evidence to compare with the actual game, not a reason to import Java or all transitive dependencies. |
| Typed object setters, timer/frame helpers and library systems | **S**, [WurstStdlib2 LICENSE](https://github.com/wurstscript/WurstStdlib2/blob/e3714f629113ee682353c3244065fee3e7d9ae16/LICENSE): **Apache-2.0** | Same obligations for adapted Wurst expressions or generated wrapper code. No root NOTICE file was found. Prefer a small TypeScript API matching Wisp's existing object writer and reloadable dispatch; do not copy the library wholesale. |
| Grill's patch-selection and CLI setup behavior | **G**, [WurstSetup LICENSE](https://github.com/wurstscript/WurstSetup/blob/2c676ddf1aaa6a729c5c495f91a4e863716c6d9b/LICENSE): **Apache-2.0** | Same obligations if adapted; no root NOTICE file found. No Grill implementation is proposed for reuse now. These repository licences do not establish redistribution rights for Blizzard game files or other dependencies. |

The material uncertainty is the forecast savings: the follow-up issues measure
their named cases; this survey establishes source-backed gaps, not their
delivered speedups.
