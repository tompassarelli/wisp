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

See the [feature index](docs/index.md) (waygate:docs/index.md) to find existing
capabilities and their setup, including opt-in diagnostics.

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

Warcraft omits Lua's `debug` library. Waygate can record named TypeScript
frames without it. This is an opt-in development diagnostic with measurable
CPU and bundle-size cost; see [TypeScript stack traces](docs/stack-traces.md)
(waygate:docs/stack-traces.md) for configuration and scope.

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
