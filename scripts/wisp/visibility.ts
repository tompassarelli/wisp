// Render visibility: what a player can see that the game considers hidden or
// gone, without pixels. It reads the scene report (scene.ts) with the facts of
// every model the game draws (models.ts) and the cameras the game shows a
// match through. Warcraft keeps a model's emitters running at any alpha, scale
// or time scale and plays a destroyed effect's death animation where it
// stands, so a hidden effect is out of sight only where no camera can see
// anything it draws. Plain functions, like scene.ts.
import { reportedModel } from "../../src/runtime/scene";
import { type Box, type ModelFacts, type Vector3, drawsNothing, hiddenEmitters, modelReach } from "./models";
import type { SceneKind, SceneProblem, SceneReport } from "./scene";

/** A Warcraft camera as the game sets its fields, in world units and degrees. Roll is zero. */
export interface CameraView {
  /** The point it looks at: its target position, with the z offset above the ground there. */
  readonly target: Vector3;
  readonly distance: number;
  /** CAMERA_FIELD_ANGLE_OF_ATTACK: 270 looks straight down, 360 level. */
  readonly angleOfAttack: number;
  /** CAMERA_FIELD_ROTATION: 90 looks along +y. */
  readonly rotation: number;
  /** CAMERA_FIELD_FIELD_OF_VIEW, across the frame's width. */
  readonly fieldOfView: number;
  /** The frame's width over its height. */
  readonly aspect: number;
  /** CAMERA_FIELD_FARZ: nothing farther is drawn. */
  readonly farZ: number;
}

export interface VisibilityExpectations {
  /** What each model draws, keyed by its path as the game names it. Every model a kind names needs an entry. */
  readonly models: Readonly<Record<string, ModelFacts>>;
  /** Every camera a player may see a match through, in the coordinates of `parking`. */
  readonly cameras: readonly CameraView[];
  /** Where the game parks the effects it hides. */
  readonly parking: readonly Vector3[];
}

type Vector = readonly [number, number, number];
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A camera's axes and the planes bounding its frame, which every box checked against it shares. */
interface CameraFrame {
  readonly eye: Vector;
  readonly right: Vector;
  readonly up: Vector;
  readonly forward: Vector;
  /** Each plane bounding the frame, as a distance that is negative outside it. */
  readonly planes: readonly ((corner: Vector) => number)[];
}

const frames = new WeakMap<CameraView, CameraFrame>();

function cameraFrame(camera: CameraView): CameraFrame {
  const known = frames.get(camera);
  if (known !== undefined) return known;
  const pitch = radians(camera.angleOfAttack > 180 ? camera.angleOfAttack - 360 : camera.angleOfAttack);
  const yaw = radians(camera.rotation);
  const forward: Vector = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
  const right: Vector = [Math.sin(yaw), -Math.cos(yaw), 0];
  const up = cross(right, forward);
  const [x, y, z] = camera.target;
  const eye: Vector = [x - camera.distance * forward[0], y - camera.distance * forward[1], z - camera.distance * forward[2]];
  const across = Math.tan(radians(camera.fieldOfView / 2));
  const upward = across / camera.aspect;
  const planes = [
    ([, , depth]: Vector) => depth,
    ([, , depth]: Vector) => camera.farZ - depth,
    ([side, , depth]: Vector) => depth * across - side,
    ([side, , depth]: Vector) => depth * across + side,
    ([, height, depth]: Vector) => depth * upward - height,
    ([, height, depth]: Vector) => depth * upward + height,
  ];
  const frame = { eye, right, up, forward, planes };
  frames.set(camera, frame);
  return frame;
}

/**
 * Whether any of `box` can be inside the camera's frame. Conservative: a box
 * outside the frame only past a corner of it still counts as seen.
 */
export function boxSeen(box: Box, camera: CameraView): boolean {
  const { eye, right, up, forward, planes } = cameraFrame(camera);
  const corners: Vector[] = [];
  for (const cornerX of [box.min[0], box.max[0]]) for (const cornerY of [box.min[1], box.max[1]]) for (const cornerZ of [box.min[2], box.max[2]]) {
    const relative: Vector = [cornerX - eye[0], cornerY - eye[1], cornerZ - eye[2]];
    corners.push([dot(relative, right), dot(relative, up), dot(relative, forward)]);
  }
  return !planes.some((plane) => corners.every((corner) => plane(corner) < 0));
}

const shift = (box: Box, by: Vector3): Box => ({
  min: [box.min[0] + by[0], box.min[1] + by[1], box.min[2] + by[2]],
  max: [box.max[0] + by[0], box.max[1] + by[1], box.max[2] + by[2]],
});

