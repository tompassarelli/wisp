# Hot reload

## Model load failures

Maps call `startModelFailures()` before creating their model pools. This writes
a per-client request with a fresh numbered token, without allocating a
handle. `hot --watch` and `dev --data` forward every new `model creation failed`
path in War3Log, including stock models, into numbered files in the hot folder.
The existing hot timer polls them once per second; `modelFailed(path)` retains
the result across reloads. A map uses it only to show or hide existing visual
handles. Log writes occur in bursts, so the visible fallback can be delayed
until Warcraft writes the failure. Each new map requests a new token and ignores
earlier maps' files.

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
call `startHotReload()` once to create its timer and trigger; a client looks
for files only twice a second until it has seen a host
([what polling costs](#what-polling-costs)).
It also acknowledges version 0, the map's own bundle, which tells host tools
such as the [fresh match](../scripts/wisp/lobby.ts) (wisp:scripts/wisp/lobby.ts)
that the match is running in that client. Keep module scope free of Warcraft
natives and synchronized state: each client evaluates every module of a new
version as soon as its own files arrive, on its own frame. A map built with an older
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

## Error reports on screen

A callback error is written to the `<file prefix>-error-p<slot>.txt` file that
`wisp hot --watch` reads and maps to TypeScript lines. By default the local
player also sees it on screen as `error in HANDLER: MESSAGE`, which names
handlers, TypeScript lines and Lua messages. A build that players run turns
that off with `configureRuntime({ ..., errorsOnScreen: false })`; the report
is still written to the file, and the headless runtime's `client.errors`
still lists it. Set the field with the other prefixes in every bundle's
`install()`: each call replaces the previous configuration, so a reload that
omits it shows reports again. Hot reload's own `hot reload N applied` and `not
applied` messages are always displayed; a build players run should not
`startHotReload()`.

## Host integration

Compose [makeHot](../scripts/wisp/commands/hot.ts)
(wisp:scripts/wisp/commands/hot.ts) with the consuming project's
`BuildProject`, source directory, retained-source-map directory and matching
file prefix. Its command takes one `--data` CustomMapData directory per client;
`--watch` publishes saved changes and prints new error and [desync](#desync-reports) reports
and each reload's [frame cost](frame-cost.md#after-each-hot-reload).
The consumer owns the program and command name; the
[sample map](sample-map.md) (wisp:docs/sample-map.md) composes one with
`runCli`.

The host first creates the `<file prefix>-hot` folder of each CustomMapData
directory with the host marker `host.pld` in it
([prepareHotFolders](../scripts/wisp/gameFiles.ts), wisp:scripts/wisp/gameFiles.ts).
`wisp hot` does so when it starts and a [fresh match](../scripts/wisp/lobby.ts)
(wisp:scripts/wisp/lobby.ts) before it installs the map, so the folder exists
before the match does; a map's own commands that start a match or publish
reloads must do the same. The marker's content never changes, which the
Preloader rule needs, and an existing marker is left alone. The host then
writes every client's payload files, then every client's manifest, into that
folder ([what a reload sends](#what-a-reload-sends)). Every client polls it for
its next manifest ([what polling costs](#what-polling-costs)). As soon as a
client finds its manifest, it loads and verifies its copy and broadcasts
ready or refuse with the manifest it loaded. A client still waiting for its
own manifest loads the version when that first answer arrives. Once every
playing human has answered, clients install on the same synchronized frame or
refuse that version; answers naming different module states refuse it too.
A refusal leaves the previous installed code in place. Successful installation
preserves the game's global state and existing handles, and each client then
writes its acknowledgement. In `--watch` output, each change's `reload` timeline
starts when the save is detected, so the `vN running in 2 client(s)` line ends
at the time from save to every client's acknowledgement.

The incremental compiler rebuilds the Lua bundle and its source map from each
unchanged module's cached text, mappings and resolved requires; the result
equals a full TypeScriptToLua compile (see [compiler](../scripts/compiler.ts)
and [bundle](../scripts/luaBundle.ts), wisp:scripts/compiler.ts and
wisp:scripts/luaBundle.ts). Plugins' `beforeEmit` and `afterEmit` run on its emit plan as they do
in a full compile. A plugin's visitors run only on the modules a compile
transpiles, so a visitor whose output depends on other files keeps an
unchanged module's old text. The number rules scan only changed files again.

## What a reload sends

A version is a module set: the compiled map's modules, each a Lua chunk of its
own ([modules](../src/runtime/modules.ts), wisp:src/runtime/modules.ts). Its
payload starts with an index, every module's name and hash, whose checksum is
the version's state. The host writes two payloads: the full one, which carries
every module, and, once every client has acknowledged an earlier version, a
delta from that version's state that carries only the modules whose hash
changed, renamed and new modules included; a removed module is absent from
the index. The manifest names the state, the full payload's files and the
delta's base and files.

A client keeps the modules it installed and their state. When that state is
the delta's base it reads only the delta, checks the index and each carried
module against its hash, loads only those chunks and links every other module
from its own table; otherwise, as on the first reload after the map's own
bundle or after a restarted `wisp hot`, which knows no base, it reads the full
payload. Either way every module of the version is linked again, so module
locals are fresh as before, and the client answers with the state it loaded.
A module that fails its hash, a payload cut short or a version that fails
while its modules load refuses the version in every client.

Each module loads as the chunk `hot-KEY`, KEY its hash, and the host keeps its
source map under that key, so an error report names TypeScript lines as a
whole bundle's did.

Measured on Smashcraft (168 modules) on 6 October 2026, a one-line edit of a
12 KB module:

| | Full payload | Delta |
| --- | --- | --- |
| Bytes a client reads | 1,240,509 in 7 files | 19,113 in 1 file: the 8 KB index and the module |
| 32-bit Lua: parse, hash, load, link and module scope (median of 15) | 123 ms (hash 80, load 39) | 5.5 ms (module scope 3.4) |

From the save to both acknowledgements of two fake clients that acknowledge as
soon as their files appear, the host's share fell from 374 ms to 190 ms
(medians of 10 such edits): the delta, no whole-bundle checksum, and the
compiler's reused requires and number-rule scans. The 2-client native median
was 0.841 s with whole bundles; the sample's tiny bundle, 0.298 s, is about the
client-side floor of polling and synchronized answers.

See [runtime](../src/platform/hotReload.ts) and
[host service](../scripts/wisp/hotReload.ts)
(wisp:src/platform/hotReload.ts, wisp:scripts/wisp/hotReload.ts).

## What polling costs

A client polls for a manifest that does not exist until a reload is
published. Under Wine, a lookup of a missing file reads the folder that should
hold it, and when that folder is missing too, its parent. Smashcraft 0.0.44
measured one lookup at 32-35 ms in a CustomMapData of 94,057 files with no hot
folder; 32 lookups a second asked for about 1.1 s of work per second of game,
and Warcraft stalled for minutes. The reloader bounds that
([runtime](../src/platform/hotReload.ts), wisp:src/platform/hotReload.ts):

| Client has seen | Lookups | Worst case at 35 ms per whole-CustomMapData lookup |
| --- | --- | --- |
| Neither the host marker nor a manifest | Every 16th poll (0.5 s), alternately for the marker and the next manifest: two a second | 70 ms per second of game (7%); no stall longer than 35 ms |
| The marker or any manifest, so the hot folder exists | Every poll (32 a second), for the next manifest | The hot folder only: about 0.37 µs per entry, the whole-folder rate per file. It holds a manifest per published version, the marker and the full and delta payload files of two versions, so 1,000 reloads cost about 0.4 ms per lookup, 12 ms per second of game (1.2%) |

Starting the map adds at most two lookups once (the first manifest, then the
marker), and a hot folder with a manifest or marker from an earlier session
starts the client at every poll. The per-entry rate is derived from the
whole-folder measurement; small hot folders were not timed natively.

The poll timer itself ticks 32 times a second, alike in every client, and is
never restarted: a client's timer state must not depend on what its own
files hold. Only whether a poll looks changes.

The bound left reload latency once a client has seen a host unchanged:
Smashcraft's native median was 0.841 s and the sample's 0.298 s (both measured
with every poll looking, while every reload sent the whole bundle). A client
that has seen neither the marker nor a manifest when the first reload is
published finds one within a second, so that first reload is up to 1 s slower;
`wisp hot` creates the marker when it starts, before the first compile, so a
first compile that takes 1 s or more costs nothing. Wisp never deletes the hot
folder or its marker; deleting the folder during a match restores the
whole-folder cost in that client until the match ends.

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
