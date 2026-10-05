<p align="center"><img src="assets/waygate.png" alt="Waygate logo" width="360"></p>

# Waygate

**Warcraft III modding at warp speed.**

Modern tooling, testing, build automation, and developer experience for Warcraft III modding.

Waygate compiles TypeScript into Warcraft III's Lua, applies the game's numeric
rules, reloads code into running clients, maps Lua errors back to TypeScript,
and provides shared map packaging, file transport and client controls. Host
tools run in Bun and use Effect. Synchronized game code stays in TypeScript
that TypeScriptToLua can compile.

Waygate owns the compiler, numeric guards and helpers, reload runtime, host
services, and generic archive operations. Games own their simulation, UI,
assets, map declaration, import list, and acceptance journeys. Smashcraft is
the first consumer; Waygate does not import or read its source.

## Develop Waygate

The exact Bun, TypeScript, TypeScriptToLua and Effect versions are recorded in
waygate:typescript-toolchain.lock. From the checkout root:

```sh
bun install --frozen-lockfile
bun run check
LUA=/path/to/lua32 bun run test
```

The test command requires Lua 5.3 built with `LUA_32BITS`, matching Warcraft's
32-bit integers and binary32 floats. It compiles and executes the numeric and
payload checks; an ordinary 64-bit Lua is a different runtime.

Source is under waygate:src/; Bun host services are under
waygate:scripts/waygate/; the compiler plugin is
waygate:plugins/warcraft-numbers.ts. Focused tests are under waygate:test/.
Generated bundles and checker caches stay in waygate:build/.

The warm compiler rechecks and translates affected modules, then rebuilds the
bundle in program order. It preserves printed Lua and source-map trees between
compiles. Dependency resolution temporarily rewrites requires in those trees;
the compiler restores their original child arrays after synchronous bundling.

## TypeScript call stacks in Warcraft

Warcraft omits Lua's `debug` library. To include named TypeScript frames in
callback error reports, add `{ "name": "./node_modules/waygate/plugins/stack-traces.ts" }`
to the consuming map's `tstl.luaPlugins`, alongside the numeric plugin. Rebuild
or hot reload that bundle; the dispatch reporter then records the throw and
call locations directly from the compiler's TypeScript source positions.

Stack tracing is opt-in because it adds bookkeeping to function entry, source
statements and returns. It keeps the thrown value intact and preserves Lua's
multiple returns; caught failures restore the active depth. Frames cover the
synchronous TypeScript modules compiled with the plugin. Warcraft natives,
the Lua support library and precompiled dependency functions do not acquire
frames. The shared stack survives hot reload; suspended coroutines are outside
the map runtime's synchronous callback contract.

## Consume a pinned revision

Smashcraft records an immutable Waygate commit and consumes its generated
package through Bun. The package contains authored TypeScript and its emitted
Lua modules with generated declarations. The archive is dependency output; maintained
framework source lives here. This keeps clean installs and CI independent of
private-repository credentials. No registry release is required.

Host services receive the project's paths, file prefix, map declaration,
object data and import list explicitly. The runtime accepts matching file and
persistent-state names through `configureRuntime()`. This preserves a running
game's existing state when its code reloads. Project commands compose these
services with the game's own fresh-match, replay and integrity checks.

See smashcraft:docs/typescript.md for the consumer's actual commands and
smashcraft:ts/scripts/update-waygate.ts for updating its recorded revision.

To generate a consumer archive from a checkout, run
`bun scripts/package.ts /absolute/path/to/waygate.tgz`. The producer uses the
pinned compiler, keeps generated output under waygate:build/, and includes the
Lua modules required by TypeScriptToLua alongside the host source.
