# Repros: a moment of play as a test

A player who sees something wrong presses a key; the map saves the last
seconds of play, and `wisp repro FILE` replays them in simulated clients of
the map, where each must land on the checksum the game recorded. With
`--test NAME` it also writes a test that replays the moment, so a bug arrives
as a test rather than a description.

Wisp supplies the file format, the record text a game can save its state
in, the command and the test it writes. The game decides what it saves,
how it restores its state and how it runs the saved frames.

## The file

The map writes a Preload file in the player's CustomMapData with
`writeRepro(filename, header, lines)` (wisp:src/platform/repro.ts), named by
`reproFile(slot, frame, serial, prefix)` so no two repros of a session share a
name: Preloader runs the first content it read from a name for the rest of the
session. The file holds:

```text
wisp-repro 1
build BUILD_ID
frame LAST_FRAME
checksum CHECKSUM_AT_LAST_FRAME
...the game's lines...
end COUNT_OF_GAME_LINES
```

Keep each line within `REPRO_LINE_WIDTH` (200) characters and free of `"` and
`\`: a Preload line becomes a JASS string.
`parseRepro` (wisp:src/runtime/repro.ts) refuses a file whose end line doesn't
count its lines, as one cut short.

## Saving state as record text

`recordTokens(record)` (wisp:src/runtime/recordText.ts) writes a plain record
of nested records, arrays, numbers, booleans and strings as tokens, and
`parseRecord(tokens)` reads them back, in Bun and in Warcraft's Lua alike.
Lua's integers stay integers and its reals stay reals, each real with its exact
binary value: Lua's own text for a number has seven digits in 32-bit Lua, too
few to read a binary32 value back. Undefined fields and array elements are left
out, as Lua leaves them out, so restore into records the game creates and copy
the parsed ones over them with the game's own copy functions. `tokenLines`
packs tokens into lines of a width; `lineTokens` splits them again.

A record keyed by integers (`{ readonly [action: number]: Move }`, a mapped
type over a numeric enum) is the same Lua table as an array, so Lua can't tell
which one TypeScript means. Name every field that holds one:
`recordTokens(state, ["normals", "throws"])` writes those with their keys
(`normals#`), so key 0, gaps and negative keys come back as they were in both
runtimes. A record keyed by integers that isn't named throws
`IntegerKeysUndeclared` with its path (`kit.rows.1.moves`) rather than
come back shifted: always in Bun, and in Lua when a key is below 1. Lua writes
one keyed only from 1 as an array, which Lua reads back as the same table, so
Bun tests are where an undeclared record shows up first.

A match state is thousands of tokens and its checksum a walk of every field:
a map that saves during play spreads that work over frames.

## Replaying: `wisp repro FILE [--test NAME]`

A project adds the command with `makeRepro`
(wisp:scripts/wisp/commands/repro.ts). The command parses its arguments with
the pure `parseReproArgs`; reading, replaying and reporting a repro live in
wisp:scripts/wisp/repro/replay.ts, and `--view` opens its page through the
platform's `PageOpener` (wisp:docs/platforms.md):

```ts
repro: {
  usage: "repro FILE [--test NAME]",
  load: async () => (await import("wisp/scripts/wisp/commands/repro")).makeRepro(async () => ({
    map: MAP, replay: join(sourceDirectory, "replay/moment.ts"), tests: join(sourceDirectory, "replay/repros"),
  })),
},
```

`replay` names the module exporting `replayRepro(repro): ReproResult`. It
restores the saved state, runs each saved frame and returns the checksum it
reached, the frames it ran and any problem on the way, such as a restored
state whose checksum isn't the one saved. The command reads the file, runs
`replayRepro` in two simulated clients of `map` (wisp:docs/headless.md), each
in its own scope of natives and globals, and prints each client's frames and
checksum. It exits 1 unless every client lands on the recorded checksum
without a problem.

`--test NAME` then writes `tests/NAME.tests.ts`: the file's lines and a test
registered with wisp:src/runtime/testing.ts that replays them with
`assertReproLands`. It runs wherever the project runs registered tests,
in Bun and in 32-bit Lua, without simulated clients, so `replayRepro` calls no
natives. The test keeps the checksum the game recorded: a change to the game's
behavior in those frames fails it, which is the moment to edit it to assert
what should have happened.

Bun replays what Warcraft's Lua recorded: a moment lands only where the game's
Bun and Lua runs agree, which a game's own Bun/Lua comparisons check.

## Shrinking a soak failure

