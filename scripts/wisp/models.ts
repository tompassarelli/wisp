





import { type model as mdx, parseMDL, parseMDX } from "../../vendor/war3-model.mjs";
import { selectSequence } from "../../src/headless/animation";

export type Vector3 = readonly [x: number, y: number, z: number];


export interface Box {
  readonly min: Vector3;
  readonly max: Vector3;
}

export type EmitterKind = "particle" | "ribbon" | "model particle" | "popcorn";

export interface EmitterFacts {
  readonly kind: EmitterKind;
  readonly name: string;

  readonly whileShown: boolean;

  readonly onDeath: boolean;

  readonly visible: boolean;

  readonly rate: number;

  readonly lifespan: number;

  readonly reach?: readonly Box[];
}

export interface ModelFacts {
  readonly geosets: number;
  readonly triangles: number;
  readonly lights: number;

  readonly bounds?: Box;
  readonly emitters: readonly EmitterFacts[];
}

type Track = mdx.AnimVector | number | undefined;

/** Chunks that facts don't use and the pinned war3-model 4.0.1 misreads: a version 1800 light record carries 24 bytes more than it reads, and some camera records don't parse. */
const SKIPPED = new Set(["LITE", "CAMS"]);


export function parsableModel(bytes: Uint8Array, keepLights = false): { readonly bytes: Uint8Array; readonly lights: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 4 || tag(0) !== "MDLX") throw new Error("not an MDX model");
  const kept: Uint8Array[] = [bytes.subarray(0, 4)];
  let lights = 0;
  for (let at = 4; at < bytes.length;) {
    if (at + 8 > bytes.length) throw new Error(`truncated chunk header at byte ${at}`);
    const name = tag(at);
    const size = view.getUint32(at + 4, true);
    const end = at + 8 + size;
    if (end > bytes.length) throw new Error(`chunk ${name} at byte ${at} runs past the end of the file`);
    if (name === "LITE") {

      for (let record = at + 8; record < end; lights++) record += Math.max(4, view.getUint32(record, true));
    }
    if (!SKIPPED.has(name) || (keepLights && name === "LITE")) kept.push(bytes.subarray(at, end));
    at = end;
  }
  const joined = new Uint8Array(kept.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    joined.set(part, offset);
    offset += part.length;
  }
  return { bytes: joined, lights };
}


export function parseModelMDX(bytes: ArrayBuffer): mdx.Model {
  return parseMDX(parsableModel(new Uint8Array(bytes)).bytes.slice().buffer);
}


function valuesIn(model: mdx.Model, track: Track, from: number, to: number, fallback: number): number[] {
  if (track === undefined) return [fallback];
  if (typeof track === "number") return [track];

  const id = track.GlobalSeqId ?? -1;
  const global = id === -1 || id === 0xffffffff ? undefined : model.GlobalSequences[id];
  const [start, end] = global === undefined ? [from, to] : [0, global];
  const keys = track.Keys.filter(({ Frame }) => Frame >= start && Frame <= end).map(({ Vector }) => Vector[0] ?? 0);
  return keys.length > 0 ? keys : [fallback];
}


function allValues(track: Track, fallback: number): number[] {
  if (track === undefined) return [fallback];
  if (typeof track === "number") return [track];
  return track.Keys.length > 0 ? track.Keys.map(({ Vector }) => Vector[0] ?? 0) : [fallback];
}

const most = (track: Track, fallback = 0) => Math.max(...allValues(track, fallback));
const least = (track: Track, fallback = 0) => Math.min(...allValues(track, fallback));


const DEATH = /^(death|decay|dissipate)/i;


function running(model: mdx.Model, visibility: Track, rate: Track): { readonly whileShown: boolean; readonly onDeath: boolean } {


  const fallbackRate = most(rate);
  const runs = (from: number, to: number) =>
    valuesIn(model, visibility, from, to, 1).some((value) => value > 0) && valuesIn(model, rate, from, to, fallbackRate).some((value) => value > 0);
  if (model.Sequences.length === 0) return { whileShown: runs(-Infinity, Infinity), onDeath: false };
  let whileShown = false;
  let onDeath = false;
  for (const { Name, Interval } of model.Sequences) {
    if (!runs(Interval[0] ?? 0, Interval[1] ?? 0)) continue;
    if (DEATH.test(Name)) onDeath = true;
    else whileShown = true;
  }
  return { whileShown, onDeath };
}

