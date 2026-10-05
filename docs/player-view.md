# Player view checks

Type checks, logic tests and a desync guard can all pass while a player sees no
stage, or an effect that never goes away. Wisp checks what a match draws in two
independent ways, both opt-in for development and diagnostic builds:

- the **scene report**: the map records every special effect it creates and
  writes, for each model path, how many exist, how many are in view and drawn,
  and how long one has stayed in view. The host checks it against the game's
  declared expectations;
- the **frame probe**: the host captures one client frame off-screen, keeps it
  on disk and measures pixels in it against features the game declares, such
  as its stage in a band of the screen.

`checkPlayerView` (wisp:scripts/wisp/playerView.ts) runs both in every
signed-in client once a match runs, and fails with what a player would see
wrong in each client.

## Scene report

Start the recorder from the entry of each build that should report, after
`configureRuntime`, and register its handler in that entry's `install`:

```ts
import { installSceneReport, startSceneReport } from "wisp/src/platform/scene";

export function install(this: void): void {
  installMap();
  installSceneReport();
}

export function start(this: void): void {
  startMap();
  startSceneReport({ frame: () => currentFrame(), parked: (x, y, z) => z < PARKING_HEIGHT });
}
```

The recorder (wisp:src/platform/scene.ts) wraps `AddSpecialEffect`,
`AddSpecialEffectLoc`, `AddSpecialEffectTarget`, `DestroyEffect`,
`BlzSetSpecialEffectAlpha`, `BlzSetSpecialEffectScale`,
`BlzSetSpecialEffectMatrixScale` and `BlzResetSpecialEffectMatrix` in the Lua
globals once. The game's code stays as it is; an entry that never starts the
recorder, such as a playable build's, compiles none of it.

Warcraft keeps a model's particle emitters running at any alpha, scale or time
scale, so a collapsed effect left where the camera looks still shows its
particles. A game hides an effect for good only by moving it where no camera
sees, and declares that place with `parked`. Each report reads every effect's
position with the local position getters: an effect is **in view** unless it
is parked, and **drawn** while it is in view with alpha and scale above zero
and no matrix-scale axis at zero. A model that hides itself some other way,
such as by animation, counts as drawn.

The recorder is local to its client. It records into Lua tables, creates one
timer at start on every client alike, and writes
`PREFIX-scene-pSLOT.txt` (wisp:src/runtime/scene.ts) every 0.5 s of game time.
Nothing in the game reads that file back, so one name per slot is safe under
the Preloader rule. A hot reload keeps the wrappers and the records; the
reloaded bundle's `install` registers the new report handler.

Positions are read only when a report is written, so stays in view are known
to half a second. Ages are counted in the frames of the clock the game passes,
which should stand still while nothing plays, such as during a pause. When that clock
restarts, as at a rematch, the recorder's clock keeps rising from where it
was. Every wrapped call costs a table lookup and each report reads three
getters per effect, so keep the recorder out of measurement builds.

Each line of the report gives, per model path (with `/` for `\`): live
effects, those in view, those drawn, the frame the oldest was created on, how
long the longest-standing one in view has been there, and the longest any of
them has stayed in view without a break since the recorder started.

### Expectations

The game declares, in host code, each kind of effect it draws: a name a player
would use, its model paths and the most frames one may stay in view
(`SceneKind`, wisp:scripts/wisp/scene.ts). One kind is the stage, with the
number of pieces a match must show. Take model paths from the game's own
constants where it exports them: an empty constant then names its kind in the
empty-model problem, and a path no kind lists fails as undeclared. Declare
lifetimes as what a player should see, not from the code that hides the
effect, or the check passes whatever the code does. `sceneProblems` reports:

- fewer stage pieces drawn than the stage needs, counting only pieces with
  a model;
- effects created with an empty model path, which Warcraft draws as nothing;
- effects in view whose model no kind declares;
- a model whose effects stayed in view longer than its kinds' longest
  lifetime. Kinds that share a model share their longest lifetime.

wisp:scripts/wisp/scene.ts and wisp:scripts/wisp/frameProbe.ts are plain
functions: a game's tests can check the lines its recorder wrote with
`readSceneLines` and `sceneProblems` without loading Effect.

## Frame probe

wisp:scripts/wisp/frameProbe.ts measures a frame; it never needs the image
viewed. Bands are fractions of the frame's width and height, so one
declaration fits the 2560x1440 private-desktop capture and a downscaled
recording alike. `colorRows` counts the rows of a band that hold an unbroken
horizontal run of the declared colors, each channel within a tolerance, at
least a given share of the frame's width long; two-pixel gaps don't break a
run. `pixelShare` measures how much of a band a predicate accepts. A game
declares each `FrameFeature` with what a player sees when it is absent.

`checkPlayerView` captures through the `Clients` service and keeps each frame
as `FRAMES/CLIENT.ppm`, a binary PPM any image viewer opens. Calibrate a
feature on frames where it is absent and where it is present, from captures
or recordings (`ffmpeg -i REC.mkv -vf fps=1 frame-%03d.ppm`), and record the
threshold and its measured margin beside the declaration.

## Boundaries

The scene report shows what the map asked Warcraft to draw, not what reached
the screen: a model missing from the archive, or one in view but outside the
camera's frame, still counts as drawn. The frame probe sees the screen but only what its
features measure. Neither judges readability; that stays with a playtest.
