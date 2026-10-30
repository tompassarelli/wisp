# Native window (plan)

Status: planned, 30 October 2026, and revised once after an adversarial
review. The seam between Bun and Rust was revised again the same day, after
W1's probe failed its bounds three times; see "Seam (revised)", which
supersedes the wake design in "Process shape" and "The game steps on a worker
thread". This page plans only; each box at the end is its own issue.

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

Build and test it from a clean checkout with one command:
`cd window && nix develop --command cargo test -p wisp-window`. The dev shell
(`window/flake.nix`, locked) supplies the toolchain `rust-toolchain.toml`
names, a C compiler, cmake for SDL3, pkg-config, and the libudev and libxkbcommon that SDL3's
evdev driver and winit use, and puts the Wayland, X11 and Vulkan runtime libraries on
`LD_LIBRARY_PATH` for `bun wisp window probe`.

As first built, each frame the render thread sampled input and woke Bun
through a `threadsafe` `JSCallback` that carried the input. Bun ran one step
and handed back the scene with one FFI call that passed a pointer and a
length, and the render thread then drew and presented. "Seam (revised)"
replaces that wake with a blocking call on the game's thread and a scene
deadline; the measurements below still hold.

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

### The game steps on a worker thread

The worker stays. Its wake through the main thread, the `JSCallback` and the
bounds below are superseded by "Seam (revised)", which explains why this
design could not meet them.

Decision (30 October 2026): in a local or scripted native run, the game's
session, its step and the scene's encoding run in a Bun `Worker`, a thread of
the same process, so the process is still one. Bun's main thread keeps only the
seam: the `JSCallback` that the render thread wakes writes the wake's numbers
into a `SharedArrayBuffer` ring (kind, frame, sample time, button mask, handled
time), bumps a counter and calls `Atomics.notify`, and returns. The worker waits
on that counter, steps the map, encodes the scene into one reused buffer and
calls `wisp_window_submit` itself, through its own `dlopen` of the library and
the window's handle; `submit` and the library's other calls are guarded by the
library's locks, so any thread may make them. The main thread opens the window,
starts it, and at shutdown tells the worker to stop and waits for its
acknowledgement before `wisp_window_close`, so the worker makes no call on a
freed handle. The game is named by a module path and an export
(`StandaloneOptions.nativeGame`) because a game object cannot cross threads. A
networked session is `paced` and its netcode owns the sockets and the clock on
the main thread, so it keeps stepping there until W2 moves its transport; a
`runStandalone` call without `nativeGame` also steps on the main thread.

Why: the first box's collection-pause bound is about the thread that answers
the wake. With the sample map stepping on the main thread, Bun ran an eden
collection about every two frames (664 in a 600-frame probe, 1 to 2 ms each, up
to 18 ms) and no JavaScriptCore option changed the count. The count did not follow
the bytes allocated per frame: the collector log shows 0 to 16 KB allocated since the previous collection when they fire,
and the sample map's step, capture and scene build run 600 times in a loop
without one. The guarantee kept is that no frame misses its present because of
a JavaScript pause: the worker's pauses delay only its own submit, and a late
scene is a counted miss (`missedScenes`) while `Fifo` presents the previous
one. The probe therefore reports `gcPauseMs` for the main thread's heap, with
the 2 ms bound, `workerGcPauseMs` for the worker's heap as a figure that must
stay inside the frame, `dispatchMs` for the time from the sample to the worker
starting its step, and `presentedMs`, whose p95 bound of 17.5 ms catches a
worker pause that delayed a present.

Rejected: a `setImmediate` loop that keeps Bun's loop from idling, which
avoids the per-frame collections but segfaults Bun 1.3.13 with a `threadsafe`
`JSCallback`. Rejected: shaving the sample map's step and `JSON.stringify`
allocations, which the loop measurement above shows is not what the collector
follows.

