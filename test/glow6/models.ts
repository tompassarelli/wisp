import { generateMDX, parseMDL } from "../../vendor/war3-model.mjs";
import { BLACK_TEXTURE, BOARD, BOARD_HALF, BOARD_Z, GLOW, QUAD_CORNERS, TWIN, TWIN_TEXTURE } from "./layout";

type Corner = readonly [x: number, y: number, z: number, u: number, v: number];

const vector = (values: readonly number[]) => `{ ${values.join(", ")} }`;

/** One flat quad through `corners`, drawn with one two-sided, unshaded, unfogged layer of `filter` over `texture`. */
function quadModel(name: string, corners: readonly Corner[], texture: string, filter: "Additive" | "None"): string {
  const xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y), zs = corners.map(([, , z]) => z);
  const low = [Math.min(...xs), Math.min(...ys), Math.min(...zs)], high = [Math.max(...xs), Math.max(...ys), Math.max(...zs)];
  const extent = `MinimumExtent ${vector(low)}, MaximumExtent ${vector(high)}, BoundsRadius ${Math.ceil(Math.max(...corners.map(([x, y, z]) => Math.hypot(x, y, z))))},`;
  const normal = (() => {
    const [a, b, c] = corners;
    if (a === undefined || b === undefined || c === undefined) throw new Error("a quad needs four corners");
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], f = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [(e[1] ?? 0) * (f[2] ?? 0) - (e[2] ?? 0) * (f[1] ?? 0), (e[2] ?? 0) * (f[0] ?? 0) - (e[0] ?? 0) * (f[2] ?? 0), (e[0] ?? 0) * (f[1] ?? 0) - (e[1] ?? 0) * (f[0] ?? 0)];
    const length = Math.hypot(...n);
    return n.map((value) => value / length);
  })();
  return `Version { FormatVersion 800, }
Model "${name}" { NumGeosets 1, NumBones 1, BlendTime 150, ${extent} }
Sequences 1 {
    Anim "Stand" { Interval { 0, 1000 }, ${extent} }
}
Textures 1 { Bitmap { ${texture}, } }
Materials 1 { Material { Layer { FilterMode ${filter}, Unshaded, Unfogged, TwoSided, static TextureID 0, static Alpha 1, } } }
Geoset {
    Vertices 4 { ${corners.map(([x, y, z]) => `${vector([x, y, z])},`).join(" ")} }
    Normals 4 { ${corners.map(() => `${vector(normal)},`).join(" ")} }
    TVertices 4 { ${corners.map(([, , , u, v]) => `${vector([u, v])},`).join(" ")} }
    VertexGroup { 0, 0, 0, 0, }
    Faces 1 6 { Triangles { { 0, 1, 2, 0, 2, 3 }, } }
    Groups 1 1 { Matrices { 0 }, }
    ${extent}
    MaterialID 0,
    SelectionGroup 0,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
PivotPoints 1 { { 0, 0, 0 }, }
`;
}

const BOARD_CORNERS: readonly Corner[] = ([[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]] as const).map(([sx, sy, u, v]) => [sx * BOARD_HALF, sy * BOARD_HALF, BOARD_Z, u, v] as const);

export const FIXTURE_MDL: Readonly<Record<string, string>> = {
  [GLOW]: quadModel("Wisp6Glow", QUAD_CORNERS, `Image "", ReplaceableId 2`, "Additive"),
  [TWIN]: quadModel("Wisp6Twin", QUAD_CORNERS, `Image "${TWIN_TEXTURE}"`, "Additive"),
  [BOARD]: quadModel("Wisp6Board", BOARD_CORNERS, `Image "${BLACK_TEXTURE}"`, "None"),
};

export function fixtureModels(): Map<string, Uint8Array> {
  return new Map(Object.entries(FIXTURE_MDL).map(([path, text]) => [path, new Uint8Array(generateMDX(parseMDL(text)))]));
}