`wisp repro FILE --shrink [--out FILE]` takes a soak JSON repro and replays
the match headlessly. Delta debugging removes groups of recorded inputs,
keeping a cut only if the first recorded failure kind still occurs. Inputs
include controller edges, quiet spells, lag spikes, slow frames, typed text
and published files. Their original frame numbers stay intact. The match's
setup and saved state are not changed. A repro that no longer fails with its
recorded kind is refused.

The output defaults to `FILE.shrunk.json` (replacing a `.json` suffix). The
original file stays intact. The command prints the input counts before and
after, replay count and elapsed time. Delta debugging stops when no single
remaining input can be removed while preserving the failure kind; it does
not search every possible combination.

The project adds `soak` to its `makeRepro` declaration:

```ts
soak: {
  project: join(sourceDirectory, "scripts/wisp/soak.ts"),
  tests: join(sourceDirectory, "test/repros"),
},
```

`project` names the existing module whose default export is `defineSoak()`.
`wisp repro SHRUNK.json --test NAME` writes `tests/NAME.test.ts`, a Bun test
that imports that module and its game, replays the shrunk input log, and
fails while the recorded failure kind still occurs. After fixing the game,
run it with `bun test tests/NAME.test.ts`. `--shrink --test NAME` combines
both steps. These soak tests use the headless runtime and belong outside
the game's Lua test sources.

Soak shrinks new repros by default and preserves the original beside each;
`soak --no-shrink` opts out. Saved text moments keep their checksum replay
and inspection commands.

## Inspecting a saved frame

`wisp repro FILE --frame N --out STATE.json` writes the state **after** frame
N in the saved interval. The ordinary two-client replay must first reach the
recorded ending checksum. Inspection runs in those same isolated client scopes
and both results must agree. Invalid frames, missing inspection support, and
frames outside the consumer's saved interval fail without writing output.
The output path must differ from the saved repro, including an existing symlink
to it; the saved file stays unchanged.

`wisp repro FILE --frame N --diff-frame previous --out STATE.json` also
compares N-1 to N. Use `--diff-frame M` to compare any other saved frame M to
N, including when M is later. A backward request restores and replays the
consumer's existing state; it does not reverse the engine or record new state.

The replay module opts in by also exporting
`inspectRepro(repro, frame): ReproInspection | string`
(wisp:src/runtime/repro.ts). It returns a clear refusal string, or the exact
`frame`, `checksum`, canonical `state` text and `fields` with the consumer's
canonical `path` and `value` strings. Capture existing snapshot state and reuse
the ordinary frame executor; inspection must leave live gameplay and the saved
repro untouched. Wisp does not prescribe a game's canonical representation.

The JSON output holds `build`, `frame`, `checksum`, `state`, and `fields`.
With a comparison it also holds `diff: { from, to, fields }`, with changed
field paths sorted lexically. Each change has `path`, `before`, and `after`;
null denotes an absent field and all other values preserve canonical text,
including exact numeric encodings. Renderer and operating-system state are
outside this gameplay snapshot.

## Scrubbing a saved moment

`wisp repro FILE --view` opens a page on this computer and keeps its local
server running until Ctrl-C. Move the frame slider to inspect the canonical
state tree. Yellow fields changed since the previous saved frame; outlined
fields differ between clients. Both clients' values are shown side by side.
For a desync, the page names the first differing frame and offers a button
to jump there. Viewing does not require the two clients to agree or reach the
recorded ending checksum. The inspector must return each client's actual
state, including when they differ.

The viewer uses the same loopback panel server as `tune`. Its read-only
`GET /meta` returns `build`, `start`, `end`, and `firstDivergentFrame` (null
when clients agree). `GET /frame?frame=N` returns `frame`, `clients`, and
`differences`. Each client has the inspection's `checksum`, `state`, and
`fields`, its `client` number, and `changes` since the previous frame.
The first saved frame has no previous-frame changes. Backward scrubbing
restores and replays the saved state, using the same inspector as `--frame`.

To link fields to the TypeScript declarations defining them, add
`viewerSources` to the `makeRepro` project:

```ts
viewerSources: {
  project: join(root, "tsconfig.game.json"),
  file: join(root, "src/game/replay/snapshot.ts"),
  type: "ReplayState",
},
```

Wisp generates a declaration source map with the project's pinned TypeScript
compiler: property paths walk this type, arrays follow their numeric element
type, and each property maps to its original declaration's file and line.
Canonical paths must match the declared state shape. A resolved field carries
`source: { file, line }`; its link opens that declaration with the line
highlighted. Fields with custom serializer labels need paths matching their
declared state to resolve. The server serves only declaration files reached
by a displayed field.

