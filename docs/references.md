# Outside code

Outside sources Wisp uses or derives from, with their licence and what that
use obliges. Licences were read from crates.io on the date given.

## Native window (planned, [native-window-plan.md](native-window-plan.md))

Each crate is a Cargo dependency, not copied into the tree. A player build
ships each licence text below.

- `winit` 0.30.13, Apache-2.0, https://github.com/rust-windowing/winit.
  Window, keyboard and focus. Ship the licence and any NOTICE.
- `wgpu` and `naga` 30.0.1, MIT OR Apache-2.0, https://github.com/gfx-rs/wgpu.
  GPU drawing and WGSL translation. Ship the licence.
- `sdl3-sys` 0.7.2 (SDL 3.4.18), zlib, https://github.com/libsdl-org/SDL.
  Pads through the gamepad API, linked statically with the joystick and
  HIDAPI subsystems. It carries SDL_GameControllerDB. Ship the licence.
- `padbridge-model` 0.4, MIT, https://github.com/tompassarelli/padbridge. The
  melee layout and pad families the window shares with the Warcraft service.
- `cpal` 0.18.2, Apache-2.0, https://github.com/RustAudio/cpal. Audio output.
  Ship the licence and any NOTICE.
- `claxon` 0.4.3, Apache-2.0, https://github.com/ruuda/claxon. FLAC decoding.
  Ship the licence.
- `hound` 3.5.1, Apache-2.0, https://github.com/ruuda/hound. WAV decoding.
  Ship the licence.
- `lewton` 0.10.2, MIT OR Apache-2.0, https://github.com/RustAudio/lewton. Ogg
  Vorbis decoding, with `ogg` 0.8.0 (BSD-3-Clause) under it. Ship both licences.
- `nanomp3` 0.2.0 and `nanomp3-core` 0.2.0, MIT OR Apache-2.0,
  https://github.com/nanomp3/nanomp3. MP3 decoding, a safe port of minimp3.
  Ship the licence.
- `image-blp` 1.2.0, MIT, https://github.com/zloy-tulen/image-blp. BLP
  textures. Ship the licence.
- `ddsfile` 0.6.0, MIT, https://github.com/cwfitzgerald/ddsfile. DDS
  textures. Ship the licence.
- `image` 0.25.10, MIT OR Apache-2.0, https://github.com/image-rs/image.
  PNG, JPEG and TGA textures. Ship the licence.
- `texpresso` 2.0.2, MIT, https://github.com/jansol/texpresso. DDS block
  decompression. Ship the licence.
- `fontdue` 0.9.5, MIT OR Apache-2.0 OR Zlib, https://github.com/mooman219/fontdue.
  UI text rasterizing. Ship the licence.
- `bytemuck` 1.25.2, Zlib OR Apache-2.0 OR MIT,
  https://github.com/Lokathor/bytemuck. GPU buffer layouts.
- `sha2` 0.10, MIT OR Apache-2.0, https://github.com/RustCrypto/hashes. Names a
  remastered texture's cache entry by the SHA-256 of its source. Ship the
  licence.
- `serde_json`, MIT OR Apache-2.0, https://github.com/serde-rs/json. Scene
  snapshot parsing.

Not adopted by default: `symphonia` 0.6.1 (MPL-2.0). Its file-level copyleft
would oblige the player build to offer its source. It is the fallback if the
sound box finds a codec the permissive decoders cannot read.

## Remaster candidates (wisp#109, [remaster-upscaler.md](remaster-upscaler.md))

Licences were read from each repository through the GitHub API on
2026-10-31. The bake-off ran the upscalers as separate measuring tools on
gex45 and the laptop, on textures from the player install that stay outside
Git. Only Real-CUGAN's weights are shipped: the player build carries them in
`window/wisp-window/assets/real-cugan/` with the MIT notice
(`docs/notices/real-cugan-MIT.txt`, the same text as `LICENSE.txt` beside the
weights).

- Real-CUGAN (bilibili, MIT, `Real-CUGAN/LICENSE` at 2799af78; weights are
  the release assets of tag `Real-CUGAN`, commit d7f36f1f, with no
  separate licence), https://github.com/bilibili/ailab/tree/main/Real-CUGAN.
  Adopted: SE 2x conservative weights, 2.6 MB, embedded and run by Wisp's own
  WGSL kernels (`remaster/cugan/`). The exact revision is the file
  `models-se/up2x-conservative.bin` of realcugan-ncnn-vulkan 20220728
  (below), sha256
  `91c72c136e7ff8556323d4449c5ceeff22d9829bf8463a01137cadb8d59b84a0`, copied
  unmodified; the file stores its weights as half floats, and no other
  conversion is made. Its network graph (30 weighted layers of the 2x CUNet)
  is rewritten from the port's `.param` file, which is read as
  a published description of the layers and not copied.
- realcugan-ncnn-vulkan (nihui, MIT, 20220728, 395302c5),
  https://github.com/nihui/realcugan-ncnn-vulkan. Source of the shipped weights
  file, and the reference tool that Wisp's kernels are checked against; its
  tiling and edge padding (18 pixels, mirrored) are mirrored in
  `remaster/cugan/mod.rs`, and nothing is linked.
