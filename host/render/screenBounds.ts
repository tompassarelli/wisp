import { ModelRenderer, decodeBLP, getBLPImageData, type model } from "../../vendor/war3-model.mjs";
import { type AnimationSequence, animationSample, blendWeight, globalSequenceFrame } from "../../src/headless/animation";
import { drawnPoses } from "./culling";
import type { DrawnPose, RenderScene } from "./headlessRender";
import { multiply } from "../browser/matrix";
import { decodePngRgba } from "../fidelity/image";
import { camera, type PixelRect, poseNodes, type Sampler, show, transform } from "./screen";

/** A parsed model with the renderer state that poses it, without GL. */
export interface BoundsModel {
  readonly data: model.Model;
  readonly renderer: ModelRenderer;
  readonly sequences: readonly AnimationSequence[];
}

export function boundsModel(data: model.Model): BoundsModel {
  const sequences = data.Sequences.map((sequence) => ({ name: sequence.Name, start: sequence.Interval[0] ?? 0, end: sequence.Interval[1] ?? 0, looping: !sequence.NonLooping, rarity: sequence.Rarity }));
  return { data, renderer: new ModelRenderer(data), sequences };
}

/** Pixels, origin at the top left, y down. */
export interface PixelBox { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }

interface GeosetBounds {
  readonly index: number;
  readonly alpha: number;
  /** The first material layer's filter mode (war3-model's FilterMode: 0 None, 1 Transparent, 2 Blend, 3 Additive, ...). */
  readonly filterMode: number;
  readonly drawn: boolean;
}

interface NodeBounds {
  readonly id: number;
  readonly name: string;
  /** Box of the drawn vertices this node weights most; undefined when it weights none in front of the eye. */
  readonly box: PixelBox | undefined;
  readonly pivot: { readonly x: number; readonly y: number; readonly behindEye: boolean };
}

export interface ModelBounds {
  readonly handle: number;
  readonly model: string;
  readonly unit: boolean;
  /** Box of every drawn vertex between the near and far planes; undefined when none is. */
  readonly box: PixelBox | undefined;
  readonly offFrame: boolean;
  readonly behindEye: boolean;
  readonly farCulled: boolean;
  readonly geosets: readonly GeosetBounds[];
  readonly nodes: readonly NodeBounds[];
  /** How drawn team-glow geosets were bounded: by the install's team-glow texture, or by the disc rule without it. */
  readonly teamGlow?: "texture" | "disc";
  /** Box of the drawn pixels of every geoset with an opaque (filter mode None) layer; absent when none draws. */
  readonly body?: PixelBox;
}

/** RGBA texels, 4 bytes each, rows from the image's top. */
export interface Texels { readonly width: number; readonly height: number; readonly data: ArrayLike<number> }

/** Textures the bounds sample, read from the install the caller points to: a model texture by path, and the team glow (ReplaceableId 2) by team colour index. */
export interface BoundsTextures {
  readonly image: (path: string) => Texels | undefined;
  readonly teamGlow: (team: number) => Texels | undefined;
}

export const teamGlowPath = (team: number) => `ReplaceableTextures\\TeamGlow\\TeamGlow${String(team).padStart(2, "0")}.blp`;

/** A PNG or BLP texture's top mip level; undefined for other formats. */
export function texels(bytes: Uint8Array): Texels | undefined {
  if (bytes[0] === 137 && bytes[1] === 80) { const { width, height, rgba } = decodePngRgba(bytes); return { width, height, data: rgba }; }
  if (bytes[0] !== 66 || bytes[1] !== 76) return undefined;
  const image = getBLPImageData(decodeBLP(bytes.slice().buffer), 0);
  return { width: image.width, height: image.height, data: image.data };
}

const GEOSET_HIDDEN = 1e-6;

/**
 * Posed screen bounds of every effect and unit in `scene.effects` (pass the scene through `sceneWithUnits` first)
 * at a `width` x `height` canvas. Poses the renderer culls for alpha, scale, flatness or the world bounds are left
 * out; poses beyond the far distance are reported with `farCulled`.
 */
export function sceneBounds(scene: RenderScene, models: (path: string) => BoundsModel | undefined, width: number, height: number, textures?: BoundsTextures): ModelBounds[] {
  const view = camera(scene, width / height);
  const kept = new Set(drawnPoses(scene.effects, view.eye, view.far, scene.world));
  const rows: ModelBounds[] = [];
  for (const pose of drawnPoses(scene.effects, view.eye, Infinity, scene.world)) {
    const found = models(pose.model);
    if (found !== undefined) rows.push(poseBounds(pose, found, view, width, height, !kept.has(pose), textures));
  }
  return rows;
}

interface PosedMesh {
  readonly sampler: Sampler & { rendererData: { geosetAlpha: number[] } };
  readonly geosets: readonly GeosetBounds[];
  /** Per drawn geoset: its index, skinned model-space positions, each vertex's most-weighted node (or -1), and its triangles. */
  readonly drawn: readonly { readonly geoset: number; readonly positions: Float64Array; readonly main: Int32Array; readonly faces: ArrayLike<number> }[];
}

/** Without the install's team-glow texture: the renderer's team glow (ReplaceableId 2) is black from this distance to the texture's centre, in texture coordinates. */
const GLOW_RADIUS = 1 / 2.8;
const ADDITIVE = new Set([3, 4]);
const GLOW_SAMPLES = 256;