## JSON Lines

`repro FILE --json` writes one result per client, then a summary. Every object
has `schema: 1`, `command`, and `type`. Results carry `ok`, `frame`, `client`,
`repro`, `frames`, `checksum`, and `expectedChecksum`. Failures add `kind`
(desync or error) and `message`. The summary carries `ok`, `counts` (results
and failures), and `elapsedMs`. Inspection files keep their existing format.

## Importing a native replay

`wisp repro import MATCH.w3g [HOST.log] --out ACTIONS.json` reads a native
replay without opening Warcraft. The optional matching Wisp LAN host log
compares every decoded action's count, order, turn, player and payload; any
difference fails the command and stays in the output for inspection.

The JSON includes players, slot assignments, the engine version/build, map
metadata, zero-based host turns, cumulative milliseconds and original player
action blocks. Each action has its name and fields, exact `raw` hex and its
`offset` within that player's block. Add the command block's `offset` to get
its offset in the **decompressed game-data stream**. These are not compressed
file offsets. `records` retains every game-data block, including records the
library does not emit. An unknown or clipped action is named `raw`; its entire
remaining block stays intact instead of being interpreted as more actions.

The parser is maintained [w3gjs 4.3.0](https://github.com/PBug90/w3gjs/tree/40efcfc7bdb8ccb0241823f9aa099b98a62ca0fe)
(MIT; [notice](notices/w3gjs-MIT.txt)). Its low-level game-data parser supplies
record and timeslot boundaries. Its melee action decoder misreads the current
native sync opcode, so the adapter captures original command bytes before that
decoder and uses Wisp's existing LAN action decoder. The adapter depends on
the pinned parser's ordinary private properties. [w3grs's extended action documentation](https://github.com/wakamex/w3grs/tree/dc92490b7668d02793d3fefd00f749e454dc5858)
was used to identify dropped-record coverage; no Rust implementation was copied.
Current native sync, key, frame, mouse, order, selection, chat, trigger and
cache records can be inspected. Their meanings for a particular game are not
assumed to be simulated.

A game can add `importReplay` to its `makeRepro` declaration:

```ts
importReplay: (nativeReplay) => ({
  repro: convertSupportedInputs(nativeReplay),
  simulatedActionOffsets: supportedOffsets,
}),
```

The adapter returns an ordinary `Repro` and the decompressed offsets of the
actions it actually used. It must decode the game's established input protocol,
use its recorded simulation frame numbers (network times are not game frames),
and retain the original starting snapshot and expected ending checksum from
its Wisp recording. Unknown commands must not be counted as simulated.
Missing input rows must fail conversion. The importer runs the result in two
headless clients; only a matching recorded checksum writes
`ACTIONS.json.repro.txt`. It reports the count of simulated actions and the
other retained actions, and adds the simulated offsets to the JSON.
`wisp repro ACTIONS.json.repro.txt --view` then uses the existing frame slider,
client state comparison and backward scrubbing. For a long verified journey, set
`viewerScanDivergence: false` in the project to open without replaying every
frame first. The page says it compares the selected frame; it does not claim
the whole interval agrees. The default still locates the first differing frame.
Projects without this adapter
still import and inspect every raw record; they do not claim reproduction.

The current offline Wisp19 native fixture imported 6,241 turns and 2,392 actions
against the same host's 2,392 records with zero differences. The matching
packet log also compared 2,293 original player blocks byte for byte, with zero
differences. Its `SC_GP` I5
inputs decoded through Smashcraft's existing `decodeTransport`: 1,240 input
rows over frames 361–980 reproduced the original `424399:834377` checksum
in both headless clients. This supported 174 actions; 2,218 others were retained.
The private adapter and replay remain in `~/.local/state/wisp/replay47/`;
reproduce that check on the recording machine with:

```sh
bun ~/.local/state/wisp/replay47/journey.ts import \
  ~/.local/state/wisp/replay47/native.w3g \
  ~/.local/state/wisp/replay47/host.log \
  --out ~/.local/state/wisp/replay47/import.json
bun ~/.local/state/wisp/replay47/compare-packets.ts
bun ~/.local/state/wisp/replay47/journey.ts \
  ~/.local/state/wisp/replay47/import.json.repro.txt --view
```

Keep native `.w3g`, host logs and saved snapshots outside public checkouts.
A replay contains synchronized actions; engine poses and local polling cannot
be reconstructed from those bytes alone.
