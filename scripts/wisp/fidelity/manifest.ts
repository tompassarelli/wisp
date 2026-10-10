import { join, isAbsolute } from "node:path";
import { Effect, FileSystem, Schema } from "effect";

const Text = Schema.NonEmptyString;
const Frame = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Size = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Vector = Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite]);
const Control = Schema.Struct({ id: Text, mode: Schema.Literals(["stock", "mask", "stage"]), fog: Schema.Boolean, bloom: Schema.Boolean, dof: Schema.Finite, cine: Schema.Boolean });
const Identity = Schema.Struct({ build: Text, assetLayers: Schema.Array(Text), mapHash: Text, settingsFile: Text, resolution: Schema.Struct({ width: Size, height: Size }), gpu: Text });
const Run = Schema.Struct({ id: Text, captures: Schema.Array(Schema.Struct({ frame: Frame, control: Text, image: Text })) });
const Slice = Schema.Struct({
  lever: Text, scene: Text, kind: Schema.Literals(["lever", "stage"]), split: Schema.Literals(["fit", "held-out", "retired"]),
  pad: Text, frames: Schema.Array(Frame), camera: Schema.Struct({ position: Vector, target: Vector, fov: Schema.Finite }),
  look: Schema.Literals(["classic", "definitive"]), identity: Identity,
  settings: Schema.Record(Text, Schema.Finite), calibratedRanges: Schema.Record(Text, Schema.Struct({ min: Schema.Finite, max: Schema.Finite })),
  regions: Schema.Array(Schema.Struct({ id: Text, x: Frame, y: Frame, width: Size, height: Size, critical: Schema.Boolean })),
  controls: Schema.Array(Control), cineWindow: Schema.Struct({ start: Frame, end: Frame }), runs: Schema.Array(Run),
});

export const CaptureManifestSchema = Schema.Struct({
  version: Schema.Literal(1),
  split: Schema.Struct({ frozenAt: Text, fit: Schema.Array(Text), heldOut: Schema.Array(Text), retired: Schema.Array(Text) }),
  slices: Schema.Array(Slice),
});
export type CaptureManifest = typeof CaptureManifestSchema.Type;
export type CaptureSlice = typeof Slice.Type;
export type CaptureIdentity = typeof Identity.Type;
export type CaptureControl = typeof Control.Type;
export type CaptureRun = typeof Run.Type;

export class ManifestFailure extends Schema.TaggedError<ManifestFailure>()("ManifestFailure", { problem: Schema.String }) {
  override get message(): string { return this.problem; }
}

const unique = (values: readonly (string | number)[]) => new Set(values).size === values.length;
const relativeImage = (image: string) => !isAbsolute(image) && !image.split(/[\\/]/).includes("..") && !image.includes("\\") && !/^[A-Za-z]:/.test(image);