Known Bun 1.3.13 behaviour, reproducible without a window or the game: a
`setInterval` callback at 16 ms that stores a fresh string each tick
(`keep = \`${n}\`` or `keep = JSON.stringify({ a: n })`, `keep` declared outside
the callback) runs about 320 eden collections in 300 ticks under
`BUN_JSC_logGC=1`, while the same callback storing an object (`keep = { a: n }`),
an array, a number or a `Float64Array` runs 42 to 46, and a callback that stores
nothing runs 11 or fewer. `BUN_GC_TIMER_DISABLE`, `BUN_GC_TIMER_INTERVAL`,
`BUN_JSC_useConcurrentGC=false`, `BUN_JSC_percentCPUPerMBForEdenTimer` and
`BUN_JSC_collectionTimerMaxPercentCPU` leave the count unchanged. It has not
been reported upstream; that waits for Tom.

### Libraries

Licences were checked on crates.io on 30 October 2026 and are recorded in
[references.md](references.md). All are permissive. None is copied into the
tree; they are Cargo dependencies, and the player build ships their licence
texts.

- `winit` 0.30.13, Apache-2.0: window, keyboard, focus and fullscreen on
  Windows, X11 and Wayland.
- `wgpu` 30.0.1, MIT OR Apache-2.0: drawing on Vulkan (Linux), DX12 (Windows)
  and GL as a fallback. Its `naga` translator (same licence) takes WGSL.
- `sdl3-sys` 0.7.2 (SDL 3.4.18), zlib: pads through SDL3's gamepad API,
  built from source and linked statically with only the joystick and HIDAPI
  subsystems (see Pads). `padbridge-model`, MIT, supplies the layout.
- `cpal` 0.18.2, Apache-2.0: audio output.
- `claxon` 0.4.3 (FLAC) and `hound` 3.5.1 (PCM and float WAV), both
  Apache-2.0: the first sound decoders. W6 settles the rest (see Sound).
- `image-blp` 1.2.0 (MIT), `ddsfile` 0.6.0 (MIT) and `image` 0.25.10 (MIT OR
  Apache-2.0, PNG, JPEG and TGA only): textures. The browser decodes all five
  formats today (host/browser/headlessRender.ts).
  `window/wisp-window/src/texture.rs` decodes by magic to straight-alpha RGBA8.
  `image-blp` decodes only JPEG-content BLP1: its paletted path takes the
  palette as RGB, where the game and war3-model store BGR, and it leaves 1 and
  4-bit alpha unscaled, so texture.rs reads paletted BLP1 itself. `texpresso`
  2.0.2 (MIT, a dependency of `image-blp`) decompresses DDS blocks. `image-blp`
  brings `image` 0.24 with its default features, which its manifest does not
  let a dependent turn off.
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
spread across two ANGLE backends (`--use-angle=vulkan` and `gl-egl`, the headless form of `gl`;
host/render/headlessRender.ts selects `gl` first). The bound is set per region
and per metric and is never widened afterwards.

