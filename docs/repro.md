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
(wisp:scripts/wisp/commands/repro.ts):

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
