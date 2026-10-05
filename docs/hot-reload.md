# Hot reload

Use hot reload for TypeScript behavior changes during a running match. Changes
to archived assets, object types or art need a rebuilt map and a fresh match.
Runtime-settable object fields can change on retained engine handles: the
consumer reapplies its declared values with supported native setters during
synchronized `install()`. Wisp does not own those game-specific declarations
or automatically apply them.

Smashcraft is a consumer example: its [object-data declaration documentation](https://github.com/tompassarelli/smashcraft/blob/main/docs/typescript.md#build-the-map)
(smashcraft:docs/typescript.md) describes the game-owned build inputs;
[its runtime-field reload work](https://github.com/tompassarelli/smashcraft/issues/40)
covers updating fields on retained handles without rehosting.

## Map integration

Bind engine callbacks once with `trampoline(name)` and register their current
behavior with `on(name, handler)` from
[dispatch](../src/platform/dispatch.ts) (wisp:src/platform/dispatch.ts).
The bundle exports `install()`; each installation calls `installDispatch()`,
re-registers handlers and calls `installHotReload()`. At initial match startup,
call `startHotReload()` once to create its timer and trigger.
It also acknowledges version 0, the map's own bundle, which tells host tools
such as the [fresh match](../scripts/wisp/lobby.ts) (wisp:scripts/wisp/lobby.ts)
that the match is running in that client. Keep module scope free of Warcraft
natives and synchronized state: each client evaluates a new bundle's modules as
soon as its own files arrive, on its own frame. A map built with an older
reloader keeps that reloader's timer and messages; rebuild it and start a fresh
match before relying on a reloader change.

The map reads each payload through the tooltips of FileIO's ability ('$wsl'),
so the map's war3map.w3a must declare it. MapBuild adds a war3map.w3a holding
only that ability when the build supplies none; a map that generates its own
writes it with `abilityData()` from [object data](../scripts/objectData.ts)
(wisp:scripts/objectData.ts).

Put state that must survive in globals. Each reload creates fresh module locals.
If the state shape changes, migrate it deliberately or start a fresh match.
Call `configureRuntime()` before installing handlers in every bundle, keeping
its file/message/global prefixes stable across that match. See
[runtime configuration](../src/runtime/config.ts)
(wisp:src/runtime/config.ts).

## Host integration

Compose [makeHot](../scripts/wisp/commands/hot.ts)
(wisp:scripts/wisp/commands/hot.ts) with the consuming project's
`BuildProject`, source directory, retained-source-map directory and matching
file prefix. Its command takes one `--data` CustomMapData directory per client;
`--watch` publishes saved changes and prints new error and [desync](#desync-reports) reports.
The consumer owns the program and command name; the
[sample map](sample-map.md) (wisp:docs/sample-map.md) composes one with
`runCli`.

The host writes every client's payload files, then every client's manifest,
into the `<file prefix>-hot` folder of each CustomMapData directory. Every
client polls that folder for its next manifest 32 times a second; a small
folder keeps each poll's missing-file lookup cheap under Wine. As soon as a
client finds its manifest, it loads and verifies its payload and broadcasts
ready or refuse with the manifest it loaded. A client still waiting for its
own manifest loads the version when that first answer arrives. Once every
playing human has answered, clients install on the same synchronized frame or
refuse that version; answers naming different payload checksums refuse it too.
A refusal leaves the previous installed code in place. Successful installation
preserves the game's global state and existing handles, and each client then
writes its acknowledgement. In `--watch` output, each change's `reload` timeline
starts when the save is detected, so the `vN running in 2 client(s)` line ends
at the time from save to every client's acknowledgement.

The incremental compiler rebuilds the Lua bundle and its source map from each
unchanged module's cached text and mappings; the result equals a full
TypeScriptToLua compile (see [compiler](../scripts/compiler.ts) and
[bundle](../scripts/luaBundle.ts), wisp:scripts/compiler.ts and
wisp:scripts/luaBundle.ts).

See [runtime](../src/platform/hotReload.ts) and
[host service](../scripts/wisp/hotReload.ts)
(wisp:src/platform/hotReload.ts, wisp:scripts/wisp/hotReload.ts).

## Desync reports

When Warcraft detects a desync, each client writes
`Errors/<UTC date and time> <id>/Desync.txt` in its Documents/Warcraft III
folder, beside CustomMapData. It names the turn (`Network desync on turn N`)
and lists the engine's checksums and handle counters, such as
`War3 tempest checksum cb35df6c` and
`War3 next presence tag 04406 next birth tag 08102`. Both clients of the
5 October 2026 native desync (build 24268) wrote theirs 2 ms apart.

`--watch` compares the clients' new reports with
[Desyncs](../scripts/wisp/desyncs.ts) (wisp:scripts/wisp/desyncs.ts)
and prints each desync once, numbering clients in `--data` order:

```text
Warcraft desync on turn 12585, diverged: next birth tag (client 0: 08102, client 1: 08103), tempest checksum (client 0: cb35df6c, client 1: cbb742b8); 3 ms after the game wrote its report
```

A client with no report 1 s after the first is named as missing. All eight
native desyncs recorded on build 24268 differed in the tempest checksum; seven
also differed in the next birth tag, which advances as a client creates
handles. Warcraft also appends four-character-coded records of the last three
turns to `Logs/<account>_<date>_<time>_Desync.log`, one file per game process
across all its games; Wisp does not read that file.
