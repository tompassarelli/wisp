// The ruler fixture's models as MDL text, compiled to MDX with war3-model,
// the path Smashcraft's stage models take into the real game. Every surface
// is a flat, unshaded, unfogged, team-colored square, so a top-down
// screenshot shows each part as one solid patch of its player color.
import { generateMDX, parseMDL } from "../../vendor/war3-model.mjs";
import { BOARD, BOARD_EXTENT, CLIP, CLIP_SEQUENCES, CLOCK_DX, CLOCK_DY, GLOBAL_LENGTH, MARK, ORIGIN_DY, ORIGIN_HALF, RULER, RULER_SEQUENCES, type RulerSequence } from "./layout";

type Vector3 = readonly [number, number, number];

function mdlNumber(value: number): string {
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`${text} has no plain MDL form`);
  return text;
}
const vector = (values: readonly number[]) => `{ ${values.map(mdlNumber).join(", ")} }`;

interface Quad {
  readonly bone: number;
  readonly low: readonly [number, number];
  readonly high: readonly [number, number];
  readonly z: number;
}

/** A rectangle facing up, drawn from both sides. */
function geoset(quad: Quad, extent: string): string {
  const [x0, y0] = quad.low;
  const [x1, y1] = quad.high;
  const corners: Vector3[] = [[x0, y0, quad.z], [x1, y0, quad.z], [x1, y1, quad.z], [x0, y1, quad.z]];
  return `Geoset {
    Vertices 4 { ${corners.map((corner) => `${vector(corner)},`).join(" ")} }
    Normals 4 { ${corners.map(() => "{ 0, 0, 1 },").join(" ")} }
    TVertices 4 { ${corners.map(() => "{ 0.5, 0.5 },").join(" ")} }
    VertexGroup { 0, 0, 0, 0, }
    Faces 1 6 { Triangles { { 0, 1, 2, 0, 2, 3 }, } }
    Groups 1 1 { Matrices { ${quad.bone} }, }
    ${extent}
    MaterialID 0,
    SelectionGroup 0,
}`;
}

interface ModelText {
  readonly name: string;
  readonly quads: readonly Quad[];
  readonly sequences: readonly RulerSequence[];
  /** Bone 0's translation keys as frame, X and Y; bone 1 follows the global sequence when there is one, and bone 2 stays still. */
  readonly needle: readonly (readonly [frame: number, dx: number, dy: number])[];
  readonly globalLength?: number;
}

function mdl(model: ModelText): string {
  const points = model.quads.flatMap(({ low, high, z }) => [[low[0], low[1], z], [high[0], high[1], z]]);
  const xs = [...points.map(([x]) => x ?? 0), ...model.needle.map(([, dx]) => dx), ...(model.globalLength === undefined ? [] : [CLOCK_DX + model.globalLength / 2])];
  const ys = [...points.map(([, y]) => y ?? 0), ...model.needle.map(([, , dy]) => dy)];
  const [lowX, lowY, highX, highY] = [Math.min(...xs) - 10, Math.min(...ys) - 10, Math.max(...xs) + 10, Math.max(...ys) + 10];
  const low = [lowX, lowY, 0];
  const high = [highX, highY, 10];
  const radius = Math.ceil(Math.hypot(Math.max(-lowX, highX), Math.max(-lowY, highY), 10));
  const extent = `MinimumExtent ${vector(low)}, MaximumExtent ${vector(high)}, BoundsRadius ${radius},`;
  const bones = model.globalLength === undefined ? 1 : 3;
  const needle = model.needle.length === 0 ? "" : `Translation ${model.needle.length} {
        Linear,
        ${model.needle.map(([frame, dx, dy]) => `${frame}: ${vector([dx, dy, 0])},`).join("\n        ")}
    }`;
  const clock = model.globalLength === undefined ? "" : `Bone "Clock" { ObjectId 1, GeosetId Multiple, GeosetAnimId None,
    Translation 2 { Linear, GlobalSeqId 0, 0: { 0, 0, 0 }, ${model.globalLength}: ${vector([model.globalLength / 2, 0, 0])}, }
}
Bone "Origin" { ObjectId 2, GeosetId Multiple, GeosetAnimId None, }
`;
  return `Version { FormatVersion 800, }
Model "${model.name}" { NumGeosets ${model.quads.length}, NumBones ${bones}, BlendTime 150, ${extent} }
Sequences ${model.sequences.length} {
${model.sequences.map((sequence) => `    Anim "${sequence.name}" { Interval { ${sequence.start}, ${sequence.end} }, ${sequence.looping ? "" : "NonLooping, "}${extent} }`).join("\n")}
}
${model.globalLength === undefined ? "" : `GlobalSequences 1 { Duration ${model.globalLength}, }\n`}Textures 1 { Bitmap { Image "", ReplaceableId 1, } }
Materials 1 { Material { Layer { FilterMode None, Unshaded, Unfogged, TwoSided, static TextureID 0, static Alpha 1, } } }
${model.quads.map((quad) => geoset(quad, extent)).join("\n")}
Bone "Needle" { ObjectId 0, GeosetId Multiple, GeosetAnimId None,
    ${needle}
}
${clock}PivotPoints ${bones} { ${Array.from({ length: bones }, () => "{ 0, 0, 0 },").join(" ")} }
`;
}

const square = (bone: number, x: number, y: number, half: number, z: number): Quad => ({ bone, low: [x - half, y - half], high: [x + half, y + half], z });

/** Each sequence's needle keys at their model frames: its offsets along X, its lane along Y. */
function needleKeys(sequences: readonly RulerSequence[]): [number, number, number][] {
  return sequences.flatMap((sequence) => sequence.keys.map(([offset, dx]): [number, number, number] => [sequence.start + offset, dx, sequence.lane]));
}

function ruler(name: string, sequences: readonly RulerSequence[]): string {
  const quads = [square(0, 0, 0, 5, 6), square(1, CLOCK_DX, CLOCK_DY, 5, 6), square(2, 0, ORIGIN_DY, ORIGIN_HALF, 6)];
  return mdl({ name, quads, sequences, needle: needleKeys(sequences), globalLength: GLOBAL_LENGTH });
}

const STILL: readonly RulerSequence[] = [{ name: "Stand", start: 0, end: 1000, looping: true, lane: 0, keys: [] }];

/** Every model the fixture imports, by its path in the map, as MDL text. */
export const FIXTURE_MDL: Readonly<Record<string, string>> = {
  [RULER]: ruler("Wisp58Ruler", RULER_SEQUENCES),
  [CLIP]: ruler("Wisp58Clip", CLIP_SEQUENCES),
  [MARK]: mdl({ name: "Wisp58Mark", quads: [square(0, 0, 0, 6, 4)], sequences: STILL, needle: [] }),
  // Under every ruler of both columns, so the screenshot reads them against one dark color.
  [BOARD]: mdl({ name: "Wisp58Board", quads: [{ bone: 0, ...BOARD_EXTENT, z: 1 }], sequences: STILL, needle: [] }),
};

/** The compiled models, by their path in the map. */
export function fixtureModels(): Map<string, Uint8Array> {
  return new Map(Object.entries(FIXTURE_MDL).map(([path, text]) => [path, new Uint8Array(generateMDX(parseMDL(text)))]));
}