/** Every layer adds the team glow, so the geoset draws nothing outside the glow's disc. */
function glowOnly(data: model.Model, materialId: number): boolean {
  const layers = data.Materials[materialId]?.Layers ?? [];
  return layers.length > 0 && layers.every((layer) => ADDITIVE.has(Number(layer.FilterMode ?? 0)) && typeof layer.TextureID === "number" && data.Textures[layer.TextureID]?.ReplaceableId === 2);
}

/** Some layer is opaque (filter mode None), so the geoset counts toward the body; see-through geosets don't. */
function opaque(data: model.Model, materialId: number): boolean {
  return (data.Materials[materialId]?.Layers ?? []).some((layer) => Number(layer.FilterMode ?? 0) === 0);
}

/**
 * Points bounding the part of each triangle inside the glow's disc: corners inside it, edge crossings and the disc's
 * edge where it lies inside the triangle. The part is convex, so these hold its box under any projection in front of the eye.
 */
function glowPoints(positions: Float64Array, mains: Int32Array, uv: ArrayLike<number>, faces: ArrayLike<number>): { positions: Float64Array; main: Int32Array } {
  const out: number[] = [], nodes: number[] = [], r2 = GLOW_RADIUS * GLOW_RADIUS;
  const at = (v: number, k: number) => positions[v * 3 + k] ?? 0, u = (v: number) => (uv[v * 2] ?? 0) - 0.5, w = (v: number) => (uv[v * 2 + 1] ?? 0) - 0.5;
  const push = (a: number, b: number, c: number, la: number, lb: number, lc: number) => {
    for (let k = 0; k < 3; k++) out.push(at(a, k) * la + at(b, k) * lb + at(c, k) * lc);
    nodes.push(mains[la >= lb && la >= lc ? a : lb >= lc ? b : c] ?? -1);
  };
  for (let face = 0; face + 2 < faces.length; face += 3) {
    const a = faces[face] ?? 0, b = faces[face + 1] ?? 0, c = faces[face + 2] ?? 0;
    const corners = [a, b, c] as const;
    for (let i = 0; i < 3; i++) {
      const p = corners[i] ?? 0, q = corners[(i + 1) % 3] ?? 0, weights = [0, 0, 0];
      if (u(p) * u(p) + w(p) * w(p) <= r2) { weights[i] = 1; push(a, b, c, weights[0] ?? 0, weights[1] ?? 0, weights[2] ?? 0); }
      const du = u(q) - u(p), dw = w(q) - w(p), qa = du * du + dw * dw, qb = 2 * (u(p) * du + w(p) * dw), qc = u(p) * u(p) + w(p) * w(p) - r2;
      const disc = qb * qb - 4 * qa * qc;
      if (qa === 0 || disc < 0) continue;
      for (const t of [(-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa)]) {
        if (t < 0 || t > 1) continue;
        const edge = [0, 0, 0]; edge[i] = 1 - t; edge[(i + 1) % 3] = t;
        push(a, b, c, edge[0] ?? 0, edge[1] ?? 0, edge[2] ?? 0);
      }
    }
    const det = (u(b) - u(a)) * (w(c) - w(a)) - (u(c) - u(a)) * (w(b) - w(a));
    if (det === 0) continue;
    for (let sample = 0; sample < GLOW_SAMPLES; sample++) {
      const angle = sample * 2 * Math.PI / GLOW_SAMPLES, x = GLOW_RADIUS * Math.cos(angle) - u(a), y = GLOW_RADIUS * Math.sin(angle) - w(a);
      const lb = (x * (w(c) - w(a)) - y * (u(c) - u(a))) / det, lc = (y * (u(b) - u(a)) - x * (w(b) - w(a))) / det, la = 1 - lb - lc;
      if (la >= 0 && lb >= 0 && lc >= 0) push(a, b, c, la, lb, lc);
    }
  }
  return { positions: Float64Array.from(out), main: Int32Array.from(nodes) };
}

export function posedSampler(pose: DrawnPose, found: BoundsModel): PosedMesh["sampler"] {
  const { data, renderer } = found, sampler = renderer as unknown as PosedMesh["sampler"];
  const kind = pose.unit === true ? "unit" : "effect";
  const sample = animationSample(found.sequences, { animation: pose.animation, subAnimations: pose.subAnimations, elapsed: pose.animationElapsed }, kind);
  show(sampler, data, sample);
  data.GlobalSequences.forEach((length, index) => { sampler.rendererData.globalSequencesFrames[index] = globalSequenceFrame(pose.animationClock, length); });
  const blend = pose.animationBlend, weight = blendWeight(pose);
  const saved = blend === undefined ? undefined : animationSample(found.sequences, blend.from, kind);
  renderer.update(0);
  if (saved !== undefined && weight > 0) poseNodes(sampler, data, saved, weight);
  return sampler;
}

