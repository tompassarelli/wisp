# Clean room

Wisp is an open-source, clean-room runtime for Warcraft III maps
([wisp#75](https://github.com/tompassarelli/wisp/issues/75)). It reimplements
the behaviour maps rely on, from scratch, and loads art at run time from the
player's own legally owned Warcraft III install. These rules apply to every
agent and contributor, in code, tests, fixtures, docs and history.

## Rules

- Never distribute Blizzard assets (models, textures, sounds, music, extracted
  data) or Blizzard code (copied or decompiled).
- No Battle.net login emulation and no DRM bypass. Wisp's online play uses its
  own servers and netcode.
- No Warsmash (AGPL) code; facts only (wisp:docs/warsmash-notes.md).
- No "Warcraft" in a product name; "works with your Warcraft III install" is
  fine.

## Do

- Load models, textures, sounds and data tables from the user's install when
  Wisp runs, through the install-asset loader. Cache extracted files only in
  private local storage outside every repository.
- Commit tests and fixtures made from our own sources: generated files,
  synthetic archives, tones from `ffmpeg`, maps we built. Say in the fixture's
  README how it was made.
- Record measured facts (counts, bounds, timings, offsets, event order) in
  new words, with the build they came from.
- Implement a native from its signature and from behaviour measured in the
  real game (native fixtures), not from Blizzard's script bodies or the
  game's machine code.
- Name game files by their in-game path (`Units\Human\Footman\Footman.mdx`)
  and let the install supply the bytes.

## Don't

## The check

wisp:scripts/cleanRoom.ts runs before every push and in CI. It refuses
game-format files (by extension or leading bytes) and files with more than 20
JASS declaration lines, unless wisp:clean-room-allowlist.tsv lists the path
as `original` or `generated` with how it was made. A refusal names the file:
delete it, regenerate it from our own source, or load it from the install.
Don't rewrite pushed history; open an issue for a file already pushed.
