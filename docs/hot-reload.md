# Hot reload

Use hot reload for TypeScript behavior changes during a running match. It
does not replace map assets, object data or previously created engine handles.
Those changes need a rebuilt map and a fresh match.

## Map integration

Bind engine callbacks once with `trampoline(name)` and register their current
behavior with `on(name, handler)` from
[dispatch](../src/platform/dispatch.ts) (waygate:src/platform/dispatch.ts).
The bundle exports `install()`; each installation calls `installDispatch()`,
re-registers handlers and calls `installHotReload()`. At initial match startup,
call `startHotReload(hostSlot, localSlot)` once to create its timer and triggers.
Keep module scope free of engine work because reload evaluates modules again.

Put state that must survive in globals. Each reload creates fresh module locals.
If the state shape changes, migrate it deliberately or start a fresh match.
Call `configureRuntime()` before installing handlers in every bundle, keeping
its file/message/global prefixes stable across that match. See
[runtime configuration](../src/runtime/config.ts)
(waygate:src/runtime/config.ts).

## Host integration

Compose [makeHot](../scripts/waygate/commands/hot.ts)
(waygate:scripts/waygate/commands/hot.ts) with the consuming project's
`BuildProject`, source directory, retained-source-map directory and matching
file prefix. Its command takes one `--data` CustomMapData directory per client;
`--watch` publishes saved changes and prints new error and desync reports.
The consumer owns the CLI entry point and command name.

Every client loads and verifies its local payload and answers ready or refuse.
Once every answer arrives, clients install on the same synchronized frame or
refuse that version. A refusal leaves the previous installed code in place.
Successful installation preserves the game's global state and existing handles.

See [runtime](../src/platform/hotReload.ts) and
[host service](../scripts/waygate/hotReload.ts)
(waygate:src/platform/hotReload.ts, waygate:scripts/waygate/hotReload.ts).
