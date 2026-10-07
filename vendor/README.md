# Model renderer

`war3-model.mjs` and `war3-model.d.mts` build
4eb0da/war3-model's npm 4.0.1 source revision
`542d884380c358b19db1b25f2d7d1072dd8c636f` with the adjacent source patch.
The owning source commit is `beaa4ddef28d791753f0eaaeb6d21996b2c1e207`
in `~/code/war3-model/worktrees/hd-prefilter-precision`.

The HD environment prefilter shader reverses 32-bit sample indices.
The fragment shader's default medium integer precision truncates those
indices, collapses the samples and makes `uRoughness` inactive. The renderer
then throws while initializing an HD model. The patch explicitly requests
high integer precision and preserves the required uniform check. On the same
Chrome WebGL2 context, the original and high-float-only shaders had no
roughness location; high-integer-only and high-float-plus-integer shaders did.

Source: <https://github.com/4eb0da/war3-model>.
License: MIT, Copyright (c) 2017-2023 4eb0da. The package retains LICENSE
and the upstream copyright in `war3-model.LICENSE`.
Rebuild with Bun: `bun run build-lib`, then copy `dist/es/war3-model.mjs`
and `dist/war3-model.d.ts` (renamed to `war3-model.d.mts`) into this directory.
The built files ship inside Wisp because Bun cannot resolve a nested local
tarball dependency relative to an installed Wisp tarball.
