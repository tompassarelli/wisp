# Render compare

`bun wisp render compare` renders one list of model scenes through two
renderers and records, per region and per metric, how far the two images
differ. Its first use is the bound for the native window's renderer
([plan](native-window-plan.md), box W3, "Parity"): the bound is measured
from Chrome on two ANGLE backends before any native image is judged, and
is never widened afterwards.

```
bun wisp render compare --reference chrome-vulkan --candidate chrome-gl \
  --scenes test/render/models.json --out build/render/bound
```

## Backends

| Name | Chrome flags |
| --- | --- |
| `chrome-vulkan` | `--use-gl=angle --use-angle=vulkan` |
| `chrome-gl` | `--use-gl=angle --use-angle=gl-egl --ozone-platform=headless` |
| `chrome-swiftshader` | `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` |

`chrome-gl` is ANGLE's OpenGL ES backend over EGL with no display, so it
runs on a machine with no X server, where `--use-angle=gl` cannot open its
display. A backend that cannot start fails the run: the compare never falls
back to another one the way `headless --render` does. Where NVIDIA's EGL
vendor file is installed, Chrome is told to use it, so `chrome-gl` and
`chrome-vulkan` draw on the same GPU and the spread is the API's, not a
second vendor's. `bound.json` records the GPU each backend reported.

Chrome renders run in a gpu machine-capacity lease; the command reruns
itself inside one when the machine has a capacity helper and the run holds
none.

## Scenes

`test/render/models.json` lists the scenes: the render size and, per scene,
an MDL model under `test/render/models`, the pose and camera that draw it
and an optional generated texture. The models are written for the test and
carry no game assets. A texture is a deterministic RGB checker
(`checkerPng`), so filtering and mip selection have a pattern to blur.

| Scene | What it exercises |
| --- | --- |
| `Wisp121Checker` | A large repeating, wrapped texture seen at a grazing angle: filtering and mip selection |
| `Wisp121Blend` | Three overlapping half-transparent, two-sided quads of team colour: blending and depth order |
| `Wisp121Pyramid` | A textured solid with five faces: edges, depth and minified sampling |

## Regions and metrics

Each scene gives two regions. A reference pixel is on an **edge** when a
neighbour in its 3x3 block differs from it by more than 16 levels; every
other pixel is **flat**. Edges are where filtering, multisampling and
rasterization rules differ; flat areas are where colour handling does.

Per region the report holds, as `measured`:

- `maxDelta`: the largest per-channel difference, in levels of 255;
- `p99Delta`: the 99th percentile of each pixel's largest channel difference;
- `meanDelta`: the mean of that difference;
- `differingFraction`: the fraction of pixels past 2 levels.

`bound` is each measure times 1.5, so a rerun's jitter stays inside it,
rounded up (levels to a whole level, the fraction to a thousandth) and
capped at the scale.

## Output

`--out DIR` gets `reference/` and `candidate/` (each backend's PNGs and
`render.json`) and `bound.json`: the two names, the GPU each reported, the
render size and `regions`, an array of `{ name, scene, area, pixels,
measured, bound }`.

A later `compare --candidate native` is judged against the recorded bound
of its regions; the bound is a number in the plan, not a rerun.

## Native candidate

`--candidate native` (or `--reference native`) draws the scenes through the
native window's renderer with no window: `host/window/nativeRender.ts` builds
each scene with the window's own `drawScene`, pushes the models and textures
through `readAsset`-style reads into `wisp_offscreen_*`
(`window/wisp-window/src/offscreen.rs`), waits until every file is built and
reads the image back as a PNG. It draws at the Low graphics preset on the
machine's default high-performance adapter, and `render.json` records that
adapter. `chrome` names the ANGLE Vulkan backend, and `--out` defaults to
`build/render/REFERENCE-CANDIDATE`.

`bun wisp render compare --reference chrome --candidate native --scenes
test/render/models.json` on gex45's RTX PRO 4000 (2026-10-31) measured:

| Region | `maxDelta` | `p99Delta` | `meanDelta` | `differingFraction` |
| --- | --- | --- | --- | --- |
| Wisp121Checker flat | 42 | 10 | 8.98 | 1.000 |
| Wisp121Checker edge | 160 | 134 | 73.56 | 0.999 |
| Wisp121Blend flat | 37 | 36 | 11.94 | 1.000 |
| Wisp121Blend edge | 91 | 90 | 26.12 | 1.000 |
| Wisp121Pyramid flat | 54 | 10 | 9.21 | 1.000 |
| Wisp121Pyramid edge | 165 | 56 | 26.17 | 0.966 |

Every region is far outside the recorded bound of 0. By eye the native
frames match Chrome's geometry, camera and blend order; they differ in the
background (darker), the model colours (the native grade desaturates and
darkens them) and the checker's far field, which the native renderer mips to
a flat grey where Chrome shows moire.
