# TypeScript stack traces

Use this development diagnostic when an engine callback fails and its caller
chain matters. Warcraft III omits Lua's `debug` library. Without instrumentation,
a Lua runtime error carries a Lua line that Wisp maps to TypeScript, and a
thrown value's report starts with its throw site, but there is no callback
stack.

## Throw sites without the plugin

The numeric plugin, which every Wisp map loads, compiles each `throw` to record
the thrown value and the statement's TypeScript file and line before raising
it. When the report has no stack, it starts with that site, the way a runtime
fault starts with its position. The sample map with
`throw new Error("injected ping failure")` added to its `-ping` handler
reports, in 32-bit Lua without `debug`:

```text
error 1 in sample.ping
src/main.ts:48: Error: injected ping failure
```

Paths are relative to the compiling tsconfig's directory; the installed
package's own throws read `wisp/src/...`, such as `at()`'s
`wisp/src/runtime/lookup.ts:4`. A rethrow of the latest thrown value keeps its
first site. Only the throwing branch runs the recording, so ordinary frames
cost the same: seven paired Lua32 runs of Smashcraft's frame-cost workload
(4,096 frames each) measured a median ratio of **0.9999** (0.912–1.015), with
equal final checksums. With the stack plugin, the innermost frame gives the
throw line instead.

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
