import { generateMDX, parseMDL, type model } from "../../vendor/war3-model.mjs";
import { BLACK_TEXTURE, FLOOR, FLOOR_HALF, FLOOR_Z, TWIN, TWIN_HALF, TWIN_TEXTURE, WALL, WALL_HALF, WALL_TOP, WALL_Y } from "./layout";

type Vector = readonly [number, number, number];
export interface Quad { readonly corners: readonly Vector[]; readonly uv: readonly (readonly [number, number])[]; readonly faces: readonly number[] }
/** A quad hung on a billboarded bone at `pivot`, or on the static root when `pivot` is undefined. */
export interface Plane extends Quad { readonly pivot?: Vector }

const vector = (values: readonly number[]) => `{ ${values.join(", ")} }`;

export interface Layer { readonly texture: string; readonly filter: "Additive" | "None"; readonly flags: readonly string[]; readonly alpha: number }

/** One geoset of `planes` under one layer: a root bone holds the static quads, and each billboarded quad gets its own bone at its pivot. */
export function planesModel(name: string, planes: readonly Plane[], layer: Layer): string {
  const billboarded = planes.filter((plane) => plane.pivot !== undefined);
  const boneOf = (plane: Plane) => plane.pivot === undefined ? 0 : 1 + billboarded.indexOf(plane);
  const corners = planes.flatMap((plane) => plane.corners);
  const low = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k] ?? 0))), high = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k] ?? 0)));
  const extent = `MinimumExtent ${vector(low.map((v) => v - 60))}, MaximumExtent ${vector(high.map((v) => v + 60))}, BoundsRadius ${Math.ceil(Math.max(...corners.map(([x, y, z]) => Math.hypot(x, y, z))) + 60)},`;
  const faces = planes.flatMap((plane, index) => plane.faces.map((face) => face + index * 4));
  const groups = [0, ...billboarded.map((_, index) => index + 1)];
  return `Version { FormatVersion 800, }
Model "${name}" { NumGeosets 1, NumBones ${groups.length}, BlendTime 0, ${extent} }
Sequences 1 {
    Anim "Stand" { Interval { 0, 1000 }, ${extent} }
}
Textures 1 { Bitmap { ${layer.texture}, } }
Materials 1 { Material { Layer { FilterMode ${layer.filter}, ${layer.flags.map((flag) => `${flag}, `).join("")}static TextureID 0, static Alpha ${layer.alpha}, } } }
Geoset {
    Vertices ${corners.length} { ${corners.map((c) => `${vector(c)},`).join(" ")} }
    Normals ${corners.length} { ${corners.map(() => `${vector([1, 0, 0])},`).join(" ")} }
    TVertices ${corners.length} { ${planes.flatMap((plane) => plane.uv).map((uv) => `${vector(uv)},`).join(" ")} }
    VertexGroup { ${planes.flatMap((plane) => plane.corners.map(() => `${groups.indexOf(boneOf(plane))},`)).join(" ")} }
    Faces 1 ${faces.length} { Triangles { { ${faces.join(", ")} }, } }
    Groups ${groups.length} ${groups.length} { ${groups.map((id) => `Matrices { ${id} },`).join(" ")} }
    ${extent}
    MaterialID 0,
    SelectionGroup 0,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
${billboarded.map((_, index) => `Bone "Plane${index + 1}" { ObjectId ${index + 1}, Billboarded, GeosetId 0, GeosetAnimId None, }`).join("\n")}
PivotPoints ${groups.length} { ${vector([0, 0, 0])}, ${billboarded.map((plane) => `${vector(plane.pivot ?? [0, 0, 0])},`).join(" ")} }
`;
}

const square: Quad["uv"] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Our own twin: a billboarded square in the plane the camera faces once billboarded, two-sided, with our radial texture. */
const twin: Plane = { pivot: [0, 0, 0], corners: [[0, -TWIN_HALF, TWIN_HALF], [0, TWIN_HALF, TWIN_HALF], [0, TWIN_HALF, -TWIN_HALF], [0, -TWIN_HALF, -TWIN_HALF]], uv: square, faces: [0, 1, 2, 0, 2, 3] };
const floor: Plane = { corners: [[-FLOOR_HALF, -FLOOR_HALF, FLOOR_Z], [FLOOR_HALF, -FLOOR_HALF, FLOOR_Z], [FLOOR_HALF, FLOOR_HALF, FLOOR_Z], [-FLOOR_HALF, FLOOR_HALF, FLOOR_Z]], uv: square, faces: [0, 1, 2, 0, 2, 3] };
const wall: Plane = { corners: [[-WALL_HALF, WALL_Y, 0], [WALL_HALF, WALL_Y, 0], [WALL_HALF, WALL_Y, WALL_TOP], [-WALL_HALF, WALL_Y, WALL_TOP]], uv: square, faces: [0, 1, 2, 0, 2, 3] };
const black: Layer = { texture: `Image "${BLACK_TEXTURE}"`, filter: "None", flags: ["Unshaded", "Unfogged", "TwoSided"], alpha: 1 };

export const FIXED_MDL: Readonly<Record<string, string>> = {
  [TWIN]: planesModel("Wisp6ETwin", [twin], { texture: `Image "${TWIN_TEXTURE}"`, filter: "Additive", flags: ["Unshaded", "Unfogged", "TwoSided"], alpha: 1 }),
  [FLOOR]: planesModel("Wisp6EFloor", [floor], black),
  [WALL]: planesModel("Wisp6EWall", [wall], black),
};

export const encodeMdl = (text: string): Uint8Array => new Uint8Array(generateMDX(parseMDL(text)));

/** Copies `geoset` of `source` onto `body`, keeping its material index and node ids, which the glow-free body keeps unchanged. */
export function graft(body: model.Model, source: model.Model, geoset: number): model.Model {
  const added = source.Geosets[geoset];
  if (added === undefined) throw new Error(`the source has no geoset ${geoset}`);
  return { ...body, Geosets: [...body.Geosets, added] };
}