/** Poses and skins a model on the CPU, as drawEffect in browser/headlessRender.ts poses it. */
export function posedMesh(pose: DrawnPose, found: BoundsModel, view: ReturnType<typeof camera>): PosedMesh {
  const { data } = found;
  found.renderer.setCamera(new Float32Array(view.eye), view.quaternion);
  const sampler = posedSampler(pose, found);
  const nodes = sampler.rendererData.nodes;
  const geosets: GeosetBounds[] = [], drawnMeshes: PosedMesh["drawn"][number][] = [];
  data.Geosets.forEach((geoset, index) => {
    const alpha = sampler.rendererData.geosetAlpha[index] ?? 1;
    const drawn = alpha >= GEOSET_HIDDEN && (geoset.LevelOfDetail === undefined || geoset.LevelOfDetail === 0);
    geosets.push({ index, alpha, filterMode: Number(data.Materials[geoset.MaterialID]?.Layers[0]?.FilterMode ?? 0), drawn });
    if (!drawn) return;
    const source = geoset.Vertices, skin = geoset.SkinWeights !== undefined && geoset.SkinWeights.length > 0 ? geoset.SkinWeights : undefined;
    const count = source.length / 3, positions = new Float64Array(count * 3), mains = new Int32Array(count);
    for (let vertex = 0; vertex < count; vertex++) {
      const vx = source[vertex * 3] ?? 0, vy = source[vertex * 3 + 1] ?? 0, vz = source[vertex * 3 + 2] ?? 0;
      let x = 0, y = 0, z = 0, main = -1, most = -1;
      if (skin !== undefined) {
        // HD skin weights, as the HD shaders and software skinning weigh them.
        for (let j = 0; j < 4; j++) {
          const w = (skin[vertex * 8 + 4 + j] ?? 0) / 255, id = skin[vertex * 8 + j] ?? 0, n = nodes[id]?.matrix;
          if (w === 0 || n === undefined) continue;
          x += ((n[0] ?? 0) * vx + (n[4] ?? 0) * vy + (n[8] ?? 0) * vz + (n[12] ?? 0)) * w;
          y += ((n[1] ?? 0) * vx + (n[5] ?? 0) * vy + (n[9] ?? 0) * vz + (n[13] ?? 0)) * w;
          z += ((n[2] ?? 0) * vx + (n[6] ?? 0) * vy + (n[10] ?? 0) * vz + (n[14] ?? 0)) * w;
          if (w > most) { most = w; main = id; }
        }
      } else {
        // Classic vertex groups: the mean of the group's first four node matrices, as the Classic hardware-skinning shader takes them.
        const group = geoset.Groups[geoset.VertexGroup[vertex] ?? 0] ?? [];
        const used = Math.min(4, group.length);
        for (let j = 0; j < used; j++) {
          const n = nodes[group[j] ?? 0]?.matrix;
          if (n === undefined) continue;
          x += (n[0] ?? 0) * vx + (n[4] ?? 0) * vy + (n[8] ?? 0) * vz + (n[12] ?? 0);
          y += (n[1] ?? 0) * vx + (n[5] ?? 0) * vy + (n[9] ?? 0) * vz + (n[13] ?? 0);
          z += (n[2] ?? 0) * vx + (n[6] ?? 0) * vy + (n[10] ?? 0) * vz + (n[14] ?? 0);
        }
        if (used > 0) { x /= used; y /= used; z /= used; main = group[0] ?? -1; }
      }
      positions[vertex * 3] = x; positions[vertex * 3 + 1] = y; positions[vertex * 3 + 2] = z; mains[vertex] = main;
    }
    drawnMeshes.push({ geoset: index, positions, main: mains, faces: geoset.Faces });
  });
  return { sampler, geosets, drawn: drawnMeshes };
}

/** A layer whose texels decide where it draws: its filter mode, opacity, texture, texture coordinates and whether it draws back faces. */
interface TexelLayer { readonly filter: number; readonly opacity: number; readonly texture: Texels; readonly wrapU: boolean; readonly wrapV: boolean; readonly uv: ArrayLike<number>; readonly twoSided: boolean }

/** The layer shading flag that draws back faces; the renderer culls a layer's back faces without it. */
const TWO_SIDED = 16;

/** Whether a clip-space polygon (x, y, w first) winds counter-clockwise on screen, the face the renderer keeps when it culls back faces. */
function frontFacing(polygon: readonly (readonly number[])[]): boolean {
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i] ?? [], q = polygon[(i + 1) % polygon.length] ?? [];
    area += (p[0] ?? 0) / (p[2] ?? 1) * ((q[1] ?? 0) / (q[2] ?? 1)) - (q[0] ?? 0) / (q[2] ?? 1) * ((p[1] ?? 0) / (p[2] ?? 1));
  }
  return area > 0;
}

/** The smallest alpha an alpha-keyed (Transparent) layer draws, as the renderer discards below it. */
const ALPHA_KEY = 0.75;

/**
 * Whether a texel (RGBA from 0 to 1) of a layer with `filter` and `opacity` changes the screen by more than the silhouette
 * threshold: an alpha-keyed texel at the alpha cut, a blended or additive one when its contribution exceeds SILHOUETTE_DELTA / 255.
 */
function draws(filter: number, opacity: number, r: number, g: number, b: number, a: number): boolean {
  const shows = SILHOUETTE_DELTA / 255;
  if (filter === 1) return a * opacity >= ALPHA_KEY;
  if (filter === 2) return a * opacity > shows;
  if (filter === 3 || filter === 4) return Math.max(r, g, b) * a * opacity > shows;
  if (filter === 5) return 1 - Math.min(r, g, b) > shows;
  if (filter === 6) return Math.max(Math.abs(2 * r - 1), Math.abs(2 * g - 1), Math.abs(2 * b - 1)) > shows;
  return true;
}

