# Wisp feature index

Start here when changing Wisp or building a map with it. The same pages ship
in the installed package under your project's `node_modules/wisp/docs/`.
Wisp supplies reusable services; the consuming game selects its commands,
paths, map content and acceptance journeys.

| Need | Feature and entry point | Setup or boundary |
| --- | --- | --- |
| Find the TypeScript caller of a callback failure | [TypeScript stack traces](stack-traces.md) (wisp:docs/stack-traces.md) | Opt-in compiler plugin; development diagnostics with CPU and size cost. |
| Map a reported Lua line back to TypeScript | [SourceErrors](../scripts/wisp/sourceErrors.ts) (wisp:scripts/wisp/sourceErrors.ts) | Retain each bundle's source map; the hot watcher prints changed reports. No stack plugin required for line mapping. |
| Change code without rehosting a match | [Hot reload](hot-reload.md) (wisp:docs/hot-reload.md) | Install reloadable handlers, retain global state and reapply supported runtime object fields; supply each client's CustomMapData directory. |
| Compile TypeScript with Warcraft's number rules | [Compiler](../scripts/compiler.ts) and [numeric plugin](../plugins/warcraft-numbers.ts) (wisp:scripts/compiler.ts, wisp:plugins/warcraft-numbers.ts) | Use the pinned toolchain and numeric plugin; synchronized code has Lua32 restrictions. |
| Calculate synchronized integer or binary32 values | [Integer helpers](../src/sim/intMath.ts) and [binary32 helpers](../src/sim/f32.ts) (wisp:src/sim/intMath.ts, wisp:src/sim/f32.ts) | Explicit operations for Warcraft integer and float semantics. |
| Build a map or replace only its script | [MapBuild](../scripts/wisp/mapBuild.ts) and [map declaration](../scripts/mapInfo.ts) (wisp:scripts/wisp/mapBuild.ts, wisp:scripts/mapInfo.ts) | Game supplies base/container, declaration, generated object-data bytes and imports; output stays outside the checkout. |
| Read reports or write reload payloads | [GameFiles](../scripts/wisp/gameFiles.ts) (wisp:scripts/wisp/gameFiles.ts) | Host-side file transport; runtime and host must share file identities. |
| Control existing Warcraft clients | [Clients](../scripts/wisp/clients.ts) (wisp:scripts/wisp/clients.ts) | Supply the clients file and private desktop sessions; game-specific journeys belong to the consumer. |
| Name the engine subsystem a native desync diverged in | [Desync reports](hot-reload.md#desync-reports) (wisp:scripts/wisp/desyncs.ts) | `hot --watch` compares the Desync.txt each client writes beside its `--data` folder; it does not replace the game's replay or integrity checks. |
| Generate the package for an immutable pin | [Package instructions](../README.md#consume-a-pinned-revision) (wisp:README.md) | Authored TypeScript, emitted Lua, declarations and this documentation ship together. |

The checkout's `bun run check`, `bun run test` and package-generation command
are Wisp development commands. A consumer may expose `wisp hot`, map
rebuilds or fresh-match commands by composing these services; this package
does not install a universal `wisp` executable. Smashcraft's concrete
commands and game-specific policy live in smashcraft:docs/typescript.md.