const key = (model: string) => reportedModel(model).toLowerCase();
const round = (value: number) => Math.round(value);
const point = (at: Vector3) => `(${at.map(round).join(", ")})`;
const seconds = (value: number) => `${Number(value.toFixed(2))} s`;
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * Everything a player could see that the game considers hidden or gone, and
 * every model the game names that draws nothing:
 * - a model a kind names that is empty, has no facts, or has no triangles,
 *   particles or light;
 * - effects in view but hidden by alpha, scale or a flat matrix whose model
 *   keeps emitting particles;
 * - parked effects whose mesh or particles reach into a camera's frame from a
 *   parking place;
 * - effects destroyed in view whose death animation emits particles.
 */
export function visibilityProblems(report: SceneReport, kinds: readonly SceneKind[], expected: VisibilityExpectations): readonly SceneProblem[] {
  const facts = new Map(Object.entries(expected.models).map(([model, entry]) => [key(model), entry]));
  const named = new Map<string, { readonly model: string; readonly names: string[] }>();
  for (const { name, models } of kinds) {
    for (const model of models) {
      const entry = named.get(key(model)) ?? { model, names: [] };
      if (!entry.names.includes(name)) entry.names.push(name);
      named.set(key(model), entry);
    }
  }
  const kindOf = (model: string) => named.get(key(model))?.names.join(", ") ?? "effect";
  const problems: SceneProblem[] = [];
  for (const [path, { model, names }] of named) {
    const kind = names.join(", ");
    const entry = facts.get(path);
    if (model === "") problems.push({ seen: `nothing where a ${kind} should be: the game names no model for it`, evidence: "model path is empty" });
    else if (entry === undefined) problems.push({ seen: `what a ${kind} draws is unknown`, evidence: `model ${reportedModel(model)} has no facts; read the models again` });
    else if (drawsNothing(entry)) problems.push({ seen: `nothing where a ${kind} should be: its model has no triangles, particles or light`, evidence: `model ${reportedModel(model)}: ${plural(entry.geosets, "geoset")}, 0 triangles` });
  }
  for (const line of report.models) {
    if (line.model === "") continue;
    const entry = facts.get(key(line.model));
    const kind = kindOf(line.model);
    if (entry === undefined) {
      if (!named.has(key(line.model)) && line.live + line.destroyed > 0) {
        problems.push({ seen: `what ${plural(line.live, "effect")} of an undeclared model draw is unknown`, evidence: `model ${line.model} has no facts` });
      }
      continue;
    }
    const hidden = line.inView - line.drawn;
    const emitting = hiddenEmitters(entry);
    if (hidden > 0 && emitting.length > 0) {
      problems.push({
        seen: `${hidden} hidden ${kind}${hidden === 1 ? "" : "s"} in view still show particles`,
        evidence: `model ${line.model}: ${line.inView} in view, ${line.drawn} drawn; ${emitting.map(({ name, rate, lifespan }) => `${name} emits ${Number(rate.toFixed(2))}/s, each for ${seconds(lifespan)}`).join("; ")}`,
      });
    }
    const parked = line.live - line.inView;
    if (parked > 0) {
      const { boxes, unknown } = modelReach(entry);
      if (unknown.length > 0) {
        problems.push({ seen: `${parked} parked ${kind}${parked === 1 ? "" : "s"} may show particles from where they are parked`, evidence: `model ${line.model}: the reach of ${unknown.join(", ")} is unknown` });
      } else {
        const seen = expected.parking.flatMap((place) => expected.cameras.flatMap((camera) => {
          const box = boxes.find((reach) => boxSeen(shift(reach, place), camera));
          return box === undefined ? [] : [{ place, camera, box }];
        }))[0];
        if (seen !== undefined) {
          const { place, camera, box } = seen;
          const { min, max } = shift(box, place);
          problems.push({
            seen: `${parked} parked ${kind}${parked === 1 ? "" : "s"} can be seen where the game parks them`,
            evidence: `model ${line.model} parked at ${point(place)} can draw from ${point(min)} to ${point(max)}, inside the frame of the camera on ${point(camera.target)} from ${round(camera.distance)}`,
          });
        }
      }
    }
    const bursts = entry.emitters.filter(({ onDeath, visible }) => onDeath && visible);
    if (line.destroyed > 0 && bursts.length > 0) {
      problems.push({
        seen: `${line.destroyed} ${kind}${line.destroyed === 1 ? "" : "s"} destroyed in view burst particles as they go`,
        evidence: `model ${line.model}: its death animation runs ${bursts.map(({ name }) => name).join(", ")} where the effect stood`,
      });
    }
  }
  return problems;
}