/**
 * How a drawn geoset is bounded: its whole surface, nothing, the texels its layers draw, or (a texture the bounds can't
 * read) the fallback: the disc rule for team glow, the whole surface otherwise.
 */
function drawnLayers(data: model.Model, geoset: number, pose: DrawnPose, sampler: PosedMesh["sampler"], textures: BoundsTextures | undefined): "whole" | "nothing" | "unknown" | TexelLayer[] {
  const source = data.Geosets[geoset], layers = data.Materials[source?.MaterialID ?? -1]?.Layers ?? [];
  const geosetAlpha = sampler.rendererData.geosetAlpha[geoset] ?? 1, out: TexelLayer[] = [];
  let unknown = false;
  for (const layer of layers) {
    const filter = Number(layer.FilterMode ?? 0);
    if (filter === 0) return "whole";
    const own = typeof layer.Alpha === "number" ? layer.Alpha : layer.Alpha === undefined ? 1 : sampler.interp.animVectorVal(layer.Alpha, 1);
    const opacity = geosetAlpha * own * pose.alpha / 255, texture = typeof layer.TextureID === "number" ? data.Textures[layer.TextureID] : undefined;
    const uv = source?.TVertices[layer.CoordId ?? 0];
    if (texture === undefined || uv === undefined || typeof layer.TVertexAnimId === "number") { unknown = true; continue; }
    const image = texture.Image ?? "";
    if (image === "" && texture.ReplaceableId === 1) { if (draws(filter, opacity, 1, 1, 1, 1)) return "whole"; continue; }
    const texels = image !== "" ? textures?.image(image) : texture.ReplaceableId === 2 ? textures?.teamGlow(pose.teamColor) : undefined;
    if (texels === undefined) { unknown = true; continue; }
    out.push({ filter, opacity, texture: texels, wrapU: ((texture.Flags ?? 0) & 1) !== 0, wrapV: ((texture.Flags ?? 0) & 2) !== 0, uv, twoSided: (Number(layer.Shading ?? 0) & TWO_SIDED) !== 0 });
  }
  return unknown ? "unknown" : out.length === 0 ? "nothing" : out;
}

/** The bilinear RGBA sample (0 to 1) at texture coordinates (u, v), clamped to the edge unless the texture wraps, as the renderer samples the top mip level. */
function sample(layer: TexelLayer, u: number, v: number, out: Float64Array): void {
  const { width, height, data } = layer.texture;
  const x = u * width - 0.5, y = v * height - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const column = (i: number) => layer.wrapU ? ((i % width) + width) % width : Math.min(width - 1, Math.max(0, i));
  const row = (i: number) => layer.wrapV ? ((i % height) + height) % height : Math.min(height - 1, Math.max(0, i));
  const a = (row(y0) * width + column(x0)) * 4, b = (row(y0) * width + column(x0 + 1)) * 4, c = (row(y0 + 1) * width + column(x0)) * 4, d = (row(y0 + 1) * width + column(x0 + 1)) * 4;
  for (let k = 0; k < 4; k++) out[k] = (((data[a + k] ?? 0) * (1 - fx) + (data[b + k] ?? 0) * fx) * (1 - fy) + ((data[c + k] ?? 0) * (1 - fx) + (data[d + k] ?? 0) * fx) * fy) / 255;
}