**Recorded bound (2026-10-30, wisp#121).** `bun wisp render compare --reference
chrome-vulkan --candidate chrome-gl --scenes test/render/models.json` on
gex45 draws the three model scenes of [Render compare](render-compare.md)
through ANGLE Vulkan and ANGLE OpenGL ES on the same NVIDIA RTX PRO 4000
Blackwell GPU. The 640x360 scenes differ in no pixel: every
region (flat and edge, three scenes) measures 0 in `maxDelta`, `p99Delta`,
`meanDelta` and `differingFraction`, so each region's recorded bound is 0.
The same scenes against SwiftShader measure up to 234 levels at the checker
edges, so the comparison can see a difference when there is one. A native
image on this GPU is therefore judged against an exact match; a native
image on another GPU needs the bound re-measured on that GPU before it is
judged, and the new bound is recorded here beside this one.

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
- **Pads.** SDL3's gamepad API reads every pad on Linux and Windows, the
  stack padbridge feeds Warcraft with, so a pad has the same layout in both
  and the window gets SDL's controller database and its HIDAPI drivers
  (the GameCube adapter through a Wii U adapter among them). The render
  thread calls `SDL_UpdateGamepads` and reads the state at the sample point,
  on the thread that initialised SDL's gamepad subsystem. SDL events are
  switched off so nothing queues, and `SDL_JOYSTICK_ALLOW_BACKGROUND_EVENTS`
  is set as padbridge sets it. The pad's USB polling rate (often 125 Hz) is
  hardware, and Warcraft pays it too.
- **No sleep-quantized poll on Windows.** SDL 3.4.18's Windows build selects
  these joystick drivers (`src/joystick/SDL_joystick.c` lists them,
  `CMakeLists.txt` lines 2464 to 2478 enable them, and each reads in its
  update call):
  - HIDAPI first, for the GameCube adapter, DualShock and Switch pads;
    `SDL_hid_read_timeout` with a zero timeout calls `WaitForSingleObject`
    with 0 and takes the overlapped read's result (`hidapi/windows/hid.c`);
  - the Windows driver for XInput pads (`XInputGetState` in
    `SDL_xinputjoystick.c` line 393) and DirectInput pads
    (`IDirectInputDevice8_GetDeviceState` in `SDL_dinputjoystick.c` lines
    998 and 1003);
  - RawInput, Windows.Gaming.Input and GameInput are present but off: their
    hints `SDL_HINT_JOYSTICK_RAWINPUT` and `SDL_HINT_JOYSTICK_WGI` default to
    false and `SDL_GAMEINPUT_DEFAULT` is false outside GDK.

  The one thread SDL starts for joysticks (`SDL_JoystickThread` in
  `SDL_windowsjoystick.c`) only detects hotplug, by waiting on a device
  notification message or a one-second condition timeout. The HIDAPI rumble
  thread starts only on a rumble request. Neither reads input, so no poll
  interval quantizes a press.
- **Mapping.** SDL's standard-layout positions carry over, pressed as
  padbridge's melee preset (`padbridge_model::pad_bindings`) presses them for
  the pad's family, which the window asks SDL for (`SDL_GetGamepadTypeForID`)
  as padbridge does:
  - on an ordinary pad, A attacks, B specials, X and Y jump, RB grabs and
    either trigger shields;
  - on a GameCube pad (`SDL_GAMEPAD_TYPE_GAMECUBE`) the letters follow the
    print: A attacks, B (SDL west) specials, X (SDL east) and Y jump, Z grabs
    and L and R shield;
  - Start is start, Back is view and the d-pad is left, right, up and down;
  - a control padbridge binds to a move the page has no button for presses
    nothing;
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

## Seam (revised)

Decision (30 October 2026, after three attempts at W1's probe bounds): Rust
owns the frame clock, input sampling and the present. The thread that steps
the game only has to deliver a scene by a deadline. When a scene misses it,
the render thread presents the previous scene on time. Two boxes build this:

- W1b gives the render thread its deadline and its own count of missed
  presents.
- W1c replaces the `threadsafe` `JSCallback` wake with a blocking FFI call on
  the game's thread.

### The assumption the three attempts shared

Every attempt assumed that a JavaScript thread must answer each display wake
within about 1 ms, so its collections sit on the present path. The attempts
made that thread's pauses shorter: first one reused scene buffer, then the
game on a worker, with the main thread only forwarding the wake. That brought
the worst collection from 17.96 ms down to 3.67 ms, but it never met the
bounds, which were:

- `wakeMs.p99 < 1`;
- `gcPauseMs.max < 2` on the main thread;
- `presentedMs.p95 <= 17.5`.

The last run (gex45, exclusive lease, load 4.7 before) measured:

- wake p99 2.16 ms;
- main-thread collections max 3.67 ms over 18;
- present p95 18.02 ms;
- scene p99 0.24 ms;
- worker collections max 4.05 ms over 104;
- 0 missed scenes.

Read against the code, those numbers say three things.

**The present does wait on JavaScript, without limit short of 100 ms.**
`render_loop` (window/wisp-window/src/host.rs) acquires, samples, wakes Bun,
then blocks in `wait_for_scene` for up to 100 ms (`SCENE_WAIT`) before it draws
and presents. `missedScenes` counts only scenes more than 100 ms late, which is
why it read 0. A JavaScript delay longer than what is left of the frame after
the draw makes the present miss its vblank. Nothing in the loop prevents that.

**The 18.02 ms is not missed presents.**

- `presentedMs` is the interval from one acquire to the next. Under `Fifo` with
  one frame of latency, the acquire returns at the vblank that shows the last
  present.
- A present that misses its vblank therefore shows as an interval near 2T,
  33 ms, not 18 ms.
- Sample to scene measured about 3 to 5 ms at p99, inside the frame.
- So a p95 of 18.02 ms is the acquire's wake-up jitter (compositor, Xwayland,
  scheduling) on frames that were on time.

`presentedMs.p95 <= 17.5` gates that jitter, which no seam design changes. It
does not gate misses: 30 of 600 frames could miss and the p95 still pass. It
also hard-codes 60 Hz.

**The wake crosses two event loops.**

- Bun's FFI documentation says a thread-safe callback's arguments are copied on
  the calling thread and the invocation is marshalled onto the JavaScript
  thread. That makes the wake a task on the main thread's event loop.
- The worker then wakes through `Atomics.waitAsync`, whose resolution is a
  second task on the worker's loop.
- Each hop waits for whatever its loop is running, its collections included.
- This is the likely source of the dispatch tail (p95 2.1 ms, p99 3.3 ms), and
  of the main thread collecting once every 33 wakes in Bun's callback
  machinery.
- W1c removes both hops, so its `wakeMs` tests this.

So the bounds split in two:

- **The guarantee.** These bounds protect what Tom asked for, with the latency
  half measured in pixels by W2:
  - no frame misses its present;
  - a sample reaches a present within a frame;
  - no sample is dropped.
- **One design.**
  - `wakeMs.p99 < 1` and the main thread's `gcPauseMs.max < 2` matter only while
    a JavaScript thread sits between the sample and the present.
  - `sceneMs.p99 < 1` is the trigger for a binary scene layout ("Porting the
    renderer"), not a latency bound.
  - `presentedMs.p95` measures the display's jitter.

### Who owns the frame

The render thread owns the frame, alone. The worker calls `wisp_window_start`
once its frame loop is ready, so the first sample has a consumer. From then
on, each frame runs in this order:

1. **Acquire the next image.** Under `Fifo` this blocks until the display
   releases one, and its return is the frame's anchor ("Lowest-latency present
   path"). T is the median of the measured acquire intervals, not a constant.
2. **Sample input.** The sample is the frame number, its time on the library's
   clock and the button mask. It goes onto a bounded queue of 8. When the
   queue is full, the oldest samples stay and the new one is counted in
   `droppedSamples`.
3. **Wait for the scene.** The wait ends when this sample's scene arrives, or
   at the scene deadline, whichever is first.
   - W1b samples right after the acquire, as today, and puts the deadline at
     the anchor plus T minus 4 ms.
   - W2 moves the deadline to the measured p99 draw plus a margin before the
     next vblank, and the sample point to the deadline minus the measured p99
     step.
4. **Draw.** The render thread draws the newest scene that has arrived. If this
   sample's scene has not, it redraws the last scene and counts a late scene
   (`lateScenes`).
5. **Present.**

The game's thread takes samples in order, oldest first. A step that ran late
catches up by stepping twice in one frame. Every sample still becomes exactly
one sim frame, as a fighter's input needs, and the render thread shows the
newest scene.

A scene that misses its deadline is drawn on the next frame, so its sample
waits one frame longer. A new figure, `inputToPresentMs`, records that cost.
For each present, it is the present time minus the sample time of the scene
drawn. It replaces `sampleToPresentMs`, which skipped frames that had no scene.

A present counts as missed (`missedPresents`) when its acquire interval is
more than 1.5 T. When a miss follows a frame whose scene wait ran to the
deadline, it also counts in `missedPresentsAfterLateScene`. That split shows
whether the seam or the display path caused the miss.

W1b adds `wisp_window_next_event(handle, out, 0)`, a non-blocking take of the
oldest queued sample. On each wake, today's worker drains it in order, so no
sample is skipped. That is unlike `takeWakes`, which keeps only the newest.
W1c makes the same call block.

### The wake: a blocking call instead of a callback (W1c)

The worker replaces `takeWakes`. Each frame it does four things:

1. It calls `wisp_window_next_event(handle, out, timeoutMs)`. The call blocks on
   a Rust condvar until a sample is queued, the window closes or fails, or the
   window is told to stop.
2. It steps one frame with that sample's input.
3. It encodes the scene into the reused buffer and calls `wisp_window_submit`.
4. It yields one macrotask turn, `await new Promise(setImmediate)`, so timers,
   messages and `readAsset` completions run.

The yield comes after the submit, outside the time from sample to scene.
`readAssetMs` stays a figure, since a read now finishes only between frames.
The `setImmediate` segfault in "The game steps on a worker thread" needed a
threadsafe `JSCallback` alive in the process. W1c deletes that callback and
checks the yield in its probe run.

What the blocked call does to collections:

- `bun:ffi` calls are synchronous. While a thread waits inside `next_event`, it
  runs no JavaScript and allocates nothing.
- JavaScriptCore stops a thread for a collection only at a safepoint, a point
  where that thread's own code could trigger one (Riptide, WebKit). A thread
  blocked in native code reaches none.
- Each Bun `Worker` has its own heap; the probe's collector log already lists
  the two threads' collections under separate heaps.
- So a blocked worker delays only its own heap's collection. That collection
  then runs inside the step, where `stepMs` and `lateScenes` see it.

The main thread keeps no part of the frame. It opens the window, starts the
worker, and waits for the worker's `completed`, `closed` or `failed` message.
The worker learns of a close or an error from `next_event` and posts it.

Shutdown cannot free the window under the worker. The library's handle
becomes a counted reference to the host (`Arc<Host>`):

- `wisp_window_attach` gives the worker its own reference.
- `wisp_window_release` drops a reference.
- `wisp_window_stop` stops the threads and wakes any blocked `next_event` with
  a stop event. It is safe on a window that has already closed. A `submit`
  after a stop is ignored.

The host is freed when the last reference drops. A worker that misses its
acknowledgement is therefore harmless: its later calls reach a stopped host,
not freed memory. The shared stop word and `stopWakes`' timeout, which today
fall through to `close` regardless, go away.

### Rejected

- **A JavaScript thread that answers each wake.** This is W1 as built, on the
  main thread or relayed to a worker. It has three problems:
  - it puts up to two event-loop hops between the sample and the step;
  - it rests on Bun's `threadsafe` `JSCallback`, which the documentation calls
    experimental;
  - with that callback, the one known way to keep Bun's loop from idling, a
    `setImmediate` loop, segfaults Bun 1.3.13.

  The deadline in W1b alone already takes the wake off the present path. W1c
  removes the experimental dependency and the hops.
- **A shared ring that JavaScript polls.** Rust could write samples into a
  `SharedArrayBuffer`. JavaScriptCore's `Atomics.wait`, however, parks the
  thread in WTF's ParkingLot, which only a JavaScript `Atomics.notify` wakes,
  not a signal from Rust. The worker would have to spin, burning a core, or
  sleep-poll, which adds up to a timer tick to every sample. A blocking call
  does the same wait on a condvar that Rust signals.
- **Tuning the collector.** No JavaScriptCore or Bun option changed the
  collection count ("The game steps on a worker thread"). The deadline makes
  that count irrelevant to the present.
- **A blocking call on the main thread.** It would block the event loop that
  owns the sockets. The worker that blocks owns no sockets.
- **Rust running Bun as a child process.** The reasons under "Process shape"
  stand.

### Paths without a worker

W1c makes `--window native` require `nativeGame` and refuse `--net`.

- The main-thread paths reach the window only through the `JSCallback`, which
  W1c deletes.
- Nothing calls them yet, because Smashcraft adopts the native window in W8.
- W2 brings networked play back. Its phase-locked netcode tick drains the
  queue without blocking (`next_event(handle, out, 0)` until it returns
  nothing).
- W2 also defines how the samples it drains map onto netcode frames. A drained
  sample counts as consumed, not dropped.

### The bounds, restated

The probe measures 600 frames after a 120-frame warmup. Each bound protects
the guarantee:

- `missedPresents == 0`: no frame misses its present, whatever the cause.
- `lateScenes <= 6`: at most 1% of samples miss their deadline and reach the
  screen a frame late.
- `droppedSamples == 0`: every sample becomes a sim frame.

The probe reports the following as figures, not gates:

- `presentedMs`, `inputToPresentMs` and `wakeMs`;
- `stepMs` and `sceneMs`;
- `gcPauseMs` and `workerGcPauseMs`;
- `missedPresentsAfterLateScene`.

`sceneMs.p99` above 1 ms still triggers the binary scene layout.

Tom's target is press to pixels within one frame at p95, and no worse than
native Warcraft. It stays W2's, because only the press harness sees pixels.
These bounds are the part of that target the library can check on its own
clock.

Before the gate, W1b runs `bun wisp window probe --baseline`. It drives the
render loop with no game: Rust submits a canned scene at the sample point. Its
`missedPresents` on the same machine is the display path's own floor. A
nonzero floor is a finding for W2 (fullscreen, compositor), not a reason to
widen the bound.

A Rust test guards the deadline without a display. It runs the frame loop
against a fake surface on a 16.7 ms clock, with a consumer that sleeps 50 ms on
one sample. It checks that:

- every present lands on its clock;
- that frame redraws the previous scene;
- the late sample's scene is presented on a later frame;
- no sample is dropped.

## Renderer as built (wisp#108)

Decision (31 October 2026, after Tom said Chrome is a dead end and the Rust window replaces it): the renderer is not a line-by-line port of host/browser. It is built for wgpu, and Chrome stays only as the reference for what is drawn.

- **Split.** Bun keeps every decision about what is drawn: `host/window/drawScene.ts` reduces the `RenderScene` to the camera, fog, sky and one pose per loaded model (placement matrix, the sequence and frame the game's animation rules choose, colours). Rust draws; it makes no animation decision.
- **Assets.** Bun reads each model once, and the textures it paints with, and pushes them with `wisp_window_asset`. Textures decode on the decode pool; a model builds only when no decode is outstanding, so its bind groups hold its real textures. A pose whose model is not yet built is not drawn.
- **Upload once.** A model becomes one vertex buffer, one index buffer and one bind group per material layer when it loads. Each texture gets its whole mip chain.
- **Skin on the GPU.** Each frame the render thread poses every drawn instance into one bone-matrix storage buffer; the vertex shader blends four bones per vertex.
- **Instanced draws.** Poses are grouped by model. Each layer of each model is one instanced draw, with the layer's filter mode choosing one of seven pipelines (blend state and depth write). Models with a layer below Blend draw before the rest, as `orderDrawnModels` does in Chrome.
- **No per-frame allocation in the draw.** The bone, instance and grouping scratch vectors keep their capacity; only a new model, texture or larger scene allocates. The scene's JSON parse still allocates once per scene (see "The scene goes to Rust as the same JSON").
- **Not yet drawn:** day-night light and shadows, per-layer alpha and texture animation, particle and ribbon emitters, terrain and water, lightning and the cinematic filter (the UI is drawn, see below).
- **Capture.** `WISP_WINDOW_CAPTURE=FILE.png` (after `WISP_WINDOW_CAPTURE_AFTER` scenes that drew a model, default 30) saves the window's image; W3's offscreen capture replaces it.

## UI as built (wisp#109)

The menu and HUD frames are drawn by `window/wisp-window/src/ui/`, one render pass over the world, from the `ui` array of the scene Bun sends.

- **Split.** Bun keeps the choice of what shows: `host/window/nativeUi.ts` drops every frame that draws nothing (hidden, no alpha, no rectangle, neither texture nor text), so the scene carries tens of frames rather than the thousands the game ever made, and names the textures and font files the rest need, which `createModelLibrary` pushes once with `wisp_window_asset`. Rust owns placement and drawing.
- **Layout** (`ui/layout.rs`, plain functions with unit tests) follows the Chrome renderer: UI units are 0.8 x 0.6 at 4:3, scaled by the screen height and centred; frames draw in ascending level, scene order within a level; text is wrapped at its frame's width on spaces and `|n`, each line aligned on its own, with the first `|c` code colouring the whole text and `|r` dropped; a font without a height takes a size from the screen and the frame's height.
- **Text** is rasterized by fontdue into one R8 glyph atlas, once per font, glyph and quarter-pixel size, when the glyph is first asked for, and drawn as instanced quads. A font file the game names (TTF or OTF, told from images by its magic) is registered from the bytes Bun pushes; until then, and for names that are not font files, the bundled DejaVu Sans draws, as Chrome's `sans-serif` does. A font with the outline flag draws a second atlas entry per glyph, grown by half the Chrome stroke width, in black at 0.9 alpha under the fill. A full atlas is emptied and rebuilt once.
- **Draw.** Each scene's quads go to one instance buffer in drawing order, written only when they differ from the last scene's; a run of quads that share a texture is one draw call. The pass loads the world's image, blends straight alpha, and has no depth. A textured frame whose image has not decoded yet is skipped until it has.
- **Not yet drawn:** frames with a colour but no texture draw nothing, as in Chrome, and `|c` colours apply to the whole text.

## Boxes

Order:

- W1 first; W7 can run beside it.
- W1b meets W1's box; W1c follows W1b.
- W2, W3 and W5 follow W1b. W2 also follows W1c and needs wisp-latency's
  harness to land.
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
  - the worker thread that steps the game, with the shared-memory seam on the
    main thread (see "The game steps on a worker thread");
  - `bun wisp window probe`, which runs the sample map's scene and writes
    percentiles for wake, step, scene encode plus parse, garbage collection
    pauses (the main thread's, and the worker's beside them), `readAsset` and
    present interval.

  Done when (restated in "Seam (revised)"; W1b meets it):
  `cd ~/code/wisp/main && bun wisp window probe --frames 600 --out build/window-probe && jq -e '.missedPresents == 0 and .lateScenes <= 6 and .droppedSamples == 0' build/window-probe/probe.json`
- **W1b The render thread owns the frame: scene deadline and missed presents**
  ([wisp#116](https://github.com/tompassarelli/wisp/issues/116)) (built). It
  builds "Who owns the frame" behind today's wake:
  - the frame loop behind a surface and clock it can be tested against, and
    the late-scene test with its fake surface;
  - the sample queue of 8, the scene deadline, the redraw of the last scene,
    and `wisp_window_next_event` as a non-blocking take that the worker drains
    in order on each wake;
  - `missedPresents`, `missedPresentsAfterLateScene`, `lateScenes`,
    `droppedSamples` and `inputToPresentMs`, with T taken from the measured
    acquire interval;
  - the worker calling `wisp_window_start` once its frame loop is ready;
  - `bun wisp window probe --baseline`, and probe.json with the restated
    bounds as gates and the wake and collection figures beside them.

  Done when:
  `cd ~/code/wisp/main/window && cargo test -p wisp-window late_scene_keeps_presents_on_clock 2>&1 | grep -q 'test result: ok. 1 passed' && cd .. && bun wisp window probe --baseline --frames 600 --out build/window-baseline && bun wisp window probe --frames 600 --out build/window-probe && jq -e '.missedPresents == 0 and .lateScenes <= 6 and .droppedSamples == 0' build/window-probe/probe.json`
- **W1c A blocking call replaces the wake callback** (built)
  ([wisp#117](https://github.com/tompassarelli/wisp/issues/117)). It builds
  "The wake: a blocking call instead of a callback":
  - `next_event` blocks with a timeout;
  - `wisp_window_stop`, `wisp_window_attach` and `wisp_window_release` over an
    `Arc<Host>`, and `wisp_window_open` without a callback;
  - the worker's loop with one `setImmediate` turn per frame;
  - deletion of the `JSCallback`, sharedWake.ts and host/window/nativePlay.ts,
    with `--window native` requiring `nativeGame` and refusing `--net` until
    W2, and play.md updated;
  - a Rust test that stops the window while a consumer is blocked and while
    one is mid-submit.

  Done when:
  `cd ~/code/wisp/main && ! rg -q 'JSCallback' host && (cd window && cargo test -p wisp-window stop_ 2>&1 | grep -q 'test result: ok. 2 passed') && timeout 120 bun wisp window probe --frames 600 --out build/window-probe && jq -e '.missedPresents == 0 and .lateScenes <= 6 and .droppedSamples == 0' build/window-probe/probe.json`
- **W2 Present path, phase lock and press-to-display latency** ([wisp#107](https://github.com/tompassarelli/wisp/issues/107)).
  It adds:
  - `Fifo` with the image count read back, and `Mailbox` and `Immediate` as
    settings;
  - acquire-then-sleep pacing with miss detection, moving W1b's fixed scene
    deadline and sample point to the measured ones, and the 60 Hz step rule
    above 60 Hz;
  - borderless fullscreen;
  - the netcode tick's phase lock for paced sessions, which brings back
    `--window native` with `--net` through a non-blocking `next_event`;
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

  Posing (built; [wisp#123](https://github.com/tompassarelli/wisp/issues/123)):
  `window/wisp-window/src/model` parses MDX and MDL, reads tracks with
  war3-model's interpolation and Wisp's `sample`/`rotate`, poses placed
  nodes into a preallocated bone palette (`Pose::matrices`, the storage
  buffer the skinning vertex shader reads) and loads every vertex as four bone
  ids and weights, so classic matrix groups and the four-weight skin share one
  shader. `window/wisp-window/tests/pose.rs` poses `tests/fixtures/rig.mdl`
  and `rig.mdx` and matches war3-model's node matrices and vertex positions
  from `rig.expected.json`; `bun test/window/poseFixtures.ts` regenerates all
  three. Billboarded nodes and groups over four bones are not posed yet.

  Done when:
  `cd ~/code/wisp/main && bun wisp render compare --reference chrome --candidate native --scenes test/render/models.json`
- **W4 Native lighting, effects, passes, world and UI** ([wisp#109](https://github.com/tompassarelli/wisp/issues/109)). It
  covers:
  - everything in the W4 rows of the rewrite list, text included;
  - full-scene compare, including Smashcraft's stages.

  Done when:
  `cd ~/code/wisp/main && bun wisp render compare --reference chrome --candidate native --scenes test/render/scenes.json`
- **W5 Native pads on Linux and Windows** ([wisp#110](https://github.com/tompassarelli/wisp/issues/110)). It adds:
  - SDL3's gamepad API updated and read at the sample point on both;
  - padbridge's melee layout for the pad's family, GameCube included;
  - raw axes, `gamepadIndex` and focus clearing.

  A Linux test creates a virtual pad through uinput, presses a button, and
  asserts the press is read at the next sample point. Two SDL virtual-pad
  tests check that a pad with the GameCube adapter's ids is a GameCube pad
  with padbridge's layout.

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
- SDL 3.4.18 Windows joystick drivers and threads:
  https://github.com/libsdl-org/SDL/tree/release-3.4.18/src/joystick/windows,
  https://github.com/libsdl-org/SDL/blob/release-3.4.18/src/joystick/SDL_joystick.c,
  https://github.com/libsdl-org/SDL/blob/release-3.4.18/src/hidapi/windows/hid.c
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
- Seam (revised), 30 October 2026:
  - thread-safe callbacks: Bun's FFI page says the engine "marshals the
    invocation onto the JavaScript thread" and calls the support
    experimental, https://bun.com/docs/runtime/ffi;
  - safepoints: "Introducing Riptide: WebKit's Retreating Wavefront
    Concurrent Garbage Collector",
    https://webkit.org/blog/7122/introducing-riptide-webkits-retreating-wavefront-concurrent-garbage-collector/;
  - the render loop's 100 ms scene wait: window/wisp-window/src/host.rs,
    `SCENE_WAIT` and `wait_for_scene`, at 5dab83ad;
  - the probe figures: wisp#105's last run on gex45 under an exclusive lease.
  - an adversarial review by a fresh Sonnet reviewer. It found that:
    - the 18 ms present p95 was acquire jitter rather than missed presents;
    - a p95 interval bound could not catch misses;
    - the netcode's non-blocking take contradicted "no dropped samples";
    - shutdown after a missed acknowledgement could free the handle under
      the worker;
    - the queue's start and full policies were unstated;
    - a filtered `cargo test` passes with zero tests;
    - the first box was too large, so the plan was split into W1b and W1c.