const pivotOf = (model: mdx.Model, node: mdx.Node): Vector3 => {
  const pivot = model.PivotPoints[node.ObjectId];
  return [pivot?.[0] ?? 0, pivot?.[1] ?? 0, pivot?.[2] ?? 0];
};


const RINGS = 8;









function flight(pivot: Vector3, speed: number, gravity: { readonly down: number; readonly up: number }, lifespan: number, pad: number): Box[] {
  const across = speed * lifespan;
  const fall = 0.5 * gravity.down * lifespan * lifespan;
  const lift = 0.5 * gravity.up * lifespan * lifespan;
  const [x, y, z] = pivot;
  const lowest = z - across - fall - pad;
  const box = (out: number, top: number): Box => ({ min: [x - out - pad, y - out - pad, lowest], max: [x + out + pad, y + out + pad, Math.max(lowest, z + top + lift + pad)] });
  if (gravity.down <= 0 || speed <= 0) return [box(across, across)];
  const { down } = gravity;

  const rise = speed < down * lifespan ? (speed * speed) / (2 * down) : across - fall;
  const under = (distance: number) => Math.min(rise, (speed * speed) / (2 * down) - (down * distance * distance) / (2 * speed * speed));
  return Array.from({ length: RINGS }, (_, ring) => box((across * (ring + 1)) / RINGS, under((across * ring) / RINGS)));
}

const gravityOf = (track: Track) => ({ down: Math.max(0, most(track)), up: Math.max(0, -least(track)) });


const TAIL = 2;

function particleEmitter(model: mdx.Model, emitter: mdx.ParticleEmitter2): EmitterFacts {
  const lifespan = emitter.LifeSpan ?? 0;
  const speed = most(emitter.Speed) * (1 + Math.max(0, most(emitter.Variation)));
  const size = Math.max(0, ...(emitter.ParticleScaling ?? []));
  const area = Math.hypot(most(emitter.Width), most(emitter.Length)) / 2;
  const tail = (emitter.FrameFlags & TAIL) !== 0 ? speed * (emitter.TailLength ?? 0) : 0;
  return {
    kind: "particle",
    name: emitter.Name,
    ...running(model, emitter.Visibility, emitter.EmissionRate),
    visible: Math.max(0, ...(emitter.Alpha ?? [])) > 0 && size > 0,
    rate: most(emitter.EmissionRate),
    lifespan,
    reach: flight(pivotOf(model, emitter), speed, gravityOf(emitter.Gravity), lifespan, size + area + tail),
  };
}

function ribbonEmitter(model: mdx.Model, emitter: mdx.RibbonEmitter): EmitterFacts {
  const lifespan = emitter.LifeSpan ?? 0;
  const height = Math.max(most(emitter.HeightAbove), most(emitter.HeightBelow));

  return {
    kind: "ribbon",
    name: emitter.Name,
    ...running(model, emitter.Visibility, emitter.EmissionRate),
    visible: most(emitter.Alpha, 1) > 0 && most(emitter.HeightAbove) + most(emitter.HeightBelow) > 0,
    rate: emitter.EmissionRate ?? 0,
    lifespan,
    reach: flight(pivotOf(model, emitter), 0, gravityOf(emitter.Gravity), lifespan, height),
  };
}


function modelEmitter(model: mdx.Model, emitter: mdx.ParticleEmitter): EmitterFacts {
  const lifespan = most(emitter.LifeSpan);
  return {
    kind: "model particle",
    name: emitter.Name,
    ...running(model, emitter.Visibility, emitter.EmissionRate),
    visible: true,
    rate: most(emitter.EmissionRate),
    lifespan,
    reach: flight(pivotOf(model, emitter), most(emitter.InitVelocity), gravityOf(emitter.Gravity), lifespan, 0),
  };
}


function popcornEmitter(model: mdx.Model, emitter: mdx.ParticleEmitterPopcorn): EmitterFacts {
  return {
    kind: "popcorn",
    name: emitter.Name,
    ...running(model, emitter.Visibility, emitter.EmissionRate),
    visible: most(emitter.Alpha, 1) > 0,
    rate: most(emitter.EmissionRate),
    lifespan: most(emitter.LifeSpan),
  };
}

/** Engine sentinels, such as a death sequence's float-max extent, aren't positions. */
const usable = (min: ArrayLike<number> | undefined, max: ArrayLike<number> | undefined) =>
  min !== undefined && max !== undefined && min.length >= 3 && max.length >= 3
  && [0, 1, 2].every((axis) => Math.abs(min[axis] ?? 0) < 1e6 && Math.abs(max[axis] ?? 0) < 1e6 && (min[axis] ?? 0) <= (max[axis] ?? 0));


