# Scripted terrain

Import `terrainLine` and `terrainRectFill` from
`wisp/scripts/wisp/terrainAuthor` in a Bun build script. Both take
`(w3eBytes, tileId, firstPoint, secondPoint)` and return new `Uint8Array`
bytes for `war3map.w3e`. Add those bytes to your map container as its
`war3map.w3e` entry, or supply them directly as `render.terrain.w3e`.
The existing `decodeTerrain` reader and [terrain renderer](headless.md#lighting-fog-and-sky)
consume the result; rendering validation belongs to [#82](https://github.com/tompassarelli/wisp/issues/82).

Coordinates are integer **grid points**, `[east, north]`, from the map's
southwest corner. `(0,0)` is the first stored point; east increases the
column and north increases the row. A point's world position is
`[originX + east * 128, originY + north * 128]`. W3E stores one more point
than cells on each axis; painting corner points can blend neighboring cells.

`terrainLine` paints an inclusive one-point-wide integer line between the
endpoints, stepping along both axes at ties. `terrainRectFill` paints every
point in the inclusive rectangle between either ordering of two opposite
corners. The tile ID must already appear in the usable ground palette
(first 16 entries in version 11, first 64 in version 12). Invalid IDs or
coordinates fail before painting. Neither operation changes its input,
heights, flags, water, cliffs, texture variations, headers or trailing bytes.

Run the original synthetic example from this repository:

```sh
bun examples/terrain.ts
```

It writes `build/terrain-example/war3map.w3e`: an 8 by 6 point grid with
authored `BASE` and `PATH` tile IDs. It draws `PATH` from `[0,0]` to `[7,3]`
and fills `[2,4]` through `[5,5]`: 16 painted points and 32 unchanged points.
Its source shows how to create the synthetic header. These IDs have no
Blizzard art; a real map supplies installed tile IDs and resolves textures
through the user's install. No proprietary files are shipped.

The version 11 field layout and southwest-first ordering follow the
[HiveWE W3E format facts](https://github.com/stijnherfst/HiveWE/wiki/war3map.w3e-Terrain)
(16 September 2025 revision), already used by Wisp's reader. Version 12 uses
that reader's existing 8-byte records and six ground bits. This writer changes
only those ground bits; it copies no outside implementation.
