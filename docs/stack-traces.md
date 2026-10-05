# TypeScript stack traces

Use this development diagnostic when an engine callback fails and its caller
chain matters. Warcraft III omits Lua's `debug` library. Without instrumentation,
a Lua runtime error can carry a Lua line that Wisp maps to TypeScript, but
there is no native callback stack; a thrown TypeScript `Error` has no source
position by itself.

## Enable it in the consuming map

Add the stack plugin alongside the numeric plugin in the map's TypeScriptToLua
configuration. Paths below are relative to a configuration at the consuming
package root; adjust them for a configuration in a subdirectory.

```json
{
  "tstl": {
    "luaPlugins": [
      { "name": "./node_modules/wisp/plugins/warcraft-numbers.ts" },
      { "name": "./node_modules/wisp/plugins/stack-traces.ts" }
    ]
  }
}
```

Recompile, then hot reload the bundle or rebuild the map. Callback errors must
pass through Wisp's `on()`/`trampoline()` dispatch boundary with
`installDispatch()` installed; see [hot reload](hot-reload.md)
(wisp:docs/hot-reload.md). Adding the plugin does not wrap arbitrary native
callbacks that bypass that boundary.

The compiler records TypeScript file, statement line and function name directly.
For example, the existing no-debug fixture reports:

```text
Error: original failure
test/stack/entry.ts:6: in deepest
test/stack/entry.ts:10: in invoke
test/stack/entry.ts:14: in nested
```

The example paths are compiler output from wisp:test/stack/entry.ts. The game
displays the error message and writes the detailed report to CustomMapData.
The consumer's hot watcher prints that report. Compiler-recorded frames already
contain TypeScript positions; ordinary `map-KEY:LINE` and `hot-KEY:LINE` Lua
positions use retained source maps through
[SourceErrors](../scripts/wisp/sourceErrors.ts)
(wisp:scripts/wisp/sourceErrors.ts). Keep maps for bundles that can still
run so old reports remain resolvable.

## Cost and scope

Instrumentation adds bookkeeping at function entry, source statements and
returns. Five paired runs of Smashcraft's production frame-cost workload in
Lua32, 4,096 frames per run, measured a median **1.404× CPU time** (ratios
1.378–1.460×). Emitted Lua grew from **667,313 to 1,372,708 bytes**, about
**2.06×**. All paired initial checksums and complete final replay states matched.
These are development-diagnostic measurements, not a native Warcraft frame-rate
claim; leave the plugin out of normal performance builds.

Frames cover synchronous TypeScript compiled with this plugin. Warcraft natives,
Lua support-library functions and precompiled dependencies do not gain frames.
In particular, the installed package's already-emitted framework Lua is not
retroactively instrumented by a consumer's plugin. The reporter preserves the
thrown value, Lua multiple returns and caught-failure depth cleanup. Its shared
stack survives hot reload; suspended coroutines are outside the synchronous
callback contract.

Implementation: [compiler plugin](../plugins/stack-traces.ts) and
[runtime reporter](../src/platform/errors.ts)
(wisp:plugins/stack-traces.ts, wisp:src/platform/errors.ts).