export function union(boxes: readonly Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  const axis = (pick: (box: Box) => Vector3, choose: (...values: number[]) => number, index: 0 | 1 | 2) => choose(...boxes.map((box) => pick(box)[index]));
  return {
    min: [axis((box) => box.min, Math.min, 0), axis((box) => box.min, Math.min, 1), axis((box) => box.min, Math.min, 2)],
    max: [axis((box) => box.max, Math.max, 0), axis((box) => box.max, Math.max, 1), axis((box) => box.max, Math.max, 2)],
  };
}

const boxOf = (min: ArrayLike<number>, max: ArrayLike<number>): Box => ({
  min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0],
  max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0],
});


function meshBounds(model: mdx.Model): Box | undefined {
  const boxes: Box[] = [];
  const add = (min: ArrayLike<number> | undefined, max: ArrayLike<number> | undefined) => {
    if (usable(min, max) && min !== undefined && max !== undefined) boxes.push(boxOf(min, max));
  };
  for (const geoset of model.Geosets) {
    const { Vertices } = geoset;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let at = 0; at + 2 < Vertices.length; at += 3) {
      for (const axis of [0, 1, 2] as const) {
        const value = Vertices[at + axis] ?? 0;
        low[axis] = Math.min(low[axis] ?? value, value);
        high[axis] = Math.max(high[axis] ?? value, value);
      }
    }
    if (Vertices.length >= 3) add(low, high);
    add(geoset.MinimumExtent, geoset.MaximumExtent);
    for (const anim of geoset.Anims) add(anim.MinimumExtent, anim.MaximumExtent);
  }
  for (const sequence of model.Sequences) add(sequence.MinimumExtent, sequence.MaximumExtent);
  add(model.Info.MinimumExtent, model.Info.MaximumExtent);
  return union(boxes);
}


export function modelFacts(file: Uint8Array): ModelFacts {
  const { bytes, lights } = parsableModel(file);
  const model = parseMDX(bytes.slice().buffer);
  const triangles = model.Geosets.reduce((sum, { Faces }) => sum + Math.floor(Faces.length / 3), 0);
  const bounds = triangles > 0 ? meshBounds(model) : undefined;
  return {
    geosets: model.Geosets.length,
    triangles,
    lights,
    ...(bounds === undefined ? {} : { bounds }),
    emitters: [
      ...model.ParticleEmitters2.map((emitter) => particleEmitter(model, emitter)),
      ...model.RibbonEmitters.map((emitter) => ribbonEmitter(model, emitter)),
      ...model.ParticleEmitters.map((emitter) => modelEmitter(model, emitter)),
      ...(model.ParticleEmitterPopcorns ?? []).map((emitter) => popcornEmitter(model, emitter)),
    ],
  };
}


export const drawsNothing = (facts: ModelFacts) => facts.triangles === 0 && facts.lights === 0 && !facts.emitters.some(({ visible }) => visible);


export const hiddenEmitters = (facts: ModelFacts) => facts.emitters.filter(({ whileShown, visible }) => whileShown && visible);


export function modelReach(facts: ModelFacts): { readonly boxes: readonly Box[]; readonly unknown: readonly string[] } {
  const shown = facts.emitters.filter(({ visible, whileShown, onDeath }) => visible && (whileShown || onDeath));
  return {
    boxes: [...(facts.bounds === undefined ? [] : [facts.bounds]), ...shown.flatMap(({ reach }) => reach ?? [])],
    unknown: shown.filter(({ reach }) => reach === undefined).map(({ name }) => name),
  };
}






export function deathSeconds(file: Uint8Array): number | undefined {
  const model = new TextDecoder().decode(file.subarray(0, 4)) === "MDLX" ? parseMDX(parsableModel(file).bytes.slice().buffer) : parseMDL(new TextDecoder().decode(file));
  const sequences = model.Sequences.map((sequence) => ({ name: sequence.Name, start: sequence.Interval[0] ?? 0, end: sequence.Interval[1] ?? 0, looping: !sequence.NonLooping, rarity: sequence.Rarity }));
  const death = sequences[selectSequence(sequences, "death")];
  return death === undefined || death.end <= death.start ? undefined : (death.end - death.start) / 1000;
}
