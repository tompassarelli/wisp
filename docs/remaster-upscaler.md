# Learned texture upscaler for the remaster (wisp#109)

Decision record for which learned upscaler the native window's [remaster at load](native-window-plan.md#remaster-at-load) should run on the player's own GPU, measured on 31 October 2026. Tom asked for a measured bake-off on real Classic textures (2026-10-31).

## Decision

Adopt **Real-CUGAN, the SE 2x conservative weights** (bilibili, MIT), run by Wisp's own wgpu compute kernels inside wisp-window. Keep today's edge-directed Catmull-Rom filter as the fallback and as the alpha upscaler.

Reasons:

- Its licence is clear for code and weights.
- Its 2x weights are 2.6 MB.
- It ran close to the fastest model measured: realesr-animevideov3 was about 0.37 s per texture faster on the RTX, and the 890M ran CUGAN over all 12 textures in 2.44 s.
- It invented no detail on the sheets, and its seams stayed within 0.006 of the source at 2x.
- Tom's informed read of the Paladin and Footman crops preferred it.

The blind viewers did not separate it from the other faithful candidates (see [what the viewers showed](#blind-viewers)). The choice among those rests on licence, size, speed and that read, not on a blind win.

## Candidates and licences

Licences were read from each repository through the GitHub API on 2026-10-31. Weights are adopted only when their licence is permissive and covers them. A model whose weights are non-commercial or unlicensed is rejected.

| candidate | arch | weights source and revision | weight licence | result |
|---|---|---|---|---|
| Real-CUGAN SE 2x/4x conservative | CUNet (waifu2x line) | bilibili/ailab release `Real-CUGAN` (tag commit d7f36f1f); ncnn port nihui/realcugan-ncnn-vulkan 20220728 (395302c5), as packaged by nixpkgs | MIT (`Real-CUGAN/LICENSE`, bilibili 2022, at 2799af78; no separate weight licence, the weights are that repository's release assets); port MIT | **adopted** |
| Real-ESRGAN x4plus | RRDB, 64 MB | xinntao/Real-ESRGAN release v0.1.0; ncnn conversion in Real-ESRGAN-ncnn-vulkan v0.2.0 | BSD-3-Clause (repo a4abfb29); port MIT (37026f49) | rejected: invents grit, slowest |
| Real-ESRGAN x4plus anime 6B | RRDB, 9 MB | release v0.2.2.4; same ncnn package | BSD-3-Clause | rejected: flattens painted shading and terrain grain |
| realesr-animevideov3 x2/x4 | SRVGG compact, 1.2 MB | release v0.2.5.0; same ncnn package | BSD-3-Clause | faithful; runner-up |
| realesr-general-x4v3 | SRVGG compact, 2.4 MB | release v0.2.5.0 `.pth`; ncnn conversion from upscayl/custom-models 4b6d2cfa (repo has no licence, so used only to measure; a shipped copy would be converted from xinntao's `.pth`) | BSD-3-Clause | faithful on skins, invents blades on grass |
| 4x-PBRify UpscalerSPAN V4 (community game-texture model) | SPAN | Kim2091/PBRify_Remix 190db537, `Extras/Old_Models/4x-PBRify_UpscalerSPANV4.pth` | CC0-1.0 | licence fine; **not run**, no ncnn or ONNX build exists and converting it needs PyTorch |
| 4x-HDCube (community game-texture model) | RRDB | OpenModelDB 782aac08 entry, Venomalia/HDcube | CC0-1.0 | licence fine; not run, same reason |
| 4x-UltraSharp, 1x-ITF-SkinDiffDetail, 4x-FireAlpha and other OpenModelDB game-texture models | ESRGAN | OpenModelDB 782aac08 | CC-BY-NC(-SA)-4.0 | **rejected: non-commercial** |
| SwinIR, HAT | transformer | JingyunLiang/SwinIR 6545850f, XPixelGroup/HAT 1638a9a8 (weights on Google Drive and Baidu) | Apache-2.0 code; weights carry no separate licence | not run: no Vulkan port, and transformer cost is too high for an 890M-class GPU |
| waifu2x | CUNet/UpConv | nagadomi/waifu2x cc385f97 | MIT | not run; Real-CUGAN is the same architecture retrained, and it was run |

## Bake-off

Twelve textures came from the player install on gex45 (`classic-24371`, read with CascLib from `war3.w3mod:`). They stay in `~/.local/state/wisp/remaster-bakeoff`, never in Git:

- four fighter skins whose alpha marks team colour: Footman, HeroPaladin, HeroDeathKnight, Rifleman
- four tiling terrain atlases: Lords_Grass, Lords_Dirt, Lords_Rock, Ashen_Rock
- four effect textures with alpha: Clouds8x8Fire, Dust5A, Flare, Shockwave10

Each learned model upscales RGB only. Alpha, including the team-colour mask, is upscaled by Catmull-Rom and put back, so mask edges match today's filter in every arm. Terrain atlases get 16 px of wrap padding before inference, and the padding is cropped after. For x4-only models, 2x is the 4x output reduced with Lanczos. Three blends were added at Tom's request: x4plus-anime 30% with CUGAN 70%, the same at 50/50, and CUGAN 70% with today's filter 30%.

### Wall time

Per texture, one process each, which includes Vulkan start and model load (about 1.4 s on gex45). Median of the 12 textures, gex45 RTX PRO 4000 Blackwell:

| model | 2x ms | 4x ms |
|---|---|---|
| Real-CUGAN conservative | 2032 | 2282 |
| realesr-animevideov3 | 1665 | 1883 |
| realesr-general-x4v3 | (from 4x) | 2039 |
| x4plus-anime | 2363 | 2221 |
| x4plus | 3192 | 2982 |

One process over all 12 textures (1.04 Mpx with padding), which is what a load-time pass would look like:

| device | CUGAN 2x | CUGAN 4x | start-up alone |
|---|---|---|---|
| gex45 RTX PRO 4000 | 2720 ms | 4412 ms | 2069 ms |
| laptop Radeon 890M (RADV), CPU pressure under 7% | 2441 ms | 4416 ms | 469 ms |

For CUGAN 2x without start-up, that is about 0.65 s per Mpx on the RTX (1.6 Mpx/s) and about 2.0 s per Mpx on the 890M (0.5 Mpx/s). On the same RTX, the other models over all 12 took 4859 ms (x4plus-anime 4x), 2378 ms (animevideov3 2x), 7485 ms (x4plus 4x) and 4306 ms (general 4x).

Today's edge-directed filter, single-threaded on gex45's CPU with farm runners beside it, took 1 to 207 ms per texture at 2x and 7 to 1006 ms at 4x.

Two measurements are missing:

- **CPU inference.** It was not measured, because the laptop run was stopped when Tom was playing.
- **The laptop's per-texture numbers.** They were measured under a load of 64, so they are not used.

### Seams

The wrap discontinuity of each atlas's first 64 px cell is the mean absolute difference between its left and right columns. The source values are 0.116 (grass), 0.077 (dirt), 0.098 (rock) and 0.064 (Ashen rock), because atlas cells tile with their neighbours and not with themselves. CUGAN was below the source at 2x on grass, dirt and rock (0.059, 0.035, 0.090) and 0.006 above it on Ashen rock (0.070). At 4x it stayed within 0.02 of the source. x4plus at 4x on Ashen rock rose to 0.120. x4plus-anime fell to 0.005 on dirt, which is the flattening the viewers saw. Padding was by whole atlas. Per-cell padding is part of the runtime plan below.

### Blind viewers

Three fresh viewers each ranked the nine arms on the twelve 2x sheets. Each sheet had the source plus tiles A to I, shuffled. The rubric came first: the painted look, then clean alpha edges, then sharpness.

Mean rank, lower is better:

| arm | all | fighters | terrain | effects |
|---|---|---|---|---|
| anime 50 / CUGAN 50 | 4.11 | 4.25 | 4.67 | 3.42 |
| CUGAN 70 / filter 30 | 4.19 | 4.00 | 3.67 | 4.92 |
| animevideov3 | 4.28 | 5.17 | 3.42 | 4.25 |
| today's filter | 4.44 | 5.00 | 2.67 | 5.67 |
| anime 30 / CUGAN 70 | 4.56 | 4.42 | 3.75 | 5.50 |
| CUGAN | 4.69 | 4.83 | 4.83 | 4.42 |
| general-x4v3 | 5.00 | 4.08 | 6.00 | 4.92 |
| x4plus | 6.17 | 5.92 | 7.17 | 5.42 |
| x4plus-anime | 7.56 | 7.33 | 8.83 | 6.50 |

What the viewers showed:

- **Position bias dominated.** Tile A's mean rank was 1.0, 1.9 and 3.0 for the three viewers, and tile I's was 7.0, 6.25 and 6.0. One viewer ranked A first on all twelve sheets. Two viewers said the differences on skins and effects were too small to rank with confidence.
- **The shuffle was not balanced.** All four terrain sheets put the arms in the same order, with today's filter at A. Its terrain win is therefore position, not quality.
- **The top six arms are within 0.6 rank of each other.** That spread is smaller than the position effect, so the test does not separate them.
- **What it does show** is what the written reasons name on content:
  - x4plus-anime turns grass and dirt into "flat, plastic" fields and loses the grain.
  - x4plus adds "crunchy, high-frequency" grit and outlines that the source lacks.
  - general-x4v3 invents grass blades.

  Those three are rejected.

Viewer reads, quoted:

- Viewer 1: "the tile that kept the source's brush strokes and colour and sharpened edges only gently ... I liked least the tiles that flattened texture into smooth plastic ... and the tiles that added a crunchy, high-frequency texture that the source lacks."
- Viewer 2: "conservative, painterly upscales. They keep the original shading, colour and brush grain, with smooth but crisp edges and no halos. The tiles I ranked last were ... plastic-smooth ... hallucinated texture ... over-sharpened."
- Viewer 3: "The worst ones went one of two ways. Some smoothed the texture into flat, waxy colour fields ... Others added grit, heavy outlines, desaturation or haze that the original painting never had."

### Models through the native renderer

The finalists were drawn as models through wisp-window's own `Renderer`, offscreen on gex45's RTX with one fixed light, in a match-zoom framing and a close framing:

- the source textures
- today's filter
- CUGAN
- anime 30 / CUGAN 70
- CUGAN 70 / filter 30

The models were Paladin, Footman, Grunt and the Ashenvale rock doodad, whose AshenRocks texture tiles. The sheets are `preview/models-match.png` and `preview/models-portrait.png` in the bake-off folder.

At match zoom the five rows can barely be told apart, because a 256 px skin covers fewer screen pixels than texels at that distance. The upscale shows only in close framings such as portraits, victory screens and zoomed replays. That bounds the value of the remaster at 2x, and it is why 4x (High) is not worth its cost.

These artifacts belong to the scratch render path and are the same in every row:

- team colour drew black
- frame 0 of sequence 0 shows some attachment planes
- `gutz` and `Shockwave_Ice1` were not supplied

## Runtime plan

- **Engine.** Wisp's own WGSL compute kernels on wgpu (`remaster/cugan/kernels.wgsl`, strung in `network.rs`): the 3x3 and 2x2 stride-2 convolutions, the two transposed convolutions, the squeeze-excitation mean, gate and scale, with each crop-and-add residual fused into the layer that precedes it, over f32 tensors in pooled storage buffers. The graph is the 30 weighted layers of the port's `up2x-conservative.param`; a plain CPU pass of the same graph (`reference.rs`) checks the kernels to 1e-3 in a unit test. wgpu 30 is already wisp-window's renderer dependency (MIT OR Apache-2.0), so the player's GPU on Vulkan, Metal or D3D12 runs it with no new runtime and no added native library. The weights are embedded in the library as the port's own `models-se/up2x-conservative.bin`, unmodified (2.6 MB, half floats, sha256 in references.md), so nothing is downloaded and no conversion step exists; the MIT notice is in `docs/notices/real-cugan-MIT.txt` and beside the weights. They are not derived from Blizzard art.
- **Alternatives.** Each was measured or sized on 2026-10-31.
  - ncnn through FFI (Tencent, BSD-3-Clause; `libncnn.so` 13.1 MB in nixpkgs 20250503) is the reference the kernels are checked against, and the fallback if the kernels miss the speed above.
  - `ort` 2.0.0-rc.15 (Apache-2.0) with ONNX Runtime 1.24.4 adds 26.2 MB and has no vendor-neutral GPU path on Linux.
  - burn 0.22.1 (MIT OR Apache-2.0) with its wgpu backend runs the same graph, at a much larger compile cost.
- **Alpha and team colour.** Only RGB goes through the network. Alpha, which holds the cutout edge and the team-colour mask, keeps today's edge-directed Catmull-Rom, so team-colour edges are identical to today's. The RGB under alpha 0 is left as the network makes it, because the shader replaces it with the team colour.
- **Tiling seams.** A texture under `TerrainArt\` is wrapped by 16 px on every side, run as a mirrored picture and cropped after, which is what the reference tool was given for the bake-off; the network reaches 18 px, so the outermost two px of its context are mirrored. Every other texture is mirrored at its edge. The padding is by whole texture, not by 64 px cell, because that is what the seam numbers below measured. A texture runs as one tile unless its widest activation (64 channels at twice the tile plus context) would exceed 160 MiB or the adapter's storage binding limit, which the window raises to 160 MiB at device creation where the adapter allows it; a 512 x 256 atlas with its padding is one tile, so the squeeze-excitation means cover the whole picture as in the reference's exact mode.
- **Sharing the GPU with the menus.** The bake runs the network on the window's own device and queue while the menus draw, so a texture's run is cut into submissions of at most 256 million multiply-adds (about 3 ms on the 890M, which runs the network at some 90 million a millisecond): each layer is dispatched in bands of rows that fit, and at most one submission waits behind the one the GPU is running, so a frame queues behind two at the most and the GPU never idles between them. The bake waits for its submissions with non-blocking polls: wgpu 30's blocking `poll` holds the device's snatch lock for as long as the GPU takes, and `present` needs that lock for writing, so with one submission per texture and a blocking wait every frame waited out a whole texture. On a cold cache of Smashcraft 0.3-dev.576 (1000 textures) the select screen ran 20 to 33 ticks/s with frame p99 120 to 350 ms through a 138 s bake before, and 59.6 to 60.3 ticks/s with frame p99 at most 22 ms through a 316 s bake after (31 October 2026): the bake now gets only the GPU time the menus leave.
- **Cache.** The existing remaster cache (`$XDG_CACHE_HOME/wisp/remaster`, `LOCALAPPDATA` on Windows), keyed by source bytes, quality, the edge rule and the method: the key names the model (`real-cugan-se-up2x-conservative-20220728`) or `edge-directed`, so an entry made by one method is never read as the other's and a machine that falls back never fills a Real-CUGAN entry. Nothing derived from the player's files leaves that folder.
- **First run.** Measured in the result below: the 12 bake-off textures take 1.9 s on the 890M and the Classic install's 7,562 textures under 1024 px take under five minutes there, once; later runs read the cache.
- **Fallback.** When the adapter is a software one (llvmpipe, WARP), the weights do not load, the kernels are refused by the device, the remaster runs today's filter for every texture and says so once on stderr. A run that fails on one texture falls back for that texture alone: the notice names its path, the next texture still goes through Real-CUGAN, and the fallback result is not cached under the Real-CUGAN key. A tile smaller than 6 pixels inside its context (a 1 to 4 pixel side, or the sliver left at the edge of a split texture) is extended with its own mirrored context to 6 and the extra output dropped, because the network needs more than 4 pixels inside its 18 of context; that case once made a 38 wide run fail and, with it, every later texture use the filter (31 October 2026). High quality takes one doubling from Real-CUGAN and the further one from today's filter.

## Cost

One worker box:

- the CUNet kernels in WGSL
- golden checks against ncnn on the 12 textures
- the fallback

Players pay 2.6 MB in the library and a one-time GPU pass, then cache reads of 0 to 11 ms per texture.

## Result (31 October 2026)

Real-CUGAN 2x conservative runs in wisp-window's remaster on wgpu (Refs #109). `WISP_REMASTER=standard` doubles a texture's RGB with it; alpha, the fallback and High's second doubling stay with today's filter.

1. **Matches the ncnn port.** `cargo test -p wisp-window --test cugan_bakeoff -- --ignored` on the 890M, against realcugan-ncnn-vulkan 20220728 run with the same inputs and one exact tile (`-t 1200`): mean absolute colour error in bytes of 255, over visible pixels, was footman 0.049, heropaladin 0.039, herodeathknight 0.042, rifleman 0.040, lords_grass 0.570, lords_dirt 0.683, lords_rock 0.647, ashen_rock 0.308, clouds8x8fire 0.063, dust5a 0.000, flare 0.039 and shockwave10 0.036. The test fails above 1.0 and also asserts that every alpha byte equals today's filter's. The port's own default (tiles of 400 and a rough squeeze-excitation sync between them) differs from its exact mode by about 1.5 on the 512 px wide textures, which is why the wide ones are compared in exact mode; the stored bake-off outputs for those five came from the default. The terrain references pad by exact tiling: the bake-off's first padding went through ImageMagick's `-distort`, which resampled the picture by about 2.9 levels. A second unit test checks the kernels against a plain CPU pass of the same graph to 1e-3.
2. **Speed.** 12 textures, 0.94 Mpx with the terrain padding, CPU pressure 12% before and 5% after: 1905, 1865 and 1895 ms on the 890M, 873, 833 and 875 ms on gex45's RTX PRO 4000, each after a start-up of 46 to 128 ms (890M) and 83 to 402 ms (RTX) for the pipelines. Today's filter alone, on the CPU beside it, takes about 1.3 s on the laptop and 0.7 to 1.0 s on gex45, and runs in parallel with the GPU. A full Classic install, `classic-24371`, has 7,668 textures outside the `_hd`, `_de` and locale mods (650 BLP icons and 7,018 DDS files, read from CASC by name); 7,562 of them are under 1024 px (183.1 Mpx), 102 are larger and left alone, and 4 the decoder cannot read: 294.4 s on the 890M at CPU pressure 4%, and 147.3 s on the RTX. Today's filter alone takes 239.0 s and 143.1 s for the same, so the filter on the CPU nearly sets the time on the RTX, and the network does on the 890M. These run once; later runs read the cache. `cargo run --release -p wisp-window --example cugan_bench -- FILES...` reproduces them.
3. **Fallback.** With a software adapter, `Upscaler::on` returns today's filter, `announce` writes one line (`wisp remaster: llvmpipe ... is a software adapter, so textures use the edge-directed filter instead of Real-CUGAN`) and the output is byte for byte today's filter's. Two unit tests in `remaster/upscaler.rs` cover it: one on any adapter described as software and one on the machine's real llvmpipe when it has one.
4. **Seams.** Lords_Grass at 2x, first 64 px cell (128 px at 2x), mean absolute difference between opposite edges on a 0 to 1 scale: columns 0.116 and rows 0.110 in the source, 0.059 and 0.059 in the output; whole texture, 0.148 and 0.122 in the source and 0.054 and 0.042 in the output. The test asserts the output is no worse than the source. The 3x3 tiled sheet is `~/.local/state/wisp/remaster-bakeoff/cugan-wgpu/lords_grass.3x3.png`, outside Git.
5. **Licence.** The weights, their MIT notice and their revision are recorded in references.md, the allowlist names the file, and the library embeds both the weights and the notice text (`remaster::REAL_CUGAN_NOTICE`, tested), so every build that carries the weights carries the notice; `docs/notices/real-cugan-MIT.txt` is the copy in the notices folder the player build ships.
