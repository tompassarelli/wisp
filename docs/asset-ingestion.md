# Asset ingestion

How a map build puts a game's private imports (models, textures, sounds)
into the map archive, what that costs, and what Wisp optimizes.

## How it works

`MapBuild.build` (wisp:scripts/wisp/mapBuild.ts) copies the game's container
(or base) map, then hands every declared import, every base map file and the
generated files to the native packager (wisp:native/map-pack.c) as one list:

```text
map-pack replace-list MAP.w3x LIST
map-pack extract-list MAP.w3x LIST
```

Each line of `LIST` is `FILE<TAB>ARCHIVE_NAME`. One process opens the archive
once, adds or extracts every line, and closes it once. Later lines win, so
generated files listed after the imports keep precedence. A full file table
is doubled and the add retried, as often as the list needs. The build then
extracts every entry the same way and compares it byte for byte with its
source file.

The single-entry `map-pack replace|extract MAP FILE [ARCHIVE_NAME]` stays for
script-only rebuilds.

## Quality settings

Ingestion is lossless and fixed: every entry is stored with MPQ zlib
compression, exactly the bytes of its source. Nothing is re-encoded,
stripped or converted, so models keep every sequence, bone and material
reference and textures keep their alpha and team-colour layers by
construction. wisp:test/map-pack.test.ts checks this on synthetic clip
models, 32-bit TGAs and BLPs. Source inputs are only read, and the map is
written outside the checkout.

## Why packaging, not the asset bytes

Measured on Smashcraft's private families (7 Oct 2026, aggregate numbers):

| Family | Files | Raw bytes | zlib bytes |
| --- | --- | --- | --- |
| Fighter clips (MDX) | 848 imported | 79.8 MB | 32.8 MB |
| Fighter portraits (TGA) | 260 | 69.2 MB | 27.0 MB |

- The archive already compresses each entry; zlib level 9 instead of the
  default would save 2.3% of the clips.
- The clips' animation keys all fall inside their one sequence: nothing to
  trim. Their geometry is the largest repeated cost (1085 geometry chunks,
  142 distinct), but each clip is a separate archive entry, so removing it
  means changing how the game splits clips into models, not ingestion.
- 16 portraits duplicate another's bytes; sharing them means the game naming
  one path, also outside ingestion.
- Packaging cost one packager process per entry, each opening and closing
  the growing archive: 49 s for these 1,108 entries, plus 23 s of serial
  per-entry extraction to verify them. One list per archive takes 12.2 s and
  2.0 s, with identical entry bytes and archive size.

Entries reach the archive byte for byte, so a consumer map built this way
runs its existing native gates unchanged.