- Real-ESRGAN (xinntao, BSD-3-Clause, a4abfb29; x4plus, x4plus-anime-6B,
  animevideov3 and general-x4v3 weights are release assets of the same
  repository), https://github.com/xinntao/Real-ESRGAN. Run, not adopted.
- Real-ESRGAN-ncnn-vulkan (xinntao, MIT, v0.2.0, 37026f49),
  https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan. Measuring tool only.
- upscayl/custom-models (no licence, 4b6d2cfa),
  https://github.com/upscayl/custom-models. Its ncnn conversion of
  realesr-general-x4v3 was used to measure only and is not to be shipped.
- ncnn (Tencent, BSD-3-Clause), https://github.com/Tencent/ncnn. The
  fallback engine through FFI if Wisp's wgpu kernels fall short; 13.1 MB
  `libncnn.so` (nixpkgs 20250503).
- `ort` (pykeio, Apache-2.0, 2.0.0-rc.15), https://github.com/pykeio/ort,
  with ONNX Runtime 1.24.4 (26.2 MB). Not adopted.
- burn (tracel-ai, MIT OR Apache-2.0, 0.22.1),
  https://github.com/tracel-ai/burn. Not adopted.
- PBRify_Remix (Kim2091, CC0-1.0, 190db537),
  https://github.com/Kim2091/PBRify_Remix, and 4x-HDCube (Venomalia,
  CC0-1.0, OpenModelDB 782aac08). Game-texture models with clear licences;
  not run, because no ncnn or ONNX build exists.
- OpenModelDB (782aac08), https://github.com/OpenModelDB/open-model-database.
  Source of the licences for the community models. 4x-UltraSharp and the
  other CC-BY-NC(-SA) game-texture models are rejected as non-commercial.
- SwinIR (Apache-2.0, 6545850f), HAT (Apache-2.0, 1638a9a8) and waifu2x
  (nagadomi, MIT, cc385f97). Not run: SwinIR and HAT have no Vulkan port and
  are too heavy, and waifu2x's CUNet line is covered by Real-CUGAN.
- xBR and Super-xBR (Hyllian, libretro glsl-shaders; the one file read
  carries an MIT-style notice, the others were not read). Made for pixel
  art. Not run; not adopted.

## Technique references

Read for method only (2026-10-31). Neither states a licence, so no code, shader text or texture is copied; the water pass in `window/wisp-window/src/render/water.wgsl` is written here and its textures are Warcraft's own water frames read from the player's install.

- Alex Tardif, "Water Walkthrough", https://alextardif.com/Water.html. Gerstner waves with edge dampening, two scrolling normal layers combined in tangent space, noise-broken specular glints, reflections blended by Fresnel falloff, normal-driven refraction with an above-surface rejection test, depth-softened contact alpha, crest and shore foam.
- keobkeig, "Realistic Water Tutorial", https://keobkeig.dev/tutorials/realistic-water-tutorial. Reoriented normal blending of the scrolling layers, Fresnel with F0 0.02, projected caustics from two scrolling layers combined with min, Beer-Lambert depth absorption, and the rule that the Gerstner sum of steepness, wavenumber and amplitude stays under 1.

## Tools

- PresentMon (Intel, MIT), https://github.com/GameTechDev/PresentMon. Run
  as a separate measuring tool for Windows present-to-display latency; not
  linked or shipped.

## Derived

- war3-model (4eb0da/war3-model, MIT; revision, patches and licence in
  [vendor/README.md](../vendor/README.md) and vendor/war3-model.LICENSE).
  Today it is vendored as the browser model renderer. The native renderer
  ports its parsing, interpolation, skinning and material behaviour,
  including Wisp's patches, to Rust. Keep its copyright and MIT notice in the
  ported files' crate and in the player build's notices.

## Researched, not used ([game-api-plan.md](game-api-plan.md#what-extension-engines-were-asked-for))

Read on 31 October 2026 for API facts and feature requests only. Nothing is
copied, linked or shipped, and Wisp's code derives from none of them.

- Warcraft III: Community Edition 0.3.2 (MindWorX, TriggerHappy, Tasyen,
  Vasilii Filippov, BogdanW3, lizreu, Zed), no licence,
  https://github.com/Warcraft-III-Community-Edition/W3CE and
  https://www.hiveworkshop.com/threads/warcraft-iii-community-edition.346600/.
  Native names and signatures were read from `Scripts/common.j` in the
  release's `W3CE.mpq`, without running any of its programs. The issues were
  read in all states. The archive and its files stay out of every
  repository.
- W3CE Discord #community-edition, as Tom's screenshots of 31 October 2026.
  Release, test realm, antivirus and save facts, recorded without quoting.
- Embedded JAPI documentation (PhoenixZeng), no root licence,
  https://github.com/PhoenixZeng/embedded-japi-vue-press. The topic list
  only.
- KKAPI developer docs (https://create.kkdzpt.com/kkapidoc/, platform
  documentation) and YDWE (GPL-3.0, https://github.com/actboy168/YDWE), as
  recorded in [prior-art.md](prior-art.md). No code is taken, and no
  GPL-3.0 derivation.
