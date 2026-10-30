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

- **Engine.** Wisp's own WGSL compute kernels on wgpu: conv3x3, leaky ReLU, the squeeze-excitation pool, transposed conv and crop-add of the CUNet graph. wgpu 30 is already wisp-window's renderer dependency (MIT OR Apache-2.0), so the player's GPU on Vulkan, Metal or D3D12 runs it with no new runtime and no added native library. The weights ship with Wisp as one 2.6 MB fp16 file (`up2x-conservative`, MIT; a shipped copy is converted from bilibili's release, and the notice goes with the player build). They are not derived from Blizzard art.
- **Alternatives.** Each was measured or sized on 2026-10-31.
  - ncnn through FFI (Tencent, BSD-3-Clause; `libncnn.so` 13.1 MB in nixpkgs 20250503) is the reference the kernels are checked against, and the fallback if the kernels miss the speed above.
  - `ort` 2.0.0-rc.15 (Apache-2.0) with ONNX Runtime 1.24.4 adds 26.2 MB and has no vendor-neutral GPU path on Linux.
  - burn 0.22.1 (MIT OR Apache-2.0) with its wgpu backend runs the same graph, at a much larger compile cost.
- **Alpha and team colour.** Only RGB goes through the network. Alpha, which holds the cutout edge and the team-colour mask, keeps today's edge-directed Catmull-Rom, so team-colour edges are identical to today's. The RGB under alpha 0 is left as the network makes it, because the shader replaces it with the team colour.
- **Tiling seams.** Wrap-pad by 16 px before inference and crop after. The follow-up box checks that 16 px covers the network's receptive field, and pads each 64 px terrain cell by the cells it tiles with. Unit skins and effects edge-clamp.
- **Cache.** Use the existing remaster cache (`$XDG_CACHE_HOME/wisp/remaster`, `LOCALAPPDATA` on Windows), keyed by source bytes, quality and algorithm. The algorithm string names the model and weights hash, so changing the model re-fills it. Nothing derived from the player's files leaves that folder.
- **First run.** CUGAN 2x runs at about 1.6 Mpx/s on gex45's RTX and about 0.5 Mpx/s on the 890M, plus one start-up of 0.5 to 2 s. A full Classic install's texture pixel count was not counted in this box, so the first-run time for the whole install is that count divided by those rates. The follow-up box measures it. A match's own textures (12 here, 1.04 Mpx) take about 2.4 s on the 890M.
- **Fallback.** When wgpu finds no hardware adapter, only a software one (llvmpipe, WARP), or the kernels fail validation, the remaster runs today's filter. The cache records which method made each entry.

## Cost

One worker box:

- the CUNet kernels in WGSL
- weight conversion with its notice
- golden checks against ncnn on the 12 textures
- the fallback

Players pay a 2.6 MB download and a one-time GPU pass, then cache reads of 0 to 11 ms per texture.

## Follow-up box

Run Real-CUGAN 2x conservative in wisp-window's remaster on wgpu (Refs #109).

Done when:

1. `WISP_REMASTER=standard` on a machine with a hardware adapter fills the cache with CUGAN outputs whose RGB is within 1/255 mean absolute error of realcugan-ncnn-vulkan 20220728 on the 12 bake-off textures, and alpha equals today's filter.
2. On the 890M, one process upscales those 12 textures in at most 2.5 s, and a full Classic install's textures in a measured time recorded in this doc.
3. With only a software adapter (`WGPU_ADAPTER_NAME=llvmpipe`), the same run produces today's filter's outputs and logs the fallback once.
4. Lords_Grass at 2x tiled 3x3 shows no seam above the source's cell-edge MAE.
5. The weights file, its MIT notice and its conversion source are recorded in references.md, and the player build ships the notice.
