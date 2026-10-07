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
`BlzSetSpecialEffectMatrixScale`, `BlzResetSpecialEffectMatrix` and the
position setters `BlzSetSpecialEffectPosition`, `BlzSetSpecialEffectX`, `Y`
and `Z` in the Lua globals once. The game's code stays as it is; an entry
that never starts the recorder, such as a playable build's, compiles none of
it.

A game that draws some of what players see with units passes `unitModel`,
the model each unit type draws (undefined for types it doesn't track). The
recorder then also wraps `CreateUnit`, `RemoveUnit`, `ShowUnit`,
`SetUnitVertexColor` and `SetUnitScale`, and reports those units under their
model with the effects: a unit is in view while shown, and drawn while shown
with nonzero alpha and scale. Removing a unit plays no death animation, so it
never counts as destroyed in view.

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

A stay in view starts when the game places an effect anywhere but its parking
place and ends when it parks it there, at that frame. Each report also reads
every effect's position, which catches effects moved some other way, such as
attached ones, to half a second. A game that reuses one effect for a new
event, such as a pool slot taken by the next hit while the last one still
shows, parks it before placing it again, so each use is a stay of its own;
an effect moved in view without parking is one stay however often it moves.
Ages are counted in the frames of the clock the game passes,
which should stand still while nothing plays, such as during a pause. When that clock
restarts, as at a rematch, the recorder's clock keeps rising from where it
was. Every wrapped call costs a table lookup, a position call also asks
`parked`, and each report reads three getters per effect, so keep the
recorder out of measurement builds.

Each line of the report gives, per model path (with `/` for `\`): live
effects, those in view, those drawn, the frame the oldest was created on, how
long the longest-standing one in view has been there, the longest any of
them has stayed in view without a break since the recorder started, and how
many were destroyed in view, where Warcraft plays their death animation.

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

A game that knows what must be on screen, such as each fighter in play with
the models it may be drawn with (`SceneBody`), checks it with `bodyProblems`:
a body none of whose effects is drawn with triangles, by the models' facts,
is invisible. The [soak](soak.md) asks the game for its bodies with every
report.

wisp:scripts/wisp/scene.ts and wisp:scripts/wisp/frameProbe.ts are plain
functions: a game's tests can check the lines its recorder wrote with
`readSceneLines` and `sceneProblems` without loading Effect.

## Frame probe

The compositor read in wisp:scripts/warcraft/desktop.ts has an eight-second
deadline. Cancellation or timeout stops and reaps the owned capture process
before returning a failure. A framebuffer read establishes the image only;
consumers that request a specific game frame must hold that pose and require
matching drawn-frame receipts before and after the read. A later or absent
completion receipt is INVALID, never evidence for the requested frame.

For a running game's response measurement, `captureTimed(client, nowNs, region?)`
returns `{ frame, beforeNs, afterNs }`. Supply the same monotonic nanosecond
clock that stamps input injection; for cross-process Linux evidence that means
`CLOCK_MONOTONIC`, not Bun's process-relative `hrtime`. Consume consecutive
samples serially and retain the pixels and both timestamps outside the repository.
The interval brackets framebuffer acquisition including child startup and
readback. It is not a presentation timestamp, and its midpoint must not be
reported as one. A response first observed in those pixels happened no later
than `afterNs`; use that conservative upper bound for a latency gate. A prior
absent sample only establishes absence at some point in its acquisition interval.
Measure acquisition intervals before choosing a sample rate. This API makes no
frame-rate guarantee and cannot identify the game's responding object: the
consumer must detect actual game pixels, separately from diagnostic markers.

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

## Render visibility

The scene report says which effects the game hides; what a player still sees
of them depends on their models. Give `SceneExpectations` a `visibility`
declaration and `sceneProblems` also reports what a player could see that the
game considers hidden or gone (wisp:scripts/wisp/visibility.ts):

- a model a kind names that is empty, has no facts, or has no triangles,
  particles or light, so nothing is drawn where the game expects it;
- effects in view but not drawn, by alpha, scale or a flat matrix, whose model
  emits particles in a sequence other than death: those emitters keep running;
- parked effects whose mesh or particles, alive or in their death animation,
  reach into a declared camera's frame from a declared parking place;
- effects destroyed in view whose death animation emits particles there.

`modelFacts` (wisp:scripts/wisp/models.ts) reads an MDX file into what the
check needs: geosets, triangles, lights, the mesh's box over every sequence,
and per particle, ribbon, model or popcorn emitter whether it runs while shown
and in death, whether its particles can show, its rate, lifespan and reach.
An emitter runs in a sequence when its visibility and rate are above zero
there; a track without keys in a sequence takes its default. Reach is a set
of boxes around the model's origin at scale 1 that bound the particle's
flight: its fastest launch in any direction for its lifespan, plus size,
emission area and tail. A particle pulled down stays under the parabola
speed²/2g − g·h²/2speed² at horizontal distance h, so its flight is cut into
eight rings of h, each as high as that parabola at its inner edge: a death
spray flung far out has fallen by the time it gets there. A popcorn
emitter's reach isn't in the file, and a model emitter's reach leaves out
the emitted model's size.
Facts are plain records, so a game can read its imported files and the game's
archives once, keep the table, and check scenes without the files.

The game reads its own models: its imports from the build's inputs, and the
game's models from the local install. Its declaration names every camera a
player may see a match through (`CameraView`: target, distance, angle of
attack, rotation, field of view across the width, aspect and far plane, with
roll zero) and every place it parks hidden effects, in the same coordinates.
The frame test is conservative: a box that misses the frame only past one of
its corners still counts as seen.

The pinned war3-model 4.0.1 reads a version 1800 light record 24 bytes short
and fails on some camera records, so `modelFacts` counts light records itself
and leaves both chunks out of parsing; facts use neither.

## Boundaries

The scene report shows what the map asked Warcraft to draw, not what reached
the screen: a model missing from the archive, or one in view but outside the
camera's frame, still counts as drawn. The frame probe sees the screen but only what its
features measure. Render visibility knows a model's emitters and a camera's
frame, not textures, blending or draw order. None of them judges readability;
that stays with a playtest.
