# Model renderer

`war3-model.mjs` and `war3-model.d.mts` build
4eb0da/war3-model's npm 4.0.1 source revision
`542d884380c358b19db1b25f2d7d1072dd8c636f` with the adjacent source patch.
The owning source commit is `f156013b44d3c685725dd91e0fd9f601a5c9dbb8` (branch `effects-72`, on top of
`2d7b6490495240244808883876458a8bfb1bfad6`) in `~/code/war3-model/worktrees/effects-72`.

The mixed SD/HD cleanup fix is maintained at
`bb69638cbcf4f5c5d58f8badee6d216909813b19` in
`~/code/war3-model/worktrees/mixed-shader-75`. SD renderers never create HD
environment shaders, so destruction skips those absent shader objects when
the next scene replaces an SD model on the same handle.

The HD environment prefilter shader reverses 32-bit sample indices.
The fragment shader's default medium integer precision truncates those
indices, collapses the samples and makes `uRoughness` inactive. The renderer
then throws while initializing an HD model. The patch explicitly requests
high integer precision and preserves the required uniform check. On the same
Chrome WebGL2 context, the original and high-float-only shaders had no
roughness location; high-integer-only and high-float-plus-integer shaders did.

Warcraft's modern classic models also carry weighted bones with classic
material layers. The renderer now identifies HD materials by their shader
type, and draws weighted classic models through its existing WebGL software
skin path, applying all four bone weights instead of averaging bone groups.
This preserves the native classic texture layers without inventing PBR slots.

Layers multiply their own and their geoset's animated alpha and the model's
alpha (`setInstanceAlpha`, an effect's alpha) into the fragment alpha, and
additive layers blend with (source alpha, one), as the MDX filter mode tables
describe. `layerOpacity` and `layerBlendFactors` export those rules. Particle texture cells run row by row and repeat past
the grid's last cell. A squirt emitter fires only on a time step that reaches
its key, never on a zero-length pose refresh.

Wisp adds four changes to the built file. Light records read the 1200,
1300 and 1600 fields (shadow intensity, shadow casting, falloff), as Tom's
`fix/mdx1800-light` branch (`ddda8d7`) reads them, so a whole day/night model
parses. `ModelRenderer.setWispEnvironment` gives the SD and WebGL2 HD model
shaders a directional key light, an ambient fill and linear eye-depth fog;
without it they draw as upstream. Each layer's Unshaded and Unfogged flags,
and additive filter modes, select per layer how that light and fog apply.
A light passed with `linear: true` lights SD layers in linear colour.
Each geoset's animated colour tints its layers in both shaders, in the
order the file stores it: native Classic draws a map's charcoal deck
body (stored 0.20, 0.24, 0.28 over Dalaran_BlackMarble) at rgb 11,8,11,
and the tint read as red, green, blue gives 10,7,9.
`setWispEnvironment`'s `points` adds up to eight omni lights in world space
to both shaders (SD vertex shaders pass the model-space position on, and the
draw's model and normal matrices carry it and the normal to world space):
each adds colour × intensity × N·L, full to its attenuation start and fading
linearly to zero at its end, into the SD lit term and the HD diffuse term.
`setInstanceColor` multiplies unit/effect RGB into that geoset tint before
light and fog. Its default is white; particles and ribbons retain emitter colours.

Source: <https://github.com/4eb0da/war3-model>.
License: MIT, Copyright (c) 2017-2023 4eb0da. The package retains LICENSE
and the upstream copyright in `war3-model.LICENSE`.
Rebuild with Bun: `bun run build-lib`, then copy `dist/es/war3-model.mjs`
and `dist/war3-model.d.ts` (renamed to `war3-model.d.mts`) into this directory.
The built files ship inside Wisp because Bun cannot resolve a nested local
tarball dependency relative to an installed Wisp tarball.

Version-1800 SKIN records store four bone IDs and four weights as little-endian
UINT16 elements; the count names elements, not bytes. Wisp decodes each element
into the renderer's byte palette before uploading it. Weights still total 255.
The adjacent patch keeps this parser change in its upstream TypeScript form.
`scripts/wisp/models.ts` exports `parseModelMDX` for host silhouette and motion
readers, skipping camera/light records those readers do not use.

# Lua 5.3.6 source

`lua-5.3.6.tar.gz` is lua.org's release tarball,
<https://www.lua.org/ftp/lua-5.3.6.tar.gz>, byte for byte (SHA-256
`fc5fd69bb8736323f026672b1b7235da613d7177e72558893a0bdcd320466d60`).
wisp:scripts/wisp/lua32.ts checks that checksum and builds the 32-bit Luas
tests run in from it, so a build needs no network: cloud sessions can't reach
lua.org.

License: MIT, Copyright (C) 1994-2020 Lua.org, PUC-Rio, in `lua.LICENSE`.