function poseBounds(pose: DrawnPose, found: BoundsModel, view: ReturnType<typeof camera>, width: number, height: number, farCulled = false, textures?: BoundsTextures): ModelBounds {
  const { sampler, geosets, drawn } = posedMesh(pose, found, view);
  const m = multiply(multiply(view.projection, view.view), transform(pose));
  const nodes = sampler.rendererData.nodes, near = view.near, far = view.far;
  const nodeBox = new Float64Array(nodes.length * 4);
  for (let i = 0; i < nodes.length; i++) nodeBox.set([Infinity, Infinity, -Infinity, -Infinity], i * 4);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, ahead = false;
  let bodyLeft = Infinity, bodyTop = Infinity, bodyRight = -Infinity, bodyBottom = -Infinity, glow = false, bodied = false;
  let teamGlow: "texture" | "disc" | undefined;
  const m0 = m[0] ?? 0, m1 = m[1] ?? 0, m3 = m[3] ?? 0, m4 = m[4] ?? 0, m5 = m[5] ?? 0, m7 = m[7] ?? 0, m8 = m[8] ?? 0, m9 = m[9] ?? 0, m11 = m[11] ?? 0, m12 = m[12] ?? 0, m13 = m[13] ?? 0, m15 = m[15] ?? 0;
  const extend = (x0: number, y0: number, x1: number, y1: number, main: number) => {
    if (x0 < left) left = x0; if (x1 > right) right = x1; if (y0 < top) top = y0; if (y1 > bottom) bottom = y1;
    if (bodied) { if (x0 < bodyLeft) bodyLeft = x0; if (x1 > bodyRight) bodyRight = x1; if (y0 < bodyTop) bodyTop = y0; if (y1 > bodyBottom) bodyBottom = y1; }
    if (main < 0) return;
    const o = main * 4;
    if (x0 < (nodeBox[o] ?? 0)) nodeBox[o] = x0; if (y0 < (nodeBox[o + 1] ?? 0)) nodeBox[o + 1] = y0;
    if (x1 > (nodeBox[o + 2] ?? 0)) nodeBox[o + 2] = x1; if (y1 > (nodeBox[o + 3] ?? 0)) nodeBox[o + 3] = y1;
  };
  const texel = new Float64Array(4);
  for (const mesh of drawn) {
    const { positions, main: mains, faces } = mesh;
    for (let vertex = 0; vertex < mains.length; vertex++) if (m3 * (positions[vertex * 3] ?? 0) + m7 * (positions[vertex * 3 + 1] ?? 0) + m11 * (positions[vertex * 3 + 2] ?? 0) + m15 >= near) { ahead = true; break; }
    const material = found.data.Geosets[mesh.geoset]?.MaterialID ?? -1;
    glow = glowOnly(found.data, material);
    bodied = opaque(found.data, material);
    const layers = drawnLayers(found.data, mesh.geoset, pose, sampler, textures);
    if (glow) teamGlow = layers === "unknown" ? "disc" : teamGlow ?? "texture";
    if (layers === "nothing") continue;
    if (layers !== "whole" && layers !== "unknown") {
      const window = { left: -width, top: -height, right: 2 * width, bottom: 2 * height };
      for (let face = 0; face + 2 < faces.length; face += 3) {
        const corners = [faces[face] ?? 0, faces[face + 1] ?? 0, faces[face + 2] ?? 0] as const;
        let polygon: number[][] = corners.map((v, corner) => {
          const x = positions[v * 3] ?? 0, y = positions[v * 3 + 1] ?? 0, z = positions[v * 3 + 2] ?? 0;
          return [m0 * x + m4 * y + m8 * z + m12, m1 * x + m5 * y + m9 * z + m13, m3 * x + m7 * y + m11 * z + m15, corner === 0 ? 1 : 0, corner === 1 ? 1 : 0, corner === 2 ? 1 : 0];
        });
        if (polygon.some((p) => (p[2] ?? 0) < near)) polygon = clipNear(polygon, near);
        const facing = polygon.length < 3 || frontFacing(polygon) ? layers : layers.filter((layer) => layer.twoSided);
        if (facing.length === 0) continue;
        for (let fan = 1; fan + 1 < polygon.length; fan++) {
          coverTriangle([polygon[0], polygon[fan], polygon[fan + 1]] as number[][], width, height, far, window, (column, row, _inverse, weights) => {
            const drawnHere = facing.some((layer) => {
              const u = weights[0] * (layer.uv[corners[0] * 2] ?? 0) + weights[1] * (layer.uv[corners[1] * 2] ?? 0) + weights[2] * (layer.uv[corners[2] * 2] ?? 0);
              const v = weights[0] * (layer.uv[corners[0] * 2 + 1] ?? 0) + weights[1] * (layer.uv[corners[1] * 2 + 1] ?? 0) + weights[2] * (layer.uv[corners[2] * 2 + 1] ?? 0);
              sample(layer, u, v, texel);
              return draws(layer.filter, layer.opacity, texel[0] ?? 0, texel[1] ?? 0, texel[2] ?? 0, texel[3] ?? 0);
            });
            if (drawnHere) extend(column, row, column + 1, row + 1, mains[corners[weights[0] >= weights[1] && weights[0] >= weights[2] ? 0 : weights[1] >= weights[2] ? 1 : 2]] ?? -1);
          });
        }
      }
      continue;
    }
    const uv = found.data.Geosets[mesh.geoset]?.TVertices[0];
    const points = layers === "unknown" && glow && uv !== undefined ? glowPoints(positions, mains, uv, faces) : { positions, main: mains };
    for (let vertex = 0; vertex < points.main.length; vertex++) {
      const x = points.positions[vertex * 3] ?? 0, y = points.positions[vertex * 3 + 1] ?? 0, z = points.positions[vertex * 3 + 2] ?? 0;
      const w = m3 * x + m7 * y + m11 * z + m15;
      if (w < near || w > far) continue;
      const px = ((m0 * x + m4 * y + m8 * z + m12) / w + 1) * width / 2, py = (1 - (m1 * x + m5 * y + m9 * z + m13) / w) * height / 2;
      extend(px, py, px, py, points.main[vertex] ?? -1);
    }
  }

  const box = left <= right ? { left, top, right, bottom } : undefined;
  const body = bodyLeft <= bodyRight ? { left: bodyLeft, top: bodyTop, right: bodyRight, bottom: bodyBottom } : undefined;
  const nodeRows: NodeBounds[] = [];
  // The renderer poses only nodes that place vertices or emitters, and their ancestors; the others keep no matrix.
  for (const [id, entry] of nodes.entries()) {
    const posed = entry as { matrix: Float32Array; node?: model.Node; wispPosed?: boolean } | undefined;
    if (posed?.wispPosed !== true || posed.node === undefined) continue;
    const n = posed.matrix, [qx = 0, qy = 0, qz = 0] = posed.node.PivotPoint ?? [];
    const x = (n[0] ?? 0) * qx + (n[4] ?? 0) * qy + (n[8] ?? 0) * qz + (n[12] ?? 0);
    const y = (n[1] ?? 0) * qx + (n[5] ?? 0) * qy + (n[9] ?? 0) * qz + (n[13] ?? 0);
    const z = (n[2] ?? 0) * qx + (n[6] ?? 0) * qy + (n[10] ?? 0) * qz + (n[14] ?? 0);
    const w = m3 * x + m7 * y + m11 * z + m15, o = id * 4;
    nodeRows.push({
      id, name: posed.node.Name,
      box: (nodeBox[o] ?? Infinity) <= (nodeBox[o + 2] ?? -Infinity) ? { left: nodeBox[o] ?? 0, top: nodeBox[o + 1] ?? 0, right: nodeBox[o + 2] ?? 0, bottom: nodeBox[o + 3] ?? 0 } : undefined,
      pivot: { x: ((m0 * x + m4 * y + m8 * z + m12) / w + 1) * width / 2, y: (1 - (m1 * x + m5 * y + m9 * z + m13) / w) * height / 2, behindEye: w < near },
    });
  }
  return {
    handle: pose.handle.id, model: pose.model, unit: pose.unit === true, box,
    offFrame: box === undefined || box.right < 0 || box.left > width || box.bottom < 0 || box.top > height,
    behindEye: !ahead, farCulled, geosets, nodes: nodeRows, ...(teamGlow === undefined ? {} : { teamGlow }),
    ...(body === undefined ? {} : { body }),
  };
}

