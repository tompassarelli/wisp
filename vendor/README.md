# Model renderer

`war3-model-2e61b3ed83350c04fb9df92ecb5cf0fad39e0509.tgz` builds
4eb0da/war3-model's npm 4.0.1 source revision
`542d884380c358b19db1b25f2d7d1072dd8c636f` with the adjacent source patch.
The owning source commit is `2e61b3ed83350c04fb9df92ecb5cf0fad39e0509`
in `~/code/war3-model/worktrees/hd-prefilter-precision`.

The HD environment prefilter shader needs high precision floats for its
32-bit radical-inverse factor, `2^-32`. With medium precision that factor
underflows, the samples collapse and the compiler removes `uRoughness`.
The renderer then throws while initializing an HD model. The patch changes
the float precision and preserves the required uniform check.

Source: <https://github.com/4eb0da/war3-model>.
License: MIT, Copyright (c) 2017-2023 4eb0da. The package retains LICENSE
and the upstream copyright; its bundled source maps contain the source.
Rebuild with Bun: `bun run build-lib`, then `bun pm pack --ignore-scripts`.
