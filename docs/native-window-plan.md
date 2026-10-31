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

On a host whose north `[hosts.NAME]` sets `lease_builds`, such as gex45, that
command waits for a heavy capacity lease, also when it is started over `ssh`
or detached with `setsid`: north's `nix` shim sends `nix develop --command
cargo ...` through `north capacity gate` (north#383). A `cargo` typed inside an
interactive dev shell is the dev shell's own and takes no lease, so run builds
there through `nix develop --command`.

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
- `claxon` 0.4.3 (FLAC), `hound` 3.5.1 (PCM and float WAV), `lewton` 0.10.2
  (Ogg Vorbis, MIT OR Apache-2.0) and `nanomp3` 0.2.0 (MP3, MIT OR
  Apache-2.0): the sound decoders W6 settled (see Sound).
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
- **Mouse.** winit's cursor and button events reach the window thread, which
  keeps the cursor in physical pixels, the buttons held and the presses and
  releases since the last sample (`pointer.rs`); the render thread reads them
  at the sample point with the keys, and a sample that repeats the one before
  it (a slow frame queues up to six) carries the position but no press, so a
  click is delivered once. The sample carries the window's size, and
  `src/headless/pointer.ts` maps the cursor onto Warcraft's 0.8 by 0.6 UI
  screen (the window draws frames across its whole client area) and
  into the client's screen pixels, inverting the game's `pointerX`/`pointerY`, for `BlzGetMouseScreenPosX/Y` and
  `BlzIsMouseButtonPressed`. A left press and release on the same frame that
  takes clicks is `FRAMEEVENT_CONTROL_CLICK` for the player, sent through the
  lockstep like a key; the frame is the topmost one that takes clicks (frame
  level, then creation order). A session reads the mouse from the
  `StandaloneInput.pointer` of its `step` with `createPointerFeed`. Not yet:
  `FRAMEEVENT_MOUSE_ENTER`, `MOUSE_LEAVE`, `MOUSE_DOWN`, `MOUSE_UP`, wheel and
  drag, and the world-coordinate `EVENT_PLAYER_MOUSE_*` events (hover and drag
  are the second box of this work).
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

The resolver tries `.flac`, `.wav`, `.mp3` and `.ogg` in that order
(host/render/standaloneSound.ts). The files it has reached so far, in the stock
read cache of the Smashcraft checkout (30 October 2026): 95 Ogg Vorbis, 3 MP3
(the music) and no WAV; Smashcraft's own sounds are FLAC in the map. The decoders
are `lewton` for Vorbis, `nanomp3` for MP3, `claxon` for FLAC and `hound`
for PCM and float WAV, all permissive and entered in references.md. The format
is read from the file's first bytes, not its extension. A WAV in ADPCM, which
`hound` does not decode, or any other unreadable file is listed in
`missingSounds` with the reason and plays nothing; if one shows up in a
player's install, it is the case that would bring in `symphonia`.

Playback follows the page's rules:

- one cpal output stream, with a buffer of at most 256 frames;
- volume as `volume / 127`;
- pitch as a playback-rate change, done with linear resampling in the mixer
  as WebAudio's `playbackRate` does;
- decoded assets reused by resolved path, keeping each handle's variation;
- a machine with no output device mixes at the same pace into nothing, and
  `audioOutput` in `standalone.json` names what played.

The library holds the output and the decoded clips (`wisp_audio_open`,
`wisp_audio_load`, `wisp_audio_play`, `wisp_audio_info`, `wisp_audio_close`),
apart from the window's handle, so the wake and present path is untouched. The
thread that steps the game takes each step's cues, resolves and loads them, and
starts the sound when its file is ready, as the page's `sound` does.

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

### Where a consumer gets the library (wisp#130)

A game that vendors Wisp's package has no checkout, so the package ships `window/`'s
source and the player finds or builds the library itself. `windowLibraryPath()`
(wisp:host/window/binding.ts) takes `WISP_WINDOW_LIBRARY`, else the library beside the
executable, else `window/target/release` in a checkout, else the build in
`~/.cache/wisp/window/HASH/release/`, where HASH covers the Cargo files, the flake and
the crate's source and assets. `play --standalone --window native` and `window probe` first run
`prepareWindowLibrary` (wisp:host/window/library.ts): when nothing exists at that path it runs
`cargo build --release --locked` there with `CARGO_TARGET_DIR` set to the cache folder, once per
revision of the source. On Linux with nix the command runs in `window/flake.nix`'s dev shell, which
gives the toolchain and cmake and puts the Wayland, X11, xkbcommon, udev, Vulkan and GL store
paths into the library's RUNPATH (`RUSTFLAGS`), so the process needs no `LD_LIBRARY_PATH`.
On Windows cargo builds with the runner's toolchain and no runtime libraries are needed.

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

A Rust test guards the deadline without a display. The frame loop reads time
and waits for each scene through its clock (`Clock`), and the test injects one.
The fake surface moves that clock exactly one 16.7 ms period at each acquire. A
scene that has not come within a second of real time moves it to the deadline,
and a consumer holds back one sample's scene until two more frames have been
acquired. It checks that:

- no present is missed and every frame presents;
- exactly the frames waiting on the held sample are late, and they redraw the
  previous scene;
- the frame after catches up to its own scene;
- no sample is dropped, and every sample is stepped in order.

The clock is injected because the first version slept on the wall clock. It
failed on a loaded Linux runner and on Windows' 15.6 ms timer (#124). Now only
the script decides which frames are late, and a slow host stretches the run,
not the result.

## Renderer as built (wisp#108)

Decision (31 October 2026, after Tom said Chrome is a dead end and the Rust window replaces it): the renderer is not a line-by-line port of host/browser. It is built for wgpu, and Chrome stays only as the reference for what is drawn.

- **Split.** Bun keeps every decision about what is drawn: `host/window/drawScene.ts` reduces the `RenderScene` to the camera, fog, sky and one pose per loaded model (placement matrix, the sequence and frame the game's animation rules choose, colours). Rust draws; it makes no animation decision.
- **Assets.** Bun reads each model once, and the textures it paints with, and pushes them with `wisp_window_asset`. Textures decode on the decode pool; a model builds only when no decode is outstanding, so its bind groups hold its real textures. A pose whose model is not yet built is not drawn.
- **Upload once.** A model becomes one vertex buffer, one index buffer and one bind group per material layer when it loads. Each texture gets its whole mip chain.
- **Skin on the GPU.** Each frame the render thread poses every drawn instance into one bone-matrix storage buffer; the vertex shader blends four bones per vertex.
- **Instanced draws.** Poses are grouped by model. Each layer of each model is one instanced draw, with the layer's filter mode choosing one of seven pipelines (blend state and depth write): Transparent alpha-tests at 0.75 and writes depth; Blend is source alpha over and writes none; Additive is one-one and ignores the texture's alpha (the pose's alpha and the layer's fade scale its colour); AddAlpha is source alpha plus one; Modulate multiplies the destination by the colour and Modulate2x doubles that. Particle emitters follow war3-model instead: Additive and alpha-keyed particles are source alpha plus one (keyed ones cut at 0.75), and every particle and bolt colour is converted to linear light like a layer's. Replaceable ids 1 and 2 draw the pose's team colour and a team-coloured glow. Models with a layer below Blend draw before the rest, as `orderDrawnModels` does in Chrome.
- **No per-frame allocation in the draw.** The bone, instance and grouping scratch vectors keep their capacity; only a new model, texture or larger scene allocates. The scene's JSON parse still allocates once per scene (see "The scene goes to Rust as the same JSON").
- **Opacity, colour and texture animation.** Geoset animations (`GEOA`: alpha and colour, `KGAO` and `KGAC`), layer alphas (`KMTA`), layers whose texture changes over time (`KMTF`: one draw per texture the layer can show, only the current one visible) and texture coordinate animations (`TXAN`) are sampled per pose into two storage buffers the model shader reads; a geoset whose alpha is zero draws nothing. A geoset's colour multiplies every layer it draws, team colour included, with the stored order read as red, green, blue whatever the animation's flags say, as [headless](headless.md) draws it; a Re-Classic body that recolours borrowed textures this way (Smashcraft's Tyrande tints `HeroLich` and `UndeadArthas` teal and purple) drew them untinted before (31 October 2026).
- **Textures.** A BLP1 JPEG carries blue, green, red and alpha as four JPEG components; image-blp's reader drops the alpha, so `texture.rs` reads the components itself and matches the Chrome decoder's pixel means.
- **Particles** (`render/particles.rs`). Version-2 particle emitters (`PRE2`) are born on the CPU into per-texture-and-blend ring buffers, one 64-byte record per particle, written once; the vertex shader evaluates position (velocity and gravity), size, colour and frame from the record and the scene clock, and each ring is one instanced draw. Head and tail quads, squirt emitters, line emitters and flat quads follow `war3-model`; particles live in world space.
- **Lightning** (`render/lightning.rs`). Each bolt is a jagged glowing ribbon with a bright core, re-jagged 24 times a second on the GPU, additive, in the bolt's colour; Bun sends the scene's bolts.
- **Weather** (`render/weather.rs`, `weather.wgsl`; wisp#109). `AddWeatherEffect`, `EnableWeatherEffect` and `RemoveWeatherEffect` are recorded by `src/headless/weather.ts`; an enabled weather reaches the scene as its four-letter id (Warcraft's weather table) and its rect. Rust keeps a preset per id (`weather::TABLE`, listed by a test: rain `RAlr RAhr RLlr RLhr`, snow `SNls SNhs`, blizzard `SNbs`, wind `WOlw WOcw WNcw`, dungeon fogs `FDbl FDbh FDgl FDgh FDrl FDrh FDwl FDwh`, rays of light `LRaa` and moonlight `LRma`). Each weather fills a box around the camera's target, not the terrain, so it falls through a stage standing above the ground, and only draws while the target is inside its rect. Particles are stateless: the vertex shader derives each from its index and the clock, wraps it around the box, drifts it with a gusting wind, sways it by depth layer, and stretches it along its screen-space motion over a shutter time (motion blur on fast flakes and rain streaks). Fog is large soft blobs near the floor of the box that thicken with distance; rays are slanted additive ribbons that flicker. All draw alpha-blended or additive with the scene's depth test, so fighters and walls in front occlude them; the shapes are procedural, with no texture. Offscreen tests draw each kind and time the heaviest set (five weathers at 2880x1920).
- **Not yet drawn:** day-night light and shadows, ribbon and version-1 model emitters, terrain and the cinematic filter (the UI and a model's water layers are drawn, see below).
- **Window shape.** The world fills the whole window: no bars. The projection keeps the reach of the game's picture (the window's size at open) in view, so a window taller than that picture shows more world above and below at the same horizontal framing and a wider one shows more world to the sides at the same vertical framing; the menu and HUD frames keep the picture's centred rectangle (wisp#109).
- **Capture.** `WISP_WINDOW_CAPTURE=FILE.png` (after `WISP_WINDOW_CAPTURE_AFTER` scenes that drew a model, default 30) saves the whole window's image; W3's offscreen capture replaces it.

## UI as built (wisp#109)

The menu and HUD frames are drawn by `window/wisp-window/src/ui/`, one render pass over the world, from the `ui` array of the scene Bun sends.

- **Split.** Bun keeps the choice of what shows: `host/window/nativeUi.ts` drops every frame that draws nothing (hidden, no alpha, no rectangle, neither texture nor text), so the scene carries tens of frames rather than the thousands the game ever made, and names the textures and font files the rest need, which `createModelLibrary` pushes once with `wisp_window_asset`. Rust owns placement and drawing.
- **Layout** (`ui/layout.rs`, plain functions with unit tests) follows the Chrome renderer: UI units are 0.8 x 0.6 at 4:3, scaled by the screen height and centred; frames draw in ascending level, scene order within a level; text is wrapped at its frame's width on spaces and `|n`, each line aligned on its own, with the first `|c` code colouring the whole text and `|r` dropped; a font without a height takes a size from the screen and the frame's height.
- **Text** is rasterized by fontdue into one R8 glyph atlas, once per font, glyph and quarter-pixel size, when the glyph is first asked for, and drawn as instanced quads. A font file the game names (TTF or OTF, told from images by its magic) is registered from the bytes Bun pushes; until then, and for names that are not font files, the bundled DejaVu Sans draws, as Chrome's `sans-serif` does. A font with the outline flag draws a second atlas entry per glyph, grown by half the Chrome stroke width, in black at 0.9 alpha under the fill. A full atlas is emptied and rebuilt once.
- **Draw.** Each scene's quads go to one instance buffer in drawing order, written only when they differ from the last scene's; a run of quads that share a texture is one draw call. The pass loads the world's image, blends straight alpha, and has no depth. A textured frame whose image has not decoded yet is skipped until it has.
- **Not yet drawn:** frames with a colour but no texture draw nothing, as in Chrome, and `|c` colours apply to the whole text.

## Graphics settings

Players' machines differ and rollback needs a steady frame, so every costly renderer feature has an off switch, and the preset names which are on (wisp#109; Tom asked for this, 2026-10-31).

- **Presets.** `settings::Preset` is Low, Medium, High (the default, today's look) or Ultra, and `Preset::features()` returns the `Features` it runs. Each field of `Features` is a setting key; a feature reads `renderer.features().<field>` and draws nothing when it is off.

  Setting key | Low | Medium | High | Ultra
  --- | --- | --- | --- | ---
  `shadows` (map side) | off | 1024 | 2048 | 4096
  `msaa` (samples) | 1 | 2 | 4 | 8, or the most the adapter has
  `ssao` | off | off | on | on
  `bloom` | off | off | on | on
  `volumetrics` (fog and light shafts) | off | off | off | on
  `cloudLayers` (painted sky layers) | 1 | 2 | 3, with sun shafts | 3, with sun shafts
  `weather` (percent of particles) | 25 | 50 | 100 | 100
  `water` | flat | reflective | reflective | refractive
  `renderScale` (percent of window size) | 75 | 100 | 100 | 100

- **What reads them today.** `bloom` and `ssao`: the renderer sets the final-image pass's `bloom_strength` and `occlusion_strength` to their defaults when on and to zero when off, and a strength of zero skips that effect's passes. `msaa` and `renderScale` are registered but not read: the final-image pass samples a 4-sample depth buffer and works in whole pixels of a scene as large as the window, so it must learn another sample count and a smaller scene first. The remaining keys wait for their features (lighting, fog and shafts, weather, water).
- **Art.** Original or Remastered, independent of the preset. Switching rebuilds every file the renderer has seen at the new quality beside the set on screen, which keeps drawing until the new one is complete and then replaces it, so there is no restart and no blank frame; a texture not yet in the remaster cache takes as long as its first remaster. Remastered is Standard above; the Real-CUGAN 2x conservative kernels are a separate box.
- **Saved per player** in `$XDG_CONFIG_HOME/wisp/players/<name>.graphics.json` (`APPDATA` on Windows, else `~/.config`), where `<name>` is `WISP_PLAYER`, else the operating-system user name. A missing or damaged file means the defaults.
- **Options screen.** F10 opens and closes it (Esc closes); while it is open the arrow keys, W/S/A/D, Enter and Space drive it and the game sees no keys. It is drawn through the UI renderer as an overlay of UI frames (`menu.rs`), so it is crisp at any render scale.
- **Preset sweep.** `WISP_WINDOW_PRESET_SWEEP=DIR` opens the screen once the scene is ready and, at each preset, draws 120 frames timed from the start of the draw to the GPU finishing it, prints p50, p95 and max, appends them to `DIR/frame-times.txt` and saves `DIR/options-<preset>.png`.

  Measured 31 October 2026 on the laptop's Radeon 890M (RADV, Vulkan; `WISP_WINDOW_SIZE=2880x1920 bun wisp window probe --frames 700` in a private desktop, the sample map's scene, the window opening at 2878x1892 under the compositor's frame; the machine's CPU pressure was 1.4% over ten seconds). Frame time is from the start of the draw to the GPU finishing it, over 120 frames after a warm-up:

  Preset | p50 | p95 | max
  --- | --- | --- | ---
  Low | 3.05 ms | 3.33 ms | 4.53 ms
  Medium | 3.14 ms | 3.73 ms | 6.09 ms
  High | 4.04 ms | 4.69 ms | 9.74 ms
  Ultra | 3.97 ms | 4.57 ms | 9.08 ms

  The same sweep on gex45's RTX PRO 4000 (Blackwell, Vulkan, private desktop, window 2878x1892; the machine's CPU pressure was 63% from other work):

  Preset | p50 | p95 | max
  --- | --- | --- | ---
  Low | 1.19 ms | 2.21 ms | 4.20 ms
  Medium | 1.08 ms | 1.62 ms | 2.19 ms
  High | 1.57 ms | 2.30 ms | 3.36 ms
  Ultra | 1.49 ms | 2.09 ms | 3.13 ms

  The four captures of each run differ from each other and are not committed (21 MB each).

  On the 890M Low is inside the 8.3 ms budget by 5 ms. Ultra costs no more than High because the keys that would make it dearer (volumetrics, 8x MSAA, refractive water, 4096 shadows) are not read yet; Low pays less than High only through bloom and ambient occlusion, the two keys that act today.

## Remaster at load

Classic art is sharpened and lit on the player's machine from the player's own map and install (wisp#109; Tom asked for this, 2026-10-31). Shapes stay Classic: only textures and the silhouette's roundness change.

- **Setting.** The player picks Original or Remastered at the options screen (F10, "Graphics settings" below); Remastered is the default and is Standard here. `WISP_REMASTER=off|standard|high` stays as a developer override that replaces the choice and is the only way to High. Standard doubles a texture's sides and subdivides each triangle once, High does both twice. Textures of 1024 px or more on a side (backdrops) are left alone.
- **Method chosen: Real-CUGAN 2x conservative on wgpu, with edge-directed Catmull-Rom as alpha, fallback and further doublings** ([remaster-upscaler.md](remaster-upscaler.md); kernels in `remaster/cugan/`, choice in `remaster/upscaler.rs`). The filter below is our own code (`remaster/upscale.rs`). Each output pixel is a Catmull-Rom sample; where the 3x3 structure tensor shows one dominant edge, it is averaged with two samples along the edge, then clamped to the four nearest source pixels (plus 6% overshoot) so it never rings. Alpha is premultiplied, so cutout silhouettes get no fringes. It needs no model, runtime or download, and no licence beyond our own.
- **Normals and roughness** (`remaster/relief.rs`) come from the upscaled albedo: luminance is the height, a difference of two box blurs removes slow colour shifts, alpha adds a bevel where a silhouette ends, and a Sobel-style slope gives the normal. Roughness is a heuristic (bright high-contrast detail glossier, flat dull areas rougher), not a measurement. Output contract for the lighting box: an RGBA8 `relief` texture per source texture whose RGB is a tangent-space normal (`n * 0.5 + 0.5`; x toward +u, y toward +v, which is down the image, z out) and whose alpha is roughness; `Renderer` keeps it in `reliefs`, keyed like `textures`. Nothing binds it in a shader yet.
- **Cache.** `$XDG_CACHE_HOME/wisp/remaster` (`LOCALAPPDATA` on Windows, else `~/.cache`): `<sha256 of source bytes, quality, algorithm version, edge rule and upscaling method>.albedo.png` and `.relief.png`. The bake writes it; the art on screen only reads it. A texture the remaster leaves as it is (1024 px or more, or unreadable) gets an empty `.as-is` marker so the next run need not decode it to find out. Keys depend only on the source bytes and the method, so the cache survives Wisp and game updates and only new or changed textures bake again. Nothing derived from a player's files is written to a repository, package or download: the example tools write only to a directory they are given.
- **Bake, never in a match.** The upscaler runs only on one background thread (`remaster/bake.rs`), never while the art is drawn: Tom's first Remastered match ran at 10 fps while Real-CUGAN built the set on the same GPU (2026-10-31). Every texture file Bun pushes is queued once, newest first (what the menus are showing, such as the fighters on character select), with a 16 ms rest after each one it upscales; a cached one is only a file check. A map says when a match is on with `WispSetPlaying(playing)` (the scene's `playing`); while it is on, no texture starts baking and no remastered set is built or swapped in, so a match plays on the art it started with. When every queued texture is in the cache and play is off, the remastered set is built beside the one on screen from cache reads and replaces it; a texture that arrives later is drawn Original until the next rebuild between matches. The window prints `wisp remaster: N textures ready (M baked now, the rest from the cache) in T ms` each time the queue empties. The menus show `Preparing HD textures N%` in the lower right corner while it works, and F10 shows `HD textures: Ready`, `Preparing N%` or, on a software adapter, the basic filter. The host reads the game's `preloadModels` into the window once it starts, so their textures bake while the player is in the menus.
- **Silhouettes** (`render/tessellate.rs`). Midpoint subdivision at model build with PN-triangle edge points; corners never move; open borders, non-manifold edges and seams whose two sides disagree about normals keep their straight midpoints; a midpoint moves at most 8% of its edge. The bind pose is what is subdivided, bone weights are merged to the top four, so the GPU skinning is unchanged.

### Measured choice (31 October 2026, the laptop, release build, one thread)

Quality is PSNR of each upscaler restoring the original from a copy of half its size (higher is better); times are `enhance` for the whole texture including normal and roughness; `cache hit` reads both PNGs back. Textures are the Lich King's three from Smashcraft's map imports (map file entries `LichKing.BLP`, `FrostmourneNew.blp`, `HelmOfDom.BLP`). Produced by `cargo run --release -p wisp-window --example remaster_report -- OUT_DIR FILES...`.

| texture | size | bilinear dB | bicubic dB | edge-directed dB | x2 ms | x4 ms | cache hit ms |
|---|---|---|---|---|---|---|---|
| LichKing | 512x512 | 24.61 | 25.66 | 25.55 | 540 | 2465 | 28 |
| FrostmourneNew | 256x512 | 26.16 | 27.08 | 26.99 | 218 | 1176 | 14 |
| HelmOfDom | 256x256 | 25.14 | 26.49 | 26.41 | 115 | 597 | 7 |

Edge-directed beats bilinear by about 1 dB and ties plain Catmull-Rom within 0.11 dB; PSNR does not measure stair-step smoothness, which is what the edge averaging is for, so it is kept. Learned upscalers were measured separately on twelve Classic textures; [remaster-upscaler.md](remaster-upscaler.md) records the bake-off and adopts Real-CUGAN 2x on wgpu, with this filter kept for alpha and as the fallback.

### Measured gates: an upscaler may sharpen the concept, never change it

Tom shared a professional artist's critique of an AI-remastered building set (2026-10-31): smeared stone edges, visible seams, a palette and style unlike the original, blurry or invented texture. `remaster/check.rs` turns the parts a texture upscaler can cause into measured gates, and `cargo run --release -p wisp-window --example remaster_check -- --out DIR [--quality standard|high] [--worst N] [--classical] (--imports MAP_IMPORTS_DIR | TEXTURE...)` runs them with the upscaler the window would run (Real-CUGAN on the machine's GPU, else the edge-directed filter; `--classical` forces the filter). It prints one row per texture, sorted worst first, lists the failing gates, saves a crop of the worst N as `DIR/remaster-check-NAME.png` (original | remaster | colour error x4, nearest-neighbour zoom; a seam failure is cropped on the wrapped seam), and exits 1 when any texture fails. Textures 1024 px or more on a side and textures under 8 px (palette strips) are left alone. Judged art (stages, fighters, effects) is the rubric in smashcraft:docs/design/visual-quality.md.

Every gate compares the upscale folded back to the source's size by premultiplied box average, so a faithful upscale scores as the source itself:

- **Palette drift** (`hue`, `saturation`): `hue` is how far the chroma-weighted hue distribution moved around the colour wheel in degrees (a circular earth-mover distance over 72 bins, so a palette of several hues stays stable where a mean hue swings); it is not read for a texture whose mean chroma is under 0.04. `saturation` is the change in colour-weighted saturation, sum of chroma over sum of brightness.
- **Seam** (`seam`, only for textures sampled with wrap, which `Edges::for_path` names: terrain art): the excess of the folded upscale's colour step across the wrap edge over the source's, the larger of the two axes.
- **Detail kept** (`detail kept`): structure similarity (8 px windows, stride 4, luma over mid grey) of the folded upscale against the source.
- **Detail added** (`detail added`): root-mean-square luma by which the upscale differs from a plain Catmull-Rom enlargement of the source, counted only at pixels whose 5x5 source neighbourhood is flat within 0.02. Sharpening a real edge puts nothing there; texture the source never had does.
- **Alpha** (`alpha`): the larger of the share of mask-interior pixels (alpha flat within 0.1 across 5x5) whose alpha moved more than 0.1, and the relative change in total alpha, so team-colour and cutout masks stay put while edges antialias.

Limits, chosen from the edge-directed filter's outputs over Smashcraft's imports (706 textures at 8 px or more, 3 fail on the filter): hue 6 degrees (filter p50 1.3, p90 3.5, p99 7.7 degrees, the limit sitting past the bulk), saturation 0.04, seam 0.02, detail kept 0.95, detail added 0.01 (filter max 0.005), alpha 0.02.

Measured on the laptop's Radeon 890M, 31 October 2026, the newest unpacked Smashcraft map under `~/.cache/wisp/map-imports` (721 textures):

| upscaler | measured | fail | failing gates |
|---|---|---|---|
| edge-directed (`--classical`) | 706 | 3 | alpha 1, hue 1, saturation 1 |
| Real-CUGAN 2x conservative | 706 | 35 | detail kept 9, hue 24, saturation 3, detail added 2, alpha 1 |

Worst under Real-CUGAN: stage water and sky, where the network paints streaks into smooth gradients and structure similarity falls: `StageTombSea` 0.66 (detail added 0.034), `StageTombWater` 0.79 (0.023), `StagePlague` 0.86, `StageLava` 0.91, `ParasolShaft` 0.93, `StageSky`, `StageSea` and `StageGround` 0.95; the Lich King, Lady Vashj and Illidan skins and the Lich King cards and busts drift 6 to 7 degrees of hue (the four player slots of each share one image); `BTNLichKing` drifts 11 degrees and its score-screen portrait 10 degrees and 0.06 saturation; one `FighterWhite` mask moves 0.043 of its alpha. Terrain art (199 tiles from the install, 31 October): the seam gate passes on every tile under both upscalers (largest excess 0.006 under Real-CUGAN, 0.0003 under the filter), so wrap padding holds; detail kept fails on 162 tiles under Real-CUGAN (dirt tiles 0.72 to 0.75) and 39 under the filter, because both smooth grain the source has.

Findings filed: a 2x2 texture makes Real-CUGAN stop for every later texture (wisp#150, with the stage-water finding). Not measured: atlas island borders bleeding (the check has no island map), and the Real-CUGAN 4x path.

### Silhouette before and after (one subdivision, bind pose, orthographic)

Pixels of a 512x512 mask of the model's bind-pose silhouette, scaled to the same bounds; "only before" is area the tessellated model lost, "only after" area it gained. Models are Smashcraft's `LichKing2.mdx`, `IllidanTimelineBody` and `PeonTimelineBody` from the map imports (612, 590, 629 in the unpacked cache). Overlay PNGs (grey both, red only before, green only after) come from `cargo run --release -p wisp-window --example silhouette_report -- OUT_DIR MODELS...` and stay outside the repository.

| model | view | triangles before | after | silhouette px | only before | only after | IoU |
|---|---|---|---|---|---|---|---|
| LichKing2 | front | 1931 | 7724 | 58572 | 240 | 1725 | 0.9665 |
| LichKing2 | side | 1931 | 7724 | 97779 | 94 | 710 | 0.9918 |
| IllidanTimelineBody | front | 1289 | 5156 | 46675 | 24 | 739 | 0.9837 |
| IllidanTimelineBody | side | 1289 | 5156 | 147931 | 0 | 1 | 1.0000 |
| PeonTimelineBody | front | 372 | 1488 | 68738 | 212 | 3471 | 0.9464 |
| PeonTimelineBody | side | 372 | 1488 | 106563 | 589 | 3270 | 0.9638 |

The overlay of the peon's front view shows the change: rounded forms (back, belly, helmet crown) bulge outward by a few pixels, while the blocky axe head, arm and boots keep their cut edges, which is the 8% shift cap and the seam rule at work. The simulation's hit areas do not come from the model, so no hitbox moves; the drawn outline grows by at most about 5% of the silhouette's area (peon front, the largest).

### Not yet done

- A before/after window screenshot at match zoom, both facings: the bake-off drew models through `Renderer` offscreen in one facing (remaster-upscaler.md), not through the window's own capture.
- Binding the relief map in the lighting shader (wisp-109-light owns it).

## The native look (wisp#109)

Direction (Tom, 31 October 2026): full send on the native look, in five layers. Each is presentation-only, gameplay is identical, and everything a player must read is at least as clear as in Warcraft. Every landing is judged blind by fresh viewers and held to a frame budget, with quality settings for weaker machines.

1. **Rendering:** light and shadows, effects, the world, and the final-image pass below (sessions wisp-109-light, -fx, -world, -post).
2. **Runtime remaster** of the player's own Classic art (wisp-109-remaster).
3. **Display-rate interpolation** and motion polish (wisp-109-motion).
4. **Stage worlds** with original or CC0 art (sc-stage-fullsend).
5. **Presentation screens** (wisp-109-present).

## The post stack (wisp#109)

The scene pass draws in linear light into a 4x multisampled half-float target and resolves it to a single-sample half-float texture; nothing in the scene shaders tone maps or encodes. `window/wisp-window/src/post/` owns what happens next, in this order:

1. **Sky**, drawn first inside the scene pass: a gradient from the stage's fog colour at the horizon to the stage's zenith (tinted from its ambient light when the map sets none), a sun glow and a soft disc in the sun's colour, a horizon glow band and stars where the stage's time of day asks for them, and the cloud texture over it. It replaces the sky model, so the sky is MSAA-resolved with the world's edges. A map sets the stage's sky with `WispSetSkyLook` (zenith colour, cloud cover, the sun's azimuth, elevation and colour, stars, horizon glow) and clears it with `WispResetSkyLook`; the horizon colour is always the fog's, so the fog and the sky meet. A sky look carries one fixed time of day: nothing cycles.
   The clouds are painted before the scene pass into a texture a quarter the target's size on each side (`clouds.wgsl`): up to three layers, each a vertical cylinder fixed in the world at a growing distance in front of the eye (3500, 7000 and 15000 units), so a camera pan slides the near layer further than the far ones; each layer is domain-warped value noise thresholded into soft lobes, lit from the sun's side with warm tops and cool shaded bellies mixed from the stage's own horizon and zenith, thinning into the horizon haze, and the third layer adds sun shafts marched toward the sun's place on the picture. The sky pass lays that texture over its gradient. `cloudLayers` is the preset's layer count; a stage with cover 0 draws no cloud pass. `examples/sky_shots.rs` writes a stage's sky from three pans, and `examples/post_cost.rs` times the cloud pass.
2. **Ambient occlusion** at half resolution from a half-resolution copy of the scene's depth (sample 0 of the multisampled depth), an Alchemy-style estimate with ten taps rotated by interleaved gradient noise. It reads the depth only, so translucent effects never darken themselves.
3. **Bloom:** a soft-knee threshold on luminance with a Karis average over four bilinear taps into a half-resolution target, a five-level 13-tap downsample chain, and an additive tent upsample back to the quarter-resolution level, which the composite samples bilinearly; no half-resolution upsample is drawn. Lightning, Flame Strike and hit sparks glow because their HDR values pass the threshold; a lit surface stays under it.
4. **Composite** into the surface: the bilateral-filtered occlusion darkens creases (fading out above luminance 0.8 to 2.5 so bright effects are never shaded), bloom adds, then a hue-keeping curve and the stage's grade, then a triangular dither. The curve is AgX's grey ramp applied to the brightest channel with every channel scaled by the same factor, so a bright saturated effect (Warcraft's golden level-up column, Illidan's fel green) keeps its hue where AgX's per-channel curve takes it to beige or white (Tom's playtest, 2026-10-31; swatches from `cargo run --release -p wisp-window --example post_swatches OUT.png` show clip, AgX and this curve at 0.5x to 16x). The curve runs in the shader; the grade is a 32-node 3D lookup table over the display-encoded colour, built on the CPU (`post/look.rs`) so a unit test pins what a known HDR value becomes on the display, and rebuilt only when the grade changes.
5. **UI pass** last, straight onto the surface, so menu and HUD colours are untouched.

**Per-stage grade.** A stage's grade (lift, gamma, gain, saturation) is derived from its own light: shadows lean toward the ambient colour, highlights toward the key colour, and saturation is restored after the curve. A stage with no light uses a neutral grade. Smashcraft's stage look docs (smashcraft: docs/design/home-stages.md) name where an explicit per-stage grade would be set if a derived one is not enough.

**Rim light** is the lighting session's, in the model shader, because it needs the surface normal, which this pass does not have.

Cost and tuning constants are `post::look::TUNING`. `bloom_strength` and `occlusion_strength` are the graphics settings' bloom and ssao keys (`Renderer::set_post_tuning`): a strength of zero skips that effect's passes, so the Low preset pays only for the composite.

## Water as built (wisp#109)

A model layer painted with one of Warcraft's water frames (`ReplaceableTextures\Water\WaterNN.blp`) is a water layer. Bun pushes every frame the install has, from `host/window/drawScene.ts`, beside the model that names the first; the frames are never shipped. Rust keeps the decoded frames and builds one texture array when nothing more is decoding.

- **Passes.** Without water the scene is drawn as before. With it: the sky and a mirrored copy of the scene (clipped at the water plane, half size) go to a reflection image; the sky, then the solid layers go to the scene targets and resolve into a refraction image, keeping the depth; the water pass then reads the refraction image, the reflection image and the depth, draws the water layers, and the blended and additive layers draw over it, so fighters and the deck stay in front and effects over the water stay visible. The plane is the height of the first water pose; one water level per scene.
- **Surface.** Depth below the surface is the view-space gap between the water and the depth buffer, so it needs no terrain and works on a model sea. It sets the Beer-Lambert shallow-to-deep ramp, the softened contact alpha, the caustics on the bed and the shore foam, which also rings anything standing in the water. Normals are two scrolling layers from the water frames' own brightness (cross-faded between frames, so the motion is smooth above 60 Hz) and a slow Gerstner layer, joined by reoriented blending and damped toward contact. Fresnel uses F0 0.02 against the planar reflection; the sun's glints are broken up by two noise samples; refraction offsets the lookup by the normal and keeps the undistorted pixel where the offset one is nearer than the water.
- **Settings.** `water` in the scene sets any of colours, absorption, foam width, tile, normal strength, frames per second, specular, caustics, refraction, reflection and the wave terms (`WaterSettings`); each has a default.
- **Liquids.** `water.preset` names the liquid, `water`, `poison` or `lava`, and any other field set beside it wins over the preset; Bun picks the preset from the model paths in the scene (`liquidPreset`, a lava, magma or molten model asks for lava; poison, plague, ooze, slime or toxic for poison). Poison is green, thick (a floor on opacity and a faster ramp), slow (4 frames a second, a quarter of the wave speed) and lit from within, brighter where it is deep, with lazy bubbles. Lava is opaque with a slow crust drifting over a bright core: the crust is plates cut from noise and a water frame's brightness, with hot rims at the cracks; bubbles swell and pop with a flash; embers are flickering points drifting over the surface; heat shimmer wobbles what the surface reflects and refracts. A glowing liquid also lights the models above it: each model vertex gains the liquid's colour, falling off squarely with height up to `glowReach` and strongest on the faces that look down at it, with a slow flicker, so rocks and fighters near lava are lit warm from below, in the reflection as well.
- **Embers and shimmer are surface effects.** Embers are drawn on the liquid plane, not as particles rising through the air, and the shimmer wobbles the reflection and the bed seen through the surface, not the air above it; both need a particle emitter and a post pass that are not built.
- **Look (31 October 2026, after Tom found the sea and the poison flat).** Long swells stretched along the stage roll both ways over the frame normals (`swell`), a bright web of caustic lines drifts over the surface (widening with distance so it never aliases), the shallow-to-deep ramp also deepens with distance from the eye so a bed-less sea still goes from clear to deep, a teal haze rises toward the horizon, and the sun's glints fall back to a fixed sun when the scene has no light. Poison adds `swirl`: spiral whirlpools and ridged veins lit from within in the liquid's glow colour. A material with a water layer lists the surface Warcraft's own client draws before it; the window draws the water pass in its place, so the layers before the water layer are dropped (`without_stand_in`). The stage models for poison and lava now name the water frames in an additive layer, so the window finds them as water and Warcraft's client sees a faint shimmer. `WISP_WATER_STRIPS=DIR cargo test liquid_strips_for_the_eye` writes three frames half a second apart of both liquids, both facings.
- **Not yet:** screen-space reflection ray marching, Gerstner displacement of the surface (a model sea is one quad), point lights and their shadows on the water, height and exponential fog over the sky, ripples and splashes at fighters, and a live-tuning panel.

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
  three. A matrix group of more than four bones is one extra palette entry after the nodes (`Model::blends`), the mean of the group's node matrices that `Pose::update` writes, so its vertices still name one bone and the shader stays at four (wisp#147). Billboarded nodes are not posed yet.

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
