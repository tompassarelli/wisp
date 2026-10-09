# Handle cleanup

Normal `map build` and `map rebuild` print advisory cleanup warnings for
source-owned TypeScript maps, including when reusing a compiled script.
Each warning names the source `file:line:column` and the missing cleanup.
Warnings do not stop the build.

The check covers direct calls to the declared global `Location(x, y)` and
`CreateGroup()`. A local variable initialized by that call is matched with a
later standalone `RemoveLocation(variable)` or `DestroyGroup(variable)` in
the same function. A discarded direct call also warns. Same-named map helpers
and installed dependency sources are excluded.

An unmatched allocation in this straight-line pattern warns `Unmatched`.
Assignments, aliases, arguments to other functions, returned handles, captured
variables, module-level ownership, conditional allocation or cleanup, loops,
switches, and try blocks report `Handle ownership UNKNOWN`. Early returns or
throws before cleanup also make ownership unknown. UNKNOWN asks the author
to check ownership; it is not a proven leak. The checker does not follow
ownership across functions or know whether an arbitrary call throws.

Headless clients expose `client.liveHandleCounts()`, a snapshot with
`locations` and `groups`. `Location`/`CreateGroup` increase their count and
`RemoveLocation`/`DestroyGroup` decrease it. A journey can save snapshots
before creation, after creation, and after cleanup and compare the last
snapshot with the first. Counts belong to each simulated client and are
not native Warcraft process measurements. Locations also support
`MoveLocation`, `GetLocationX`, and `GetLocationY`; group membership operations
are outside this change.
