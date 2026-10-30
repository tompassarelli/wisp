# Native window (plan)

Status: planned, 30 October 2026, and revised once after an adversarial
review. This page plans only; each box at the end is its own issue.

Tom decided on 30 October 2026 that the one to two frames of input lag Chrome
can add are too much for a competitive fighter. Wisp's standalone window
(`wisp play --standalone`, [play.md](play.md#standalone-window)) becomes a
native Rust program for the window, keyboard and pad input, GPU drawing and
sound, and Chrome goes. The simulation and rollback stay TypeScript on Bun,
because the same code compiles to Lua inside Warcraft III. The Rust side is
the shell.

## What exists

- **The loop.** `runStandalone` (host/play/standalone.ts) serves a page that
  Chrome opens. The page (host/browser/standalone.ts) reads keys and the
  Gamepad API at each `requestAnimationFrame`, sends the input over one
  WebSocket (`/frames`), and draws the scene Bun returns as JSON. Live play
  keeps one request ahead, so each scene shows input read one display frame
  earlier (play.md, "Standalone window").
- **The renderer.** It is the same one headless captures use
  (host/render/headlessRender.ts launches Chrome; the page side is
  host/browser/). It has two layers:
  - `vendor/war3-model.mjs`: 10,140 lines, MIT, 4eb0da/war3-model 4.0.1 with
    Wisp's patches (vendor/README.md). It holds MDX/MDL parsing, BLP
    decoding, animation interpolation, skinning (including Wisp's
    four-weight classic skin and per-layer alpha) and WebGL drawing. Its
    ModelRenderer interleaves pose computation with GL calls. It also ships
    WGSL shaders for a WebGPU path that Wisp does not use.
  - Wisp's WebGL code in host/browser/: headlessRender.ts (626 lines:
    instances, sequences, lighting, model order, captures), terrain.ts,
    water.ts, passes.ts (shadow, depth, postprocess), emitters.ts, gl.ts,
    matrix.ts and ddsTexture.ts.
- **What the renderer is given.** All of this is TypeScript that runs in
  Bun and does not touch the GPU:
  - the scene snapshot `RenderScene` (host/scene/, host/render/);
  - camera and UI placement (host/render/screen.ts) and culling;
  - terrain mesh rows and doodad poses (host/terrain/);
  - the sound resolver (host/render/standaloneSound.ts);
  - the game's `readAsset`, which serves map imports
    (`extractMapImports`) before the player's Warcraft files.
- **Sound.** The page plays sound cues with WebAudio after fetching
  bytes from `/sound`.
- **Measuring.** `standalone.json` records step, request, draw and
  presentation intervals. The press-latency harness that wisp-latency is
  built (host/play/pressLatency.ts) presses a key through an in-process
  XTEST request and watches a screen region with grim, whose grabs end one
  per compositor frame. It reports a one-frame bracket from press to changed
  pixels, and its results go into
  [online-plan.md](online-plan.md) under "Input-to-display latency". Native
  Warcraft's press-to-display time has not been measured. What is measured is
  press to map read: 4 ms p50 at RTT 0
  (smashcraft:docs/warcraft-api-netcode-findings.md).

## Decisions

### Process shape: one process, Bun calls a Rust library

The window is a Rust `cdylib` (`wisp-window`, in a new `window/` Cargo
workspace beside `relay/`). Bun opens it with `bun:ffi` `dlopen`. The library
starts its own threads: a window thread running the winit event loop, created
off the process main thread with `with_any_thread(true)` (winit 0.30 offers it
on Windows, X11 and Wayland), and a render thread that owns the wgpu device
and the frame clock. Bun's main thread keeps running the map, the netcode and
the sockets.

Each frame, the render thread samples input and wakes Bun through a
`threadsafe` `JSCallback` that carries the input. Bun runs one step and hands
back the scene with one FFI call that passes a pointer and a length. The
render thread then draws and presents.

Measured on this machine (Bun 1.3.13, a Rust cdylib firing every 16.667 ms on
its own thread, 300 wakes, 30 October 2026):

- one FFI call: 41–49 ns;
- wake from a Rust thread to the Bun thread, with Bun's event loop idle:
  12 µs p50, 21 µs p95, 0.21 ms p99, 0.34 ms max;
- the same wake while a timer kept the JS thread busy 4 ms of every 5:
  2.2 ms p50, 4.0 ms p95, 5.0 ms max.

So the seam costs about 1% of a frame at p99, as long as the Bun thread is
idle when the input is sampled. The busy figure shows the one rule the shape
imposes: between frames, Bun does only short work (socket reads, the
netcode's bookkeeping) and finishes it before the next sample point. The
first box measures the step, the scene encoding, garbage collection pauses
and `readAsset` times in that window.

Two kinds of Bun work could break that rule, and each has an owner:

- **Asset reads.** `readAsset` is the game's function and runs on the Bun
  thread today (`/asset`, host/play/standalone.ts). Rust queues its requests,
  and Bun serves them only right after it hands back a scene, within a 2 ms
  budget per frame. If W1 measures a single read over 2 ms, the reader moves
  into a Bun Worker. The game then exports its reader as a module path rather
  than a closure.
- **Who owns the clock.** A scripted or local session steps once per window
  frame, so the window's clock is the sim's clock. A networked session is
  `paced` (host/play/standalone.ts, `StandaloneSession.paced`): the netcode
  advances frames on its own timer, with time sync and rate correction, and
  `step` only hands over the input. There the netcode keeps the frame rate,
  and the window sets only the phase. Each sample delivers input to the
  netcode's next local frame, and the netcode's tick is phase-locked to the
  window's sample point. The window draws the latest confirmed or predicted
  scene. Rate correction still speeds up or slows down the tick, so the two
  clocks never fight over the rate. W2 owns the phase lock.

`threadsafe` `JSCallback` is marked experimental in Bun's documentation, and
its calls are asynchronous. W1 therefore pins the Bun version the window was
measured on and covers four things:

- `unref` on the callback;
- shutdown order, so Rust never calls into a Bun that has closed;
- `catch_unwind` at every exported function, so a Rust panic never crosses
  FFI;
- a test that kills the window mid-frame.

Rejected: Rust hosts the window and runs Bun as a child process over shared
memory. A cross-process wake (futex, eventfd, a Windows event) is also in the
microsecond range, so it cannot beat 12 µs by a margin that matters at
16.7 ms. It also adds a second executable, a shared-memory lifecycle on two
operating systems and crash coordination between processes. A garbage
collection pause in the sim hits both shapes equally, since the sim is Bun in
both. Revisit only if the first box measures the in-process wake failing the
budget below, which would be new evidence.

Rejected: a blocking FFI call that waits for the sample point. It would also
block Bun's event loop, so UDP packets would be read only after the step that
needed them.

### Libraries

Licences were checked on crates.io on 30 October 2026 and are recorded in
[references.md](references.md). All are permissive. None is copied into the
tree; they are Cargo dependencies, and the player build ships their licence
texts.

- `winit` 0.30.13, Apache-2.0: window, keyboard, focus and fullscreen on
  Windows, X11 and Wayland.
- `wgpu` 30.0.1, MIT OR Apache-2.0: drawing on Vulkan (Linux), DX12 (Windows)
  and GL as a fallback. Its `naga` translator (same licence) takes WGSL.
- `gilrs` 0.11.2, Apache-2.0/MIT: pads on Linux through evdev, with SDL
  controller mappings.
- `windows` 0.62.2, MIT OR Apache-2.0: Windows.Gaming.Input read directly
  on Windows (see Pads).
- `cpal` 0.18.2, Apache-2.0: audio output.
- `claxon` 0.4.3 (FLAC) and `hound` 3.5.1 (PCM and float WAV), both
  Apache-2.0: the first sound decoders. W6 settles the rest (see Sound).
- `image-blp` 1.2.0 (MIT), `ddsfile` 0.6.0 (MIT) and `image` 0.25.10 (MIT OR
  Apache-2.0, PNG, JPEG and TGA only): textures. The browser decodes all five
  formats today (host/browser/headlessRender.ts).
- `fontdue` 0.9.5 (MIT OR Apache-2.0 OR Zlib): rasterizing the TTF and OTF
  fonts the scene names. Its fallback is the Warcraft install's own font,
  where the browser falls back to `sans-serif`.
- `serde_json` (MIT OR Apache-2.0): the scene snapshot.
- `bytemuck`: GPU buffer layouts.

Rejected: `symphonia` (MPL-2.0) as the default. Its file-level copyleft adds
an obligation to offer its source with the player build. It stays the
fallback if W6 finds a codec the permissive decoders cannot read.

Rejected: an existing Rust MDX crate. crates.io has none under `mdx-rs` or
`war3-model`. The reference behaviour is Wisp's patched war3-model anyway.
That code is MIT, so porting it is allowed with its notice kept; the notice
is already recorded in vendor/war3-model.LICENSE.

### Lowest-latency present path

At 60 Hz a frame (T) is 16.7 ms. A press waits for the next sample, then
travels this path:

1. Wait for the sample point. This averages T/2 and is at most T. Any
   fixed-rate game pays it, and Warcraft does too.
2. Input read: keyboard events reach the window thread as they happen; pads
   are read at the sample point (see Pads).
3. Wake Bun: 0.21 ms p99, measured above.
4. Map step, then scene encoding: W1 measures both.
5. Pose and draw in Rust, with CPU encoding and GPU time.
6. Present, then the compositor if one is in the path, then scanout.

The target has two parts:

- **Window share.** From the sample point to the changed pixels, the p95 is
  at most one frame, T. The p50 is at most 10 ms. A design that showed each
  sample a whole frame late would fail the p50, and the just-in-time design
  below predicts step + draw + margin + scanout, well under that.
- **Against Warcraft.** Press-to-display p50 is no worse than native
  Warcraft's on the same machine with the same harness.

The Chrome window misses the first part by construction. It reads input at a
display frame and draws the result one display frame later (the one-request
lead). Chrome's compositor and the system compositor can each queue another
frame on top.

How the native window meets it:

- **Present mode.** The default is `Fifo` with
  `desired_maximum_frame_latency: 1`: no tearing, supported everywhere, and
  the only mode whose acquire blocks on the display, so it is the only one
  the pacing below can anchor to. wgpu treats the latency value as a hint and
  clamps it; Vulkan creates latency + 1 images. The library therefore reads
  the image count back and logs it in `standalone.json`.
  - `Mailbox` and `Immediate` (tearing, "vsync off") are player settings,
    off by default. Under them the window paces from the last `Fifo`-learned
    phase and the monotonic clock. The latency harness reports them
    separately.
  - The source for which modes each platform offers is wgpu 30's
    `PresentMode` documentation.
- **Frame pacing.** Each frame runs in this order:
  1. Present.
  2. Acquire the next image. Under `Fifo` with one image of latency this
     blocks until the display releases the previous image, so the return
     time anchors the phase. Acquiring before sleeping is what makes the
     anchor real; sleeping first would only measure the window's own call.
  3. Sleep until the sample point: anchor + T − p99(wake + step + encode +
     draw) − margin. The p99 is a moving window over the last 120 frames, and
     the margin starts at 1 ms.
  4. Sample, step, draw into the acquired image, and present.

  A late present shows up as the next acquire blocking about one extra
  vblank. The margin then grows by 0.5 ms, and after 600 clean frames it
  shrinks back.

  On Wayland the acquire returns at the compositor's buffer release, not at
  the vblank. The offset depends on the compositor, so W2 measures it with
  the harness and tunes the margin to it.

  This replaces the browser's one-frame lead. A scripted run keeps its three
  requests ahead as today.
- **Fullscreen.** Play opens borderless fullscreen by default. On Windows
  this gets DXGI's independent flip, which skips DWM composition. On Wayland
  it lets the compositor scan out directly instead of compositing. A windowed
  mode stays for development, and its extra compositor frame is reported, not
  hidden.
- **Refresh rates above 60 Hz.** The sim stays at 60 steps a second. The
  window presents at every vblank. A step runs on the first vblank whose
  anchor is at or after the step's 60 Hz due time, and its sample point is
  set from that vblank (at 144 Hz, steps fall 2 or 3 vblanks apart). Vblanks
  between steps redraw the last scene. The target is stated at 60 Hz.

How it is measured:

- **Linux.** The press-latency harness gains `--window native|chrome|warcraft`.
  Each run writes press-to-change p50 and p95, and the window share: the
  sample timestamp, which the library logs per frame on the monotonic clock
  it exports over FFI, subtracted from the time of the changed pixels.
  - The harness reads that same clock through the library, so the two sides
    share one clock.
  - grim reads the compositor's output, not light off the panel. Scanout and
    panel response add the same constant to every target, so the comparisons
    hold.
  - Screen capture can stop the compositor scanning out directly. W2 runs
    each target both windowed and fullscreen and reports both, so that
    effect is visible rather than assumed.
- **Windows.** The harness cannot run there, because xdotool and grim are
  Linux tools. W2 measures Windows with PresentMon (MIT, Intel), which
  reports each present's time to display, plus the library's own logged
  time from sample to present.

Results go into online-plan.md's "Input-to-display latency" section beside
wisp-latency's Chrome numbers.

### Porting the renderer

**Kept in TypeScript.** Bun decides what is drawn and where:

- the `RenderScene` snapshot and its live/capture split;
- camera and UI placement (screen.ts) and culling (culling.ts);
- terrain mesh rows, cliff overrides and doodad poses (host/terrain/);
- the sound resolver;
- `readAsset` with map imports.

The TypeScript side also keeps its own use of war3-model: MDX/MDL parsing
(host/models/models.ts) and BLP decoding (host/scene/mapPreview.ts), plus
the CPU posing that `screenBounds.ts`, focus, emitter inventory and the
fidelity tools use for bounds. war3-model therefore stays vendored for those
uses. Only its WebGL drawing goes, and its build drops `ModelRenderer`'s GL
half. Bounds and drawing then run two posing implementations, and render
compare (below) is the check that they agree.

The scene goes to Rust as the same JSON the page receives today, parsed with
`serde_json`. If W1 measures encode plus parse above 1 ms p99, the scene moves
to a fixed binary layout before the parity boxes.

**Rewritten in Rust.** This is everything that holds GPU state or runs per
vertex, with the line references in host/browser/headlessRender.ts:

- **Models (W3):**
  - MDX/MDL parsing;
  - sequence sampling, including Wisp's `sample`/`rotate` and global
    sequences;
  - node posing and skinning, including the four-weight classic skin;
  - materials, layers, filter modes, team colour and per-layer alpha;
  - HD materials with the environment prefilter (vendor/README.md).
- **Textures (W3):** BLP, DDS, PNG, JPEG and TGA decoding (lines 179–205).
- **Lighting and fog (W4):** the environment-map ambient light (line 79) and
  fog (lines 131–136, 326).
- **Effects (W4):** particle (2), ribbon and popcorn emitters, lightning
  (line 589), and floating text tags (line 597).
- **Passes (W4):** cinematic filter quads (lines 355–400) and the shadow,
  depth and postprocess passes.
- **World (W4):** terrain, water and sky drawing from the TS-built meshes.
- **UI (W4):** UI quads and text: fonts from the scene, stroke, `|c` colour
  codes and `|n` breaks (lines 412–435, 523, 615).
- **Captures (W3):** PNG capture, offscreen through wgpu without a surface.

Shaders start from Wisp's patched GLSL, translated to WGSL. war3-model's own
WGSL is a cross-check, not the reference, since it lacks Wisp's patches.

Why posing moves into Rust for drawing: war3-model's ModelRenderer computes
poses inside its GL calls, so keeping drawing-side posing in TS would still
mean rewriting that layer. It would also put posing on the Bun thread, inside
the latency path. Rust poses on the render thread once the scene arrives, and
only for bones and emitters that place something, as today.

**Assets.** Rust asks for a file by path, and Bun answers through
`readAsset` within the budget under "Process shape", handing the bytes over
FFI. Decoding runs on Rust worker threads. The window keeps today's rules:

- the visible scene loads before the first input step;
- a newly shown model loads between frames;
- captures wait for every model.

**Parity.** Each renderer box adds scenes to `bun wisp render compare`. It
renders the same `RenderScene` through Chrome and through the native
renderer offscreen, then compares the PNGs per region with one fixed bound.

The bound cannot come from Chrome against itself: one deterministic renderer
on one machine has a spread of almost zero. A different GPU API differs
legitimately in filtering, mip generation, multisampling and sRGB handling.
So W3 records the bound before any native image is judged, from Chrome's
spread across two ANGLE backends (`--use-angle=vulkan` and `gl`, as
host/render/headlessRender.ts already selects). The bound is set per region
and per metric and is never widened afterwards.

`headless --render` then moves to the native offscreen renderer, so one
renderer serves play and captures.

### Host, status and output

The native window takes over the page's whole job, not only its drawing
(W1, except where a later box is named):

- **The host protocol.** It replaces `/config`, `/prepare`, `/frames` and
  `/complete` with FFI calls.
- **Status text.** It shows the loading screen with progress, the error
  text, and the key and pad help line that the page's `status` element shows
  today.
- **`standalone.json`.** It keeps the same fields (`presentedMs`, `frameMs`,
  `intervalMs`, startup and prepared counts, adapter, audio counts), which
  net-accept reads (smashcraft:ts/scripts/wisp/netAccept.ts). It adds the
  present mode, the image count and the sample-to-present time.
- **Window lifetime.** Closing the window closes the session.
- **Captures and `--headless`.** Requested capture frames and `--headless`
  run through an offscreen surface with no window (W3).

### Pads, keyboard and platforms

- **Keyboard.** Use winit's physical `KeyCode`, which matches the browser's
  `event.code`. The key table and button names stay as in play.md. Held keys
  clear when the window loses focus.
- **Linux pads.** gilrs reads evdev events. The render thread drains them at
  the sample point, so nothing waits on a poll timer. The pad's USB polling
  rate (often 125 Hz) is hardware, and Warcraft pays it too.
- **Windows pads.** gilrs polls on a background thread that sleeps 8 ms
  between polls under Windows.Gaming.Input and 10 ms under XInput
  (gilrs-core `windows_wgi/gamepad.rs` line 35 and `windows_xinput/gamepad.rs`
  line 32, master on 30 October 2026). That quantizes a press by up to 8 ms.
  The render thread therefore reads every pad itself at the sample point
  through the `windows` crate, and gilrs is not used on Windows:
  - `Gamepad::GetCurrentReading` for Xbox-layout pads;
  - `RawGameController::GetCurrentReading` for the rest, such as
    DualShock-style pads, which gilrs's backend also covers. W5 maps these
    through the same SDL mapping database gilrs uses on Linux.
- **Mapping.** The browser's standard-layout indices carry over:
  - 0 attack, 1 jump, 2 special, 3 jump;
  - 4 walk, 5 grab, 6 and 7 shield;
  - 8 view, 9 start;
  - 12 to 15 for the d-pad;
  - left stick on `axisX`/`axisY`, with Y up.

  Axes pass through raw with no window deadzone, as the browser passes
  `axes[0..1]`; the game applies its own threshold (Smashcraft's 0.28).
  `gamepadIndex` keeps its meaning. The input type stays `{ buttons, axisX,
  axisY }`. Analog shield pressure (smashcraft:docs/standalone-parity.md) is
  later input design, not this plan.
- **Platforms.** The targets are Linux on X11 and Wayland with Vulkan, and
  Windows 10 and 11 with DX12. macOS is out: winit needs its main thread
  there, which Bun owns.

### Sound

W6 first lists every sound file the resolver reaches in a player's install,
by container and codec. The resolver tries `.flac`, `.wav`, `.mp3` and `.ogg`
(host/render/standaloneSound.ts), and Warcraft's WAVs may be ADPCM, which
`hound` does not decode. Decoders are chosen from that list, each with its
licence entered in references.md.

Playback follows the page's rules:

- one cpal output stream, with a buffer of at most 256 frames;
- volume as `volume / 127`;
- pitch as a playback-rate change, done with linear resampling in the mixer
  as WebAudio's `playbackRate` does;
- decoded assets reused by resolved path, keeping each handle's variation.

### Player build (smashcraft#807)

The player build is Bun's `bun build --compile` executable of Smashcraft's
play command, with `wisp-window.dll` or `libwisp_window.so` beside it. The
executable opens the library by path relative to `process.execPath`. It has
no Chrome, no source tree and no GPU lease (`gpuLease: false` already
exists). Wisp's CI builds the library for Windows and Linux as an artifact,
and Smashcraft's player build takes it from there. Whether
`bun build --compile` can embed the library instead of shipping it beside the
executable is checked in W7; shipping it beside is the default either way.
Publishing remains Tom's call, made when smashcraft#807 is next.

### Migration order

`--window native` is added beside the Chrome window, which stays the default
and keeps working. The native window becomes the default only once it passes
the same checks the Chrome window holds:

- Smashcraft's standalone parity (smashcraft#806);
- net-accept with `presentedMs.p95` at most 16.7 ms;
- render compare;
- the latency target.

Then one change deletes, with every caller updated:

- the Chrome window and the browser bundle;
- host/browser/;
- war3-model's WebGL half;
- the Chrome path of `headless --render`.

Only main is supported, so no fallback flag survives.

## Boxes

Order:

- W1 first; W7 can run beside it.
- W2, W3 and W5 follow W1. W2 also needs wisp-latency's harness to land.
- W4 follows W3. W6 follows W1.
- W8 follows W2 to W7, and smashcraft#806, which creates
  `bun wisp parity standalone`.
- W9 follows W8.

Command flags, commands and test files named in a Done when that don't exist
yet are created by that box. Each graphics run takes the gpu lease as
`headless --render` does.

- **W1 Native window seam, host and pacing probe** (built; [wisp#105](https://github.com/tompassarelli/wisp/issues/105)). It adds:
  - the `window/` workspace with the `wisp-window` cdylib and its Bun
    binding;
  - `play --standalone --window native`, which opens a window, reads the
    keyboard, wakes Bun per frame and draws a clear colour plus the step
    counter, while encoding the real scene;
  - the host, status text, `standalone.json` and window lifetime from "Host,
    status and output";
  - the callback's `unref`, shutdown order and `catch_unwind`;
  - `bun wisp window probe`, which runs the sample map's scene and writes
    percentiles for wake, step, scene encode plus parse, garbage collection
    pauses, `readAsset` and present interval.

  Done when:
  `cd ~/code/wisp/main && bun wisp window probe --frames 600 --out build/window-probe && jq -e '.wakeMs.p99 < 1 and .sceneMs.p99 < 1 and .gcPauseMs.max < 2 and .presentedMs.p95 <= 17.5' build/window-probe/probe.json`
- **W2 Present path, phase lock and press-to-display latency** ([wisp#107](https://github.com/tompassarelli/wisp/issues/107)).
  It adds:
  - `Fifo` with the image count read back, and `Mailbox` and `Immediate` as
    settings;
  - acquire-then-sleep pacing with miss detection, and the 60 Hz step rule
    above 60 Hz;
  - borderless fullscreen;
  - the netcode tick's phase lock for paced sessions;
  - the harness's `--window native|chrome|warcraft`, run windowed and
    fullscreen;
  - PresentMon numbers on Windows.

  It records every result in online-plan.md, "Input-to-display latency".

  Done when:
  `cd ~/code/wisp/main && bun wisp latency press --window native --trials 100 --out build/latency && jq -e '.windowShareMs.p95 <= 16.7 and .windowShareMs.p50 <= 10 and .pressMs.p50 <= .warcraft.pressMs.p50' build/latency/latency.json`
- **W3 Native model renderer, captures and render compare** ([wisp#108](https://github.com/tompassarelli/wisp/issues/108)). It
  covers:
  - models, textures and HD materials as listed;
  - asset requests through `readAsset`;
  - offscreen capture and `--headless`;
  - `bun wisp render compare`, with its bound recorded first from Chrome's
    spread across two ANGLE backends.

  Done when:
  `cd ~/code/wisp/main && bun wisp render compare --reference chrome --candidate native --scenes test/render/models.json`
- **W4 Native lighting, effects, passes, world and UI** ([wisp#109](https://github.com/tompassarelli/wisp/issues/109)). It
  covers:
  - everything in the W4 rows of the rewrite list, text included;
  - full-scene compare, including Smashcraft's stages.

  Done when:
  `cd ~/code/wisp/main && bun wisp render compare --reference chrome --candidate native --scenes test/render/scenes.json`
- **W5 Native pads on Linux and Windows** ([wisp#110](https://github.com/tompassarelli/wisp/issues/110)). It adds:
  - gilrs and evdev drained at the sample point on Linux;
  - `Gamepad` and `RawGameController` read at the sample point on Windows;
  - the index mapping, raw axes, `gamepadIndex` and focus clearing.

  A Linux test creates a virtual pad through uinput, presses a button, and
  asserts the press is read at the next sample point.

  Done when:
  `cd ~/code/wisp/main/window && cargo test -p wisp-window input && cargo test -p wisp-window --features uinput pad_press_reaches_next_sample`
- **W6 Native sound** ([wisp#111](https://github.com/tompassarelli/wisp/issues/111)). It covers:
  - the codec list of the sound files the resolver reaches, with the
    decoders chosen from it;
  - cpal playback with the page's volume, pitch and reuse rules;
  - the audio counts in `standalone.json`.

  Done when:
  `cd ~/code/smashcraft/main/ts && bun wisp play --standalone --window native --script test/native/pads/cpu-expert.pad --frames 1070 --out build/native-audio && jq -e '.missingSounds == [] and .audioPlayed > 0' build/native-audio/standalone.json`
- **W7 wisp-window in CI on Linux and Windows** ([wisp#106](https://github.com/tompassarelli/wisp/issues/106)). It adds:
  - `cargo build --release` and `cargo test` for `window/` in ci.yml and
    windows.yml;
  - a headless `window probe` smoke run on a software GPU (lavapipe on
    Linux, WARP on Windows);
  - the libraries uploaded as the `wisp-window` artifact;
  - the check of whether `bun build --compile` can embed the library.

  Done when:
  `gh run list -R tompassarelli/wisp -w windows.yml -b main -L 1 --json conclusion -q '.[0].conclusion' | grep -x success`
- **W8 Native window becomes the default** ([wisp#112](https://github.com/tompassarelli/wisp/issues/112)). Smashcraft's standalone
  parity and net-accept pass with `--window native`, W2's latency target
  holds, and `--window native` becomes the default.

  Done when:
  `cd ~/code/smashcraft/main/ts && bun wisp parity standalone test/native/pads/cpu-expert.pad --presentation native,pool-predicted --window native && bun wisp net-accept --window native --out build/native-accept`
- **W9 Captures on the native renderer; delete the Chrome window**
  ([wisp#113](https://github.com/tompassarelli/wisp/issues/113)). `headless --render` draws offscreen through `wisp-window`. One
  change then deletes host/browser/, the browser bundle, the Chrome launch,
  war3-model's `ModelRenderer` GL half and `--window chrome`. It updates
  every caller, knip.json and play.md.

  Done when:
  `cd ~/code/wisp/main && ! rg -l 'google-chrome|browserBundle|initGL|--use-angle' host src package.json knip.json && bun test`

## Sources

- bun:ffi wake and call cost: measured on this machine, 30 October 2026,
  with a Bun 1.3.13 script and a 10-line Rust cdylib. Both are scratch and
  were not kept; the figures are above. `JSCallback`'s `threadsafe` option
  is documented as experimental: https://bun.com/docs/runtime/ffi
- wgpu 30.0.1 `PresentMode` and `SurfaceConfiguration`
  (`desired_maximum_frame_latency`): https://docs.rs/wgpu/30.0.1/wgpu/enum.PresentMode.html
- winit 0.30.13 `with_any_thread` on Windows, X11 and Wayland:
  https://docs.rs/winit/0.30.13/winit/platform/windows/trait.EventLoopBuilderExtWindows.html
- gilrs 0.11.2 Windows backends and poll sleeps:
  https://docs.rs/gilrs/0.11.2/gilrs/,
  https://gitlab.com/gilrs-project/gilrs/-/blob/master/gilrs-core/src/platform/windows_wgi/gamepad.rs,
  https://gitlab.com/gilrs-project/gilrs/-/blob/master/gilrs-core/src/platform/windows_xinput/gamepad.rs
- Crate licences: the crates.io API, 30 October 2026 ([references.md](references.md)).
- The plan was revised once after an adversarial review by a fresh Sonnet
  reviewer on 30 October 2026. The review found that:
  - the TypeScript side still uses war3-model;
  - the rewrite list missed text, fog, lightning, text tags, filters and
    three texture formats;
  - a bound taken from one renderer's own spread was unmeetable;
  - the pacing needed acquire-then-sleep and could not anchor under
    `Mailbox`;
  - the netcode's paced clock and Bun-thread asset reads needed owners;
  - the Windows pad read narrowed device support;
  - the page's host, status and output work had no owner.