/** A portrait texture's receipt: the scene it was rendered from at `width` x `height`, the crop of that render the texture holds, and the game's parts. */
export interface Portrait {
  readonly scene: Pick<RenderScene, "camera" | "effects" | "world">;
  readonly width: number;
  readonly height: number;
  /** Render pixels the texture holds, origin top left, y down. */
  readonly crop: PixelRect;
  /** The texture's size and, when it has one, its alpha per texel (0-255, row-major from the top row): a texel under half opacity shows the backdrop more than the portrait. */
  readonly texture: { readonly width: number; readonly height: number; readonly alpha?: ArrayLike<number> };
  /** Declared part name to node names; `head` and `weapon` also give the crown margin and the head pixels the weapon hides. */
  readonly parts: Readonly<Record<string, readonly string[]>>;
}

interface PartInFrame {
  /** Screen pixels inside the frame whose nearest surface belongs to the part. */
  readonly pixels: number;
  /** Pixel edges of those pixels; undefined when there are none. */
  readonly box: PixelBox | undefined;
}

export interface InFrame {
  readonly parts: Readonly<Record<string, PartInFrame>>;
  /** Rows between the frame's top row and the head's top visible row; undefined without a visible head. */
  readonly crownMargin: number | undefined;
  /** Frame pixels where the weapon is nearest and the head would show without it. */
  readonly headHiddenByWeapon: number;
  /** Pixels between the hand's and the weapon's visible boxes (0 when they touch or overlap); undefined unless both show. */
  readonly handGap: number | undefined;
}

const EMPTY = -1, UNNAMED = -2;

/**
 * Per declared part, what of a portrait shows inside a HUD frame drawn at `frame` (screen pixels), with the texture drawn
 * whole. The portrait's posed triangles are rasterized with a depth buffer at its render size, each pixel labelled with the
 * nearest named node at or above the node its nearest vertex weights most, so a part takes the named nodes' descendants
 * down to another named node; each frame pixel samples the texel it shows and the render pixel at that texel's centre,
 * and shows the portrait only where that texel is at least half opaque.
 */
