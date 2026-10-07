# Captured loop bindings

The numeric compiler plugin also preserves JavaScript's per-iteration bindings
for `for (let ...)` loops. A callback created in the loop retains that
iteration's binding. For example, callbacks registered at indices 0 through 12
read those indices when called after the loop.

This is automatic when a map uses wisp:plugins/warcraft-numbers.ts. Full builds
and incremental hot-reload compilation use the same visitor. Loops without a
captured initializer binding keep TypeScriptToLua's ordinary emission.

wisp:plugins/loop-bindings.ts emits fresh loop locals before each iteration's
update and condition, then carries modified values into the next iteration.
This preserves callbacks created in the initializer, condition, update and
body, including multiple or destructured bindings and `continue` or `break`.
A variable declared outside the loop keeps its shared-binding behavior.

The visitor integrates TypeScriptToLua 1.37.1's existing loop-body, declaration
and condition helpers. Its integration is adapted from `transformForStatement`
at upstream revision `0c3a141280d6796c1a1906210622bda8ea4180a2`
([source](https://github.com/TypeScriptToLua/TypeScriptToLua/blob/0c3a141280d6796c1a1906210622bda8ea4180a2/src/transformation/visitors/loops/for.ts)).
The upstream MIT notice is retained in wisp:plugins/TSTL-LICENSE.

wisp:test/loop-capture.test.ts compares the emitted Lua result with Bun and
checks that full and incremental compilation emit identical bundles.
