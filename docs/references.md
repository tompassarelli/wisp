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

## Remaster candidates (wisp#109, [native-window-plan.md](native-window-plan.md#remaster-at-load))

Licences read from each repository's licence file through the GitHub API on
2026-10-31. None of these is linked or shipped; the chosen method is Wisp's own
code, written from the published ideas (structure-tensor edge direction,
Catmull-Rom resampling, premultiplied alpha) and copies nothing.

- Real-ESRGAN (xinntao, BSD-3-Clause, master a4abfb29), https://github.com/xinntao/Real-ESRGAN.
  Licence file BSD-3-Clause (GitHub API; the weights' licence was not checked).
  Not run and not adopted: it needs weights fetched at run time and an ONNX
  or Vulkan runtime, which the classical path avoids.
- Real-ESRGAN-ncnn-vulkan (xinntao, MIT), https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan.
  A runner for the same weights on Tencent's ncnn (licence not read). Not run;
  not adopted for the same reasons.
- waifu2x (nagadomi, MIT), https://github.com/nagadomi/waifu2x. Not run; not adopted (its models target line art, which the Classic
  painted textures are not; this was not tested).
- `ort` (pykeio, Apache-2.0), https://github.com/pykeio/ort. The Rust ONNX
  Runtime binding a model path would use. Not adopted; the classical path needs no runtime.
- xBR and Super-xBR (Hyllian, libretro glsl-shaders; the one file read carries an MIT-style
  notice, the others were not read). Made for pixel art. Not run; not adopted.

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