export function inFrame(portrait: Portrait, models: (path: string) => BoundsModel | undefined, frame: PixelRect): InFrame {
  const { width, height, crop, texture, parts } = portrait;
  const view = camera(portrait.scene as RenderScene, width / height);
  const names = new Map<string, number>(), weapon = new Set(parts.weapon ?? []), named = new Set(Object.values(parts).flat());
  const label = new Int32Array(width * height).fill(EMPTY), depth = new Float64Array(width * height);
  const under = new Int32Array(width * height).fill(EMPTY), underDepth = new Float64Array(width * height);
  const near = view.near, far = view.far;
  const modelPaths = [...new Set(portrait.scene.effects.map((pose) => pose.model))];
  for (const path of modelPaths) {
    for (const node of models(path)?.data.Nodes ?? []) {
      if (named.has(node.Name) && !names.has(node.Name)) names.set(node.Name, names.size);
    }
  }
  const poses = drawnPoses(portrait.scene.effects, view.eye, far, portrait.scene.world);
  for (const pose of poses) {
    const found = models(pose.model);
    if (found === undefined) continue;
    const { sampler, drawn } = posedMesh(pose, found, view);
    const nodeLabels = found.data.Nodes.map((_, id) => {
      for (let at: model.Node | undefined = found.data.Nodes[id], steps = 0; at !== undefined && steps < found.data.Nodes.length; steps++) {
        if (named.has(at.Name)) {
          if (!names.has(at.Name)) names.set(at.Name, names.size);
          return names.get(at.Name) ?? UNNAMED;
        }
        const parent = at.Parent ?? -1;
        at = parent < 0 ? undefined : found.data.Nodes[parent];
      }
      return UNNAMED;
    });
    const weaponLabels = new Set([...weapon].map((name) => names.get(name)));
    const m = multiply(multiply(view.projection, view.view), transform(pose));
    const m0 = m[0] ?? 0, m1 = m[1] ?? 0, m3 = m[3] ?? 0, m4 = m[4] ?? 0, m5 = m[5] ?? 0, m7 = m[7] ?? 0, m8 = m[8] ?? 0, m9 = m[9] ?? 0, m11 = m[11] ?? 0, m12 = m[12] ?? 0, m13 = m[13] ?? 0, m15 = m[15] ?? 0;
    for (const { positions, main, faces } of drawn) {
      for (let face = 0; face + 2 < faces.length; face += 3) {
        // Clip x, y and w of each corner, with its weights on the triangle's three vertices, clipped to the near plane.
        let polygon: number[][] = [0, 1, 2].map((corner) => {
          const v = faces[face + corner] ?? 0, x = positions[v * 3] ?? 0, y = positions[v * 3 + 1] ?? 0, z = positions[v * 3 + 2] ?? 0;
          return [m0 * x + m4 * y + m8 * z + m12, m1 * x + m5 * y + m9 * z + m13, m3 * x + m7 * y + m11 * z + m15, corner === 0 ? 1 : 0, corner === 1 ? 1 : 0, corner === 2 ? 1 : 0];
        });
        if (polygon.some((p) => (p[2] ?? 0) < near)) polygon = clipNear(polygon, near);
        const corners = [0, 1, 2].map((corner) => nodeLabels[main[faces[face + corner] ?? 0] ?? -1] ?? UNNAMED);
        for (let fan = 1; fan + 1 < polygon.length; fan++) {
          const triangle = [polygon[0], polygon[fan], polygon[fan + 1]] as number[][];
          rasterTriangle(triangle, width, height, far, (pixel, inverse, weights) => {
            const nearest = corners[weights[0] >= weights[1] && weights[0] >= weights[2] ? 0 : weights[1] >= weights[2] ? 1 : 2] ?? UNNAMED;
            if (inverse > (depth[pixel] ?? 0)) { depth[pixel] = inverse; label[pixel] = nearest; }
            if (!weaponLabels.has(nearest) && inverse > (underDepth[pixel] ?? 0)) { underDepth[pixel] = inverse; under[pixel] = nearest; }
          });
        }
      }
    }
  }

  const missing = Object.entries(parts).flatMap(([part, nodes]) => {
    const absent = nodes.filter((node) => !names.has(node));
    return absent.length === 0 ? [] : [`part ${part} names ${absent.join(", ")}`];
  });
  if (missing.length > 0) throw new Error(`${missing.join("; ")}, which none of the portrait models ${modelPaths.join(", ")} has; regenerate the portrait on the map's current models`);
  const partsOf: string[][] = [...names.keys()].map((name) => Object.keys(parts).filter((part) => parts[part]?.includes(name)));
  const counts = new Map(Object.keys(parts).map((part) => [part, { pixels: 0, left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }]));
  const head = new Set(parts.head ?? []), headLabels = new Set([...head].map((name) => names.get(name))), weaponLabels = new Set([...weapon].map((name) => names.get(name)));
  const firstColumn = Math.ceil(frame.x - 0.5), endColumn = Math.ceil(frame.x + frame.width - 0.5);
  const firstRow = Math.ceil(frame.y - 0.5), endRow = Math.ceil(frame.y + frame.height - 0.5);
  let hidden = 0;
  for (let row = firstRow; row < endRow; row++) {
    const texelY = Math.min(texture.height - 1, Math.floor((row + 0.5 - frame.y) / frame.height * texture.height));
    const y = Math.floor(crop.y + (texelY + 0.5) * crop.height / texture.height);
    if (y < 0 || y >= height) continue;
    for (let column = firstColumn; column < endColumn; column++) {
      const texelX = Math.min(texture.width - 1, Math.floor((column + 0.5 - frame.x) / frame.width * texture.width));
      if (texture.alpha !== undefined && (texture.alpha[texelY * texture.width + texelX] ?? 0) < 128) continue;
      const x = Math.floor(crop.x + (texelX + 0.5) * crop.width / texture.width);
      if (x < 0 || x >= width) continue;
      const shown = label[y * width + x] ?? EMPTY;
      if (shown < 0) continue;
      for (const part of partsOf[shown] ?? []) {
        const count = counts.get(part);
        if (count === undefined) continue;
        count.pixels++;
        count.left = Math.min(count.left, column); count.top = Math.min(count.top, row);
        count.right = Math.max(count.right, column + 1); count.bottom = Math.max(count.bottom, row + 1);
      }
      if (weaponLabels.has(shown) && !headLabels.has(shown) && headLabels.has(under[y * width + x])) hidden++;
    }
  }
  const rows = Object.fromEntries([...counts].map(([part, { pixels, left, top, right, bottom }]) => [part, { pixels, box: pixels === 0 ? undefined : { left, top, right, bottom } }]));
  const headBox = rows.head?.box, handBox = rows.hand?.box, weaponBox = rows.weapon?.box;
  const handGap = handBox === undefined || weaponBox === undefined ? undefined
    : Math.hypot(Math.max(0, handBox.left - weaponBox.right, weaponBox.left - handBox.right), Math.max(0, handBox.top - weaponBox.bottom, weaponBox.top - handBox.bottom));
  return { parts: rows, crownMargin: headBox === undefined ? undefined : headBox.top - firstRow, headHiddenByWeapon: hidden, handGap };
}

/** Sutherland-Hodgman against w >= near, interpolating every attribute linearly in clip space. */
function clipNear(polygon: readonly number[][], near: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] ?? [], b = polygon[(i + 1) % polygon.length] ?? [];
    const aw = a[2] ?? 0, bw = b[2] ?? 0;
    if (aw >= near) out.push(a);
    if ((aw >= near) !== (bw >= near)) { const t = (near - aw) / (bw - aw); out.push(a.map((value, k) => value + ((b[k] ?? 0) - value) * t)); }
  }
  return out;
}

