import { expect, test } from "bun:test";
import { generateMDX, parseMDL } from "../vendor/war3-model.mjs";
import { type ModelFacts, drawsNothing, hiddenEmitters, modelFacts, modelReach } from "../scripts/wisp/models";
import { type SceneExpectations, type SceneReport, sceneProblems } from "../scripts/wisp/scene";
import { type CameraView, boxSeen } from "../scripts/wisp/visibility";

const geoset = `Geoset {
  Vertices 3 { { 0, 0, 0 }, { 10, 0, 0 }, { 0, 10, 20 }, }
  Normals 3 { { 0, 0, 1 }, { 0, 0, 1 }, { 0, 0, 1 }, }
  TVertices 3 { { 0, 0 }, { 1, 0 }, { 0, 1 }, }
  VertexGroup { 0, 0, 0, }
  Faces 1 3 { Triangles { { 0, 1, 2 }, } }
  Groups 1 1 { Matrices { 0 }, }
  MinimumExtent { 0, 0, 0 }, MaximumExtent { 10, 10, 20 }, BoundsRadius 12,
  MaterialID 0,
  SelectionGroup 0,
}`;

const emitter = (name: string, id: number, visibility: string, speed: number, gravity: number, rate: number, lifespan: number) => `ParticleEmitter2 "${name}" {
  ObjectId ${id},
  Parent 0,
  static Speed ${speed},
  static Variation 0,
  static Latitude 0,
  static Gravity ${gravity},
  Visibility ${visibility.split(",").length} { DontInterp, ${visibility}, }
  static EmissionRate ${rate},
  static Width 0,
  static Length 0,
  Blend,
  Rows 1,
  Columns 1,
  Head,
  TailLength 0,
  Time 0.5,
  SegmentColor { Color { 1, 1, 1 }, Color { 1, 1, 1 }, Color { 1, 1, 1 }, },
  Alpha { 255, 255, 0 },
  ParticleScaling { 10, 20, 30 },
  LifeSpanUVAnim { 0, 0, 1 },
  DecayUVAnim { 0, 0, 1 },
  TailUVAnim { 0, 0, 1 },
  TailDecayUVAnim { 0, 0, 1 },
  TextureID 0,
  LifeSpan ${lifespan},
}`;

const missile = (burst = { speed: 400, gravity: 900, lifespan: 0.75 }) => new Uint8Array(generateMDX(parseMDL(`Version { FormatVersion 800, }
Model "Missile" { NumGeosets 1, NumBones 1, BlendTime 150, MinimumExtent { 0, 0, 0 }, MaximumExtent { 10, 10, 20 }, BoundsRadius 12, }
Sequences 2 {
  Anim "Stand" { Interval { 0, 1000 }, MinimumExtent { 0, 0, 0 }, MaximumExtent { 10, 10, 20 }, BoundsRadius 12, }
  Anim "Death" { Interval { 2000, 3000 }, NonLooping, MinimumExtent { 0, 0, 0 }, MaximumExtent { 10, 10, 20 }, BoundsRadius 12, }
}
Textures 1 { Bitmap { Image "Textures\\\\Smoke.blp", } }
Materials 1 { Material { Layer { FilterMode None, static TextureID 0, static Alpha 1, } } }
${geoset}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
${emitter("Smoke", 1, "2000: 0", 0, 0, 30, 0.5)}
${emitter("Burst", 2, "0: 0, 2000: 1, 2500: 0", burst.speed, burst.gravity, 140, burst.lifespan)}
PivotPoints 3 { { 0, 0, 0 }, { 0, 0, 10 }, { 0, 0, 10 }, }
`)));

const empty = () => new Uint8Array(generateMDX(parseMDL(`Version { FormatVersion 800, }
Model "Empty" { NumBones 1, BlendTime 150, MinimumExtent { 0, 0, 0 }, MaximumExtent { 0, 0, 0 }, BoundsRadius 0, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, MinimumExtent { 0, 0, 0 }, MaximumExtent { 0, 0, 0 }, BoundsRadius 0, } }
Bone "Root" { ObjectId 0, GeosetId None, GeosetAnimId None, }
PivotPoints 1 { { 0, 0, 0 }, }
`)));

/** `bytes` with a light chunk appended whose one record is longer than war3-model reads, as version 1800 writes them. */
function withLight(bytes: Uint8Array): Uint8Array {
  const record = 4 + 96 + 44 + 24;
  const chunk = new Uint8Array(8 + record);
  const view = new DataView(chunk.buffer);
  chunk.set(new TextEncoder().encode("LITE"));
  view.setUint32(4, record, true);
  view.setUint32(8, record, true);
  const joined = new Uint8Array(bytes.length + chunk.length);
  joined.set(bytes);
  joined.set(chunk, bytes.length);
  return joined;
}

