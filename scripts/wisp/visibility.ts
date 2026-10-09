






import { reportedModel } from "../../src/runtime/scene";
import { type Box, type ModelFacts, type Vector3, drawsNothing, hiddenEmitters, modelReach } from "./models";
import type { SceneKind, SceneProblem, SceneReport } from "./scene";


export interface CameraView {

  readonly target: Vector3;
  readonly distance: number;

  readonly angleOfAttack: number;

  readonly rotation: number;

  readonly fieldOfView: number;

  readonly aspect: number;

  readonly farZ: number;
}

export interface VisibilityExpectations {

  readonly models: Readonly<Record<string, ModelFacts>>;

  readonly cameras: readonly CameraView[];

  readonly parking: readonly Vector3[];
}

type Vector = readonly [number, number, number];
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector, b: Vector): Vector => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];


interface CameraFrame {
  readonly eye: Vector;
  readonly right: Vector;
  readonly up: Vector;
  readonly forward: Vector;

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

interface Sighting {
  readonly place: Vector3;
  readonly camera: CameraView;
  readonly box: Box;
}


const prepared = new WeakMap<VisibilityExpectations, { readonly facts: ReadonlyMap<string, ModelFacts>; readonly sightings: Map<string, Sighting | undefined> }>();

function preparedFor(expected: VisibilityExpectations) {
  let entry = prepared.get(expected);
  if (entry === undefined) {
    entry = { facts: new Map(Object.entries(expected.models).map(([model, facts]) => [key(model), facts])), sightings: new Map() };
    prepared.set(expected, entry);
  }
  return entry;
}


function sighting(expected: VisibilityExpectations, model: string, boxes: readonly Box[]): Sighting | undefined {
  const { sightings } = preparedFor(expected);
  if (sightings.has(model)) return sightings.get(model);
  let found: Sighting | undefined;
  for (const place of expected.parking) {
    for (const camera of expected.cameras) {
      const box = boxes.find((reach) => boxSeen(shift(reach, place), camera));
      if (box !== undefined) {
        found = { place, camera, box };
        break;
      }
    }
    if (found !== undefined) break;
  }
  sightings.set(model, found);
  return found;
}












export function visibilityProblems(report: SceneReport, kinds: readonly SceneKind[], expected: VisibilityExpectations): readonly SceneProblem[] {
  const { facts } = preparedFor(expected);
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
        const seen = sighting(expected, key(line.model), boxes);
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