/** Visits each pixel whose centre the clip-space triangle covers, with its perspective-correct 1/w and vertex weights. */
function rasterTriangle(triangle: readonly number[][], width: number, height: number, far: number, visit: (pixel: number, inverse: number, weights: readonly [number, number, number]) => void): void {
  coverTriangle(triangle, width, height, far, { left: 0, top: 0, right: width, bottom: height }, (column, row, inverse, weights) => visit(row * width + column, inverse, weights));
}

/** rasterTriangle over the pixel columns and rows `window` spans, which may reach past the canvas. */
function coverTriangle(triangle: readonly number[][], width: number, height: number, far: number, window: PixelBox, visit: (column: number, row: number, inverse: number, weights: readonly [number, number, number]) => void): void {
  const [a = [], b = [], c = []] = triangle;
  const screen = (p: readonly number[]) => [((p[0] ?? 0) / (p[2] ?? 1) + 1) * width / 2, (1 - (p[1] ?? 0) / (p[2] ?? 1)) * height / 2, 1 / (p[2] ?? 1)] as const;
  const [ax, ay, ai] = screen(a), [bx, by, bi] = screen(b), [cx, cy, ci] = screen(c);
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0 || !Number.isFinite(area)) return;
  const left = Math.max(window.left, Math.ceil(Math.min(ax, bx, cx) - 0.5)), right = Math.min(window.right - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
  const top = Math.max(window.top, Math.ceil(Math.min(ay, by, cy) - 0.5)), bottom = Math.min(window.bottom - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
  const weights: [number, number, number] = [0, 0, 0];
  for (let row = top; row <= bottom; row++) {
    const py = row + 0.5;
    for (let column = left; column <= right; column++) {
      const px = column + 0.5;
      const la = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, lb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, lc = 1 - la - lb;
      if (la < 0 || lb < 0 || lc < 0) continue;
      const inverse = la * ai + lb * bi + lc * ci;
      if (1 / inverse > far) continue;
      for (let k = 0; k < 3; k++) weights[k] = (la * ai * (a[3 + k] ?? 0) + lb * bi * (b[3 + k] ?? 0) + lc * ci * (c[3 + k] ?? 0)) / inverse;
      visit(column, row, inverse, weights);
    }
  }
}

/** A decoded capture: `rgb` holds 3 bytes a pixel, as decodePng (wisp:host/fidelity/image.ts) and decodePpm (wisp:host/scene/frameProbe.ts) give it. */
export interface Capture { readonly width: number; readonly height: number; readonly rgb: Uint8Array }

/** Larger per-channel differences between the shown and hidden captures mark a silhouette pixel. */
export const SILHOUETTE_DELTA = 24;

/**
 * The native silhouette's pixel box from two captures of one held frame, the fighter `shown` and `hidden`: pixels whose
 * largest per-channel |Δ| is above SILHOUETTE_DELTA, kept in the 8-connected regions that have a pixel overlapping `near`
 * (Wisp's posed box grown by 20 px). Edges are pixel edges; undefined when no marked pixel overlaps `near`.
 */
export function silhouetteBounds(shown: Capture, hidden: Capture, near: PixelBox): PixelBox | undefined {
  const { width, height } = shown;
  if (hidden.width !== width || hidden.height !== height) throw new Error(`captures differ in size: ${width}x${height} and ${hidden.width}x${hidden.height}`);
  const marked = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) if (Math.abs((shown.rgb[i * 3 + c] ?? 0) - (hidden.rgb[i * 3 + c] ?? 0)) > SILHOUETTE_DELTA) { marked[i] = 1; break; }
  }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  const queue = new Int32Array(width * height);
  const firstColumn = Math.max(0, Math.floor(near.left)), endColumn = Math.min(width, Math.ceil(near.right));
  const firstRow = Math.max(0, Math.floor(near.top)), endRow = Math.min(height, Math.ceil(near.bottom));
  for (let row = firstRow; row < endRow; row++) for (let column = firstColumn; column < endColumn; column++) {
    if (marked[row * width + column] !== 1) continue;
    // Flood the region; visited pixels are marked 2.
    let head = 0, tail = 0;
    queue[tail++] = row * width + column; marked[row * width + column] = 2;
    while (head < tail) {
      const at = queue[head++] ?? 0, x = at % width, y = (at - x) / width;
      if (x < left) left = x; if (x + 1 > right) right = x + 1; if (y < top) top = y; if (y + 1 > bottom) bottom = y + 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || marked[ny * width + nx] !== 1) continue;
        marked[ny * width + nx] = 2; queue[tail++] = ny * width + nx;
      }
    }
  }
  return left <= right ? { left, top, right, bottom } : undefined;
}

export interface EdgeComparison {
  /** Native minus Wisp, per edge, in px. */
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** Every edge within 4 px. */
  readonly within: boolean;
}

export const EDGE_TOLERANCE = 4;

/** Box 3's per-frame verdict (wisp#125): Wisp's posed box against the native silhouette's, edge by edge. */
export function compareEdges(wisp: PixelBox, native: PixelBox): EdgeComparison {
  const left = native.left - wisp.left, top = native.top - wisp.top, right = native.right - wisp.right, bottom = native.bottom - wisp.bottom;
  return { left, top, right, bottom, within: [left, top, right, bottom].every((edge) => Math.abs(edge) <= EDGE_TOLERANCE) };
}