test("a model's facts: its mesh, lights, and each emitter's running, burst and reach", () => {
  const facts = modelFacts(withLight(missile()));
  expect({ ...facts, emitters: facts.emitters.map(({ reach: _, ...emitter }) => emitter) }).toEqual({
    geosets: 1,
    triangles: 1,
    lights: 1,
    bounds: { min: [0, 0, 0], max: [10, 10, 20] },
    emitters: [
      { kind: "particle", name: "Smoke", whileShown: true, onDeath: false, visible: true, rate: 30, lifespan: 0.5 },
      { kind: "particle", name: "Burst", whileShown: false, onDeath: true, visible: true, rate: 140, lifespan: 0.75 },
    ],
  });

  expect(facts.emitters[0]?.reach).toEqual([{ min: [-30, -30, -20], max: [30, 30, 40] }]);

  const burst = facts.emitters[1]?.reach ?? [];
  expect(burst.length).toBe(8);
  expect(burst[0]?.max[2]).toBeCloseTo(10 + 400 * 400 / 1800 + 30, 3);
  expect(burst[7]?.max[2]).toBeCloseTo(10 + 400 * 400 / 1800 - 900 * 262.5 * 262.5 / (2 * 400 * 400) + 30, 3);
  expect(burst[7]?.max[0]).toBe(300 + 30);
  expect(Math.min(...burst.map(({ min }) => min[2]))).toBeCloseTo(10 - 400 * 0.75 - 0.5 * 900 * 0.75 * 0.75 - 30, 3);
  expect(hiddenEmitters(facts).map(({ name }) => name)).toEqual(["Smoke"]);
  expect(modelReach(facts).unknown).toEqual([]);
  expect(drawsNothing(facts)).toBe(false);
  expect(drawsNothing(modelFacts(empty()))).toBe(true);
  expect(() => modelFacts(new Uint8Array(8))).toThrow("not an MDX model");
});

const camera: CameraView = { target: [0, 0, 160], distance: 1450, angleOfAttack: 350, rotation: 90, fieldOfView: 70, aspect: 16 / 9, farZ: 8000 };
const at = (x: number, y: number, z: number) => ({ min: [x, y, z] as const, max: [x, y, z] as const });

test("a camera's frame contains its target and nothing behind it, below its lowest ray or past its far plane", () => {
  expect(boxSeen(at(0, 0, 160), camera)).toBe(true);
  expect(boxSeen(at(0, -3000, 160), camera)).toBe(false);

  expect(boxSeen(at(0, 0, -400), camera)).toBe(true);
  expect(boxSeen(at(0, 0, -520), camera)).toBe(false);
  expect(boxSeen(at(0, 9000, 160), camera)).toBe(false);
  expect(boxSeen({ min: [0, 0, -1800], max: [0, 0, -400] }, camera)).toBe(true);
});

const expectations = (models: Record<string, ModelFacts>, parking: readonly (readonly [number, number, number])[]): SceneExpectations => ({
  kinds: [
    { name: "stage deck", models: ["war3mapImported\\Deck.mdx"] },
    { name: "missile", models: ["Abilities\\Missile.mdx"], lifetime: 240 },
  ],
  stage: { kind: "stage deck", pieces: 1 },
  framesPerSecond: 60,
  visibility: { models, cameras: [camera], parking },
});

const report = (missiles: { readonly live: number; readonly inView: number; readonly drawn: number; readonly destroyed: number }): SceneReport => ({
  serial: 1,
  frame: 30,
  effects: 1 + missiles.live,
  models: [
    { model: "Abilities/Missile.mdx", created: 0, age: missiles.inView > 0 ? 30 : undefined, longest: missiles.inView > 0 ? 30 : 0, ...missiles },
    { model: "war3mapImported/Deck.mdx", live: 1, inView: 1, drawn: 1, created: 0, age: 30, longest: 30, destroyed: 0 },
  ],
});

test("the scene check flags a hidden effect a player still sees and a named model that draws nothing", () => {
  const models = { "war3mapImported\\Deck.mdx": modelFacts(missile()), "Abilities\\Missile.mdx": modelFacts(missile()) };
  const parkedDeep = expectations(models, [[0, 0, -1800]]);
  const seen = (scene: SceneReport, expected: SceneExpectations) => sceneProblems(scene, expected).map(({ seen }) => seen);

  expect(sceneProblems(report({ live: 16, inView: 16, drawn: 0, destroyed: 0 }), parkedDeep)).toEqual([{
    seen: "16 hidden missiles in view still show particles",
    evidence: "model Abilities/Missile.mdx: 16 in view, 0 drawn; Smoke emits 30/s, each for 0.5 s",
  }]);
  expect(seen(report({ live: 16, inView: 0, drawn: 0, destroyed: 0 }), parkedDeep)).toEqual([]);
  expect(seen(report({ live: 16, inView: 0, drawn: 0, destroyed: 0 }), expectations(models, [[0, 0, -300]]))).toEqual([
    "16 parked missiles can be seen where the game parks them",
  ]);

  const spray = { ...models, "Abilities\\Missile.mdx": modelFacts(missile({ speed: 700, gravity: 972, lifespan: 3 })) };
  expect(seen(report({ live: 16, inView: 0, drawn: 0, destroyed: 0 }), expectations(spray, [[0, 0, -1800]]))).toEqual([]);
  expect(seen(report({ live: 0, inView: 0, drawn: 0, destroyed: 2 }), parkedDeep)).toEqual(["2 missiles destroyed in view burst particles as they go"]);
  const emptyDeck = { ...parkedDeep, kinds: [{ name: "stage deck", models: [""] }, ...parkedDeep.kinds.slice(1)] };
  expect(seen(report({ live: 1, inView: 0, drawn: 0, destroyed: 0 }), emptyDeck)).toContain("nothing where a stage deck should be: the game names no model for it");
  const unknownDeck = expectations({ "Abilities\\Missile.mdx": modelFacts(missile()) }, [[0, 0, -1800]]);
  expect(seen(report({ live: 1, inView: 0, drawn: 0, destroyed: 0 }), unknownDeck)).toEqual(["what a stage deck draws is unknown"]);
  const bareDeck = expectations({ ...models, "war3mapImported\\Deck.mdx": modelFacts(empty()) }, [[0, 0, -1800]]);
  expect(seen(report({ live: 1, inView: 0, drawn: 0, destroyed: 0 }), bareDeck)).toEqual(["nothing where a stage deck should be: its model has no triangles, particles or light"]);
});
