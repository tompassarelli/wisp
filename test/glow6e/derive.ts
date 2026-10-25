import type { model } from "../../vendor/war3-model.mjs";
import type { RenderScene } from "../../host/render/renderScene";
import { camera } from "../../host/render/screen";
import { posedMesh, type BoundsModel } from "../../host/render/screenBounds";
import { BODY_ON, type Replica } from "./layout";
import { planesModel, type Plane } from "./models";

type Vector = readonly [number, number, number];

/** The posed glow geoset at one shot, as Wisp poses it: each plane's billboard pivot, its corners before and after billboarding, and the layer's opacity. */
export interface PosedGlow {
  readonly planes: readonly { readonly pivot: Vector; readonly rest: readonly Vector[]; readonly posed: readonly Vector[]; readonly uv: readonly (readonly [number, number])[]; readonly faces: readonly number[] }[];
  readonly floor: readonly { readonly posed: readonly Vector[]; readonly uv: readonly (readonly [number, number])[]; readonly faces: readonly number[] }[];
  readonly opacity: number;
}

const BILLBOARDED = 8;

const at = (array: ArrayLike<number>, vertex: number): Vector => [array[vertex * 3] ?? 0, array[vertex * 3 + 1] ?? 0, array[vertex * 3 + 2] ?? 0];

const through = (matrix: ArrayLike<number>, p: ArrayLike<number>): Vector =>
  [0, 1, 2].map((k) => (matrix[k] ?? 0) * (p[0] ?? 0) + (matrix[4 + k] ?? 0) * (p[1] ?? 0) + (matrix[8 + k] ?? 0) * (p[2] ?? 0) + (matrix[12 + k] ?? 0)) as unknown as Vector;

/** The triangles of the quad whose vertices start at `first`, renumbered from 0. */
function quadFaces(faces: ArrayLike<number>, first: number): number[] {
  const out: number[] = [];
  for (let f = 0; f + 2 < faces.length; f += 3) if ((faces[f] ?? -1) >= first && (faces[f] ?? -1) < first + 4) for (let k = 0; k < 3; k++) out.push((faces[f + k] ?? 0) - first);
  return out;
}

/** Splits the glow geoset `geoset` of `body` into its quads, posed at the scene's `BODY_ON` effect, with the four-vertex quads on billboarded bones kept apart from the static ones. */
export function posedGlow(body: BoundsModel, geoset: number, scene: RenderScene): PosedGlow {
  const pose = scene.effects.find((effect) => effect.model === BODY_ON && effect.y > -8000);
  if (pose === undefined) throw new Error("the scene doesn't show the glow-on body");
  const data: model.Model = body.data, source = data.Geosets[geoset];
  if (source === undefined) throw new Error(`the body has no geoset ${geoset}`);
  const { sampler, drawn } = posedMesh(pose, body, camera(scene, 1920 / 1080));
  const mesh = drawn.find((entry) => entry.geoset === geoset);
  if (mesh === undefined) throw new Error(`Wisp doesn't draw geoset ${geoset} at this pose`);
  const nodes = [...data.Bones, ...data.Helpers], uv = source.TVertices[0] ?? [];
  const planes: PosedGlow["planes"][number][] = [], floor: PosedGlow["floor"][number][] = [];
  for (let first = 0; first < source.Vertices.length / 3; first += 4) {
    const vertices = [0, 1, 2, 3].map((k) => first + k);
    const quad = { posed: vertices.map((v) => at(mesh.positions, v)), uv: vertices.map((v) => [uv[v * 2] ?? 0, uv[v * 2 + 1] ?? 0] as const), faces: quadFaces(source.Faces, first) };
    const id = (source.Groups[source.VertexGroup[first] ?? 0] ?? [])[0] ?? -1;
    const node = nodes.find((entry) => entry.ObjectId === id);
    if (node === undefined || (node.Flags & BILLBOARDED) === 0) { floor.push(quad); continue; }
    const p = node.PivotPoint ?? new Float32Array(3), pivot = through(sampler.rendererData.nodes[id]?.matrix ?? new Float32Array(16), p);
    planes.push({ ...quad, pivot, rest: vertices.map((v) => at(source.Vertices, v).map((value, k) => value - (p[k] ?? 0) + (pivot[k] ?? 0)) as unknown as Vector) });
  }
  const layer = data.Materials[source.MaterialID]?.Layers[0];
  const own = layer === undefined || typeof layer.Alpha === "number" ? (layer?.Alpha ?? 1) : sampler.interp.animVectorVal(layer.Alpha, 1);
  return { planes, floor, opacity: (sampler.rendererData.geosetAlpha[geoset] ?? 1) * Number(own) };
}

/** Our own replica of the posed glow: its billboarded planes, the same planes frozen where Wisp turns them, or the billboarded planes and the static quads. */
export function replicaMdl(glow: PosedGlow, replica: Replica, frame: number): string {
  const billboarded: Plane[] = glow.planes.map((plane) => ({ pivot: plane.pivot, corners: plane.rest, uv: plane.uv, faces: plane.faces }));
  const frozen: Plane[] = glow.planes.map((plane) => ({ corners: plane.posed, uv: plane.uv, faces: plane.faces }));
  const statics: Plane[] = glow.floor.map((quad) => ({ corners: quad.posed, uv: quad.uv, faces: quad.faces }));
  const planes = replica === "planes" ? billboarded : replica === "flat" ? frozen : [...billboarded, ...statics];
  return planesModel(`Wisp6E-${replica}-${frame}`, planes, { texture: `Image "", ReplaceableId 2`, filter: "Additive", flags: ["Unshaded"], alpha: Number(glow.opacity.toFixed(6)) });
}