export function manifestProblems(manifest: CaptureManifest): string[] {
  const problems: string[] = [];
  const add = (message: string) => { problems.push(message); };
  const split = manifest.split;
  if (!Number.isFinite(Date.parse(split.frozenAt))) add("split.frozenAt must be an ISO capture split timestamp");
  const partition = [...split.fit, ...split.heldOut, ...split.retired];
  if (!unique(partition)) add("frozen split contains duplicate or overlapping scenes");
  if (manifest.slices.length === 0) add("manifest requires at least one slice");
  if (!unique(manifest.slices.map((slice) => `${slice.lever}/${slice.scene}/${slice.look}`))) add("duplicate lever/scene/look slice");
  for (const slice of manifest.slices) {
    const prefix = `${slice.lever}/${slice.scene}/${slice.look}`;
    const fail = (message: string) => add(`${prefix}: ${message}`);
    const members = slice.split === "fit" ? split.fit : slice.split === "held-out" ? split.heldOut : split.retired;
    if (!members.includes(slice.scene)) fail("scene is missing from its frozen split");
    if (slice.frames.length === 0 || !unique(slice.frames)) fail("frames must be nonempty and unique");
    if (slice.camera.fov <= 0 || slice.camera.fov >= 180) fail("camera fov must be between 0 and 180 degrees");
    if (slice.camera.position.every((value, index) => value === slice.camera.target[index])) fail("camera position and target must differ");
    if (slice.identity.assetLayers.length === 0 || !unique(slice.identity.assetLayers)) fail("asset layers must be nonempty and unique");
    const settings = Object.keys(slice.settings), ranges = Object.keys(slice.calibratedRanges);
    if (settings.length === 0 || settings.length !== ranges.length || settings.some((key) => !ranges.includes(key))) fail("settings and calibrated ranges need the same nonempty keys");
    for (const [key, range] of Object.entries(slice.calibratedRanges)) {
      if (range.min > range.max) fail(`${key}: calibrated min exceeds max`);
    }
    if (slice.regions.length === 0 || !unique(slice.regions.map((region) => region.id))) fail("metric regions must be nonempty and unique");
    for (const region of slice.regions) {
      if (region.x + region.width > slice.identity.resolution.width || region.y + region.height > slice.identity.resolution.height) fail(`${region.id}: region exceeds capture resolution`);
    }
    if (!unique(slice.controls.map((control) => control.id))) fail("control IDs must be unique");
    for (const mode of ["stock", "mask", "stage"]) if (!slice.controls.some((control) => control.mode === mode)) fail(`missing ${mode} control`);
    for (const mode of ["fog", "bloom"] as const) for (const enabled of [false, true]) {
      if (!slice.controls.some((control) => control[mode] === enabled)) fail(`missing ${mode} ${enabled ? "on" : "off"} control`);
    }
    if (new Set(slice.controls.map((control) => control.dof)).size < 3) fail("DOF sweep requires at least three values");
    if (!slice.controls.some((control) => control.cine) || !slice.controls.some((control) => !control.cine)) fail("cine on/off controls are required");
    if (slice.cineWindow.end < slice.cineWindow.start) fail("cine window end precedes start");
    const cineFrames = slice.frames.filter((frame) => frame >= slice.cineWindow.start && frame <= slice.cineWindow.end);
    if (cineFrames.length !== slice.cineWindow.end - slice.cineWindow.start + 1) fail("every cine window frame must be listed");
    if (slice.runs.length < 3 || !unique(slice.runs.map((run) => run.id))) fail("at least three distinct runs are required");
    const images = new Set<string>();
    for (const run of slice.runs) {
      const keys = new Set<string>();
      for (const capture of run.captures) {
        const key = `${capture.frame}/${capture.control}`;
        if (keys.has(key)) fail(`${run.id}: duplicate frame/control ${key}`);
        keys.add(key);
        if (!slice.frames.includes(capture.frame) || !slice.controls.some((control) => control.id === capture.control)) fail(`${run.id}: undeclared frame/control ${key}`);
        if (!relativeImage(capture.image) || images.has(capture.image)) fail(`${run.id}: images must use distinct relative paths inside the capture directory`);
        images.add(capture.image);
      }
      for (const frame of slice.frames) for (const control of slice.controls) {
        if (!keys.has(`${frame}/${control.id}`)) fail(`${run.id}: missing frame ${frame} control ${control.id}`);
      }
    }
  }
  return problems;
}

export const decodeManifest = (input: unknown) => Schema.decodeUnknownEffect(CaptureManifestSchema)(input).pipe(
  Effect.mapError((cause) => new ManifestFailure({ problem: `invalid capture manifest: ${String(cause)}` })),
  Effect.flatMap((manifest) => {
    const problems = manifestProblems(manifest);
    return problems.length === 0 ? Effect.succeed(manifest) : Effect.fail(new ManifestFailure({ problem: problems.join("\n") }));
  }),
);

export const readManifest = (directory: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(join(directory, "manifest.json")).pipe(Effect.mapError((cause) => new ManifestFailure({ problem: `cannot read manifest.json: ${String(cause)}` })));
  const input = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(Effect.mapError((cause) => new ManifestFailure({ problem: `invalid manifest JSON: ${String(cause)}` })));
  return yield* decodeManifest(input);
});
