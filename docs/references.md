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
- `gilrs` 0.11.2, Apache-2.0 OR MIT, https://gitlab.com/gilrs-project/gilrs.
  Linux pads. Ship the licence.
- `windows` 0.62.2, MIT OR Apache-2.0, https://github.com/microsoft/windows-rs.
  Windows.Gaming.Input pad reads. Ship the licence.
- SDL_GameControllerDB (the copy gilrs 0.11.2 ships), zlib, https://github.com/mdqinc/SDL_GameControllerDB.
  Its Windows rows are vendored in `window/wisp-window/data/` and map Windows raw
  controllers. Ship the licence beside the data.
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
- `serde_json`, MIT OR Apache-2.0, https://github.com/serde-rs/json. Scene
  snapshot parsing.

Not adopted by default: `symphonia` 0.6.1 (MPL-2.0). Its file-level copyleft
would oblige the player build to offer its source. It is the fallback if the
sound box finds a codec the permissive decoders cannot read.

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
