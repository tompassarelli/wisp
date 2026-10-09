# Module locals

Lua allows 200 local variables per function, and each bundled module is one
function. A module that passed 200 stopped the map loading
([wisp#117](https://github.com/tompassarelli/wisp/issues/117), smashcraft#399).

The numeric plugin (wisp:plugins/warcraft-numbers.ts) therefore:

- prints each named or default import's uses as reads of the module table
  (`____shell.step(x)`), where TypeScriptToLua would declare
  `local step = ____shell.step` for every name; one `local ____shell =
  require("shell")` stays per imported module. Namespace access costs the same
  7.013 Lua instructions per call as a named alias, and a read at the use
  site also sees a value set after a cyclic import;
- fails the compile with TS9301, naming the module, when a module has more than
  190 top-level locals after that, leaving headroom below Lua's 200 for the
  bundle's own locals. Split the module.

The check runs in full and cached compiles (`beforeEmit`), so a module that
was not recompiled still fails by its recorded count. Tested by
wisp:test/module-locals.test.ts.
