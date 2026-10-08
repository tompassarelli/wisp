# Map preview

`wisp map preview MAP.w3x --out IMAGE.ppm [--packager PATH] [--assets DIR]` reads a built
map and writes its lobby preview texture as a binary RGB PPM image. It prints
the map name, author, player count, source archive entry, `war3map.w3i` flags,
image dimensions and whether a custom preview was imported. The default
packager is built at `build/tools/map-pack` in the current project.

Run it from Wisp's checkout, or register `map` from
`wisp/scripts/wisp/commands/map` in a consuming program. Existing map build
dispatchers can delegate the `preview` verb to that command.

## What selects the texture

The Warcraft 3.0.1 lobby capture in
[Smashcraft #317](https://github.com/tompassarelli/smashcraft/issues/317#issuecomment-6064778830)
shows the parchment minimap even though `war3mapPreview.tga` is imported.
The captured map's flags are 40016, with hide-minimap (`0x1`) unset;
`war3mapMap.blp` is the 256-by-256 parchment texture. Wisp follows that
measured choice rather than treating the presence of Preview.tga as success.
TGA minimap textures are also decoded, including RLE and image orientation.

The command reads `war3map.mmp` and reports its markers. Add `--assets DIR`
to draw start-location icons using your installed game's texture, converted
to TGA at `DIR/UI/MiniMap/MinimapIcon/MinimapIconStartLoc.tga`. The game supplies
the art; Wisp supplies placement, color tint and alpha blending. Without the
asset directory, it writes the underlying texture and reports
`iconsRendered: false` when markers exist. Other marker types require their
own assets and reference calibration.

The 9 October 2026 Classic and Definitive lobby references for
`smashcraft-0911b5da` (parchment) and `custom-minimap-d8fe5996` (fighter lineup)
both select `war3mapMap.blp` with flags 40016. The custom candidate's panels
are identical between modes. Resizing Wisp's marked prediction to the captured
154-pixel panel gives 6.99% RMS pixel error for parchment and 5.24% for the
lineup. Package the desired lobby art as the minimap texture; importing only
`war3mapPreview.tga` leaves the existing parchment in place.

Hidden-minimap
maps and archives containing both supported minimap encodings fail with a
request for a reference instead of selecting an unmeasured fallback.

Keep map archives and output pictures in private local storage outside
repositories. Wisp ships readers and independently recorded facts, with no
Blizzard artwork.
