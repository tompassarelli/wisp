import { ModelRenderer, type model } from "../../vendor/war3-model.mjs";
import { type AnimationSequence, animationSample, blendWeight, globalSequenceFrame } from "../../src/headless/animation";
import { drawnPoses } from "./culling";
import type { DrawnPose, RenderScene } from "./headlessRender";
import { camera, multiply, type PixelRect, poseNodes, type Sampler, show, transform } from "./screen";

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

export interface GeosetBounds {
  readonly index: number;
  readonly alpha: number;
  /** The first material layer's filter mode (war3-model's FilterMode: 0 None, 1 Transparent, 2 Blend, 3 Additive, ...). */
  readonly filterMode: number;
  readonly drawn: boolean;
}

export interface NodeBounds {
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
}

const GEOSET_HIDDEN = 1e-6;

/**
 * Posed screen bounds of every effect and unit in `scene.effects` (pass the scene through `sceneWithUnits` first)
 * at a `width` x `height` canvas. Poses the renderer culls for alpha, scale, flatness or the world bounds are left
 * out; poses beyond the far distance are reported with `farCulled`.
 */
export function sceneBounds(scene: RenderScene, models: (path: string) => BoundsModel | undefined, width: number, height: number): ModelBounds[] {
  const view = camera(scene, width / height);
  const kept = new Set(drawnPoses(scene.effects, view.eye, view.far, scene.world));
  const rows: ModelBounds[] = [];
  for (const pose of drawnPoses(scene.effects, view.eye, Infinity, scene.world)) {
    const found = models(pose.model);
    if (found !== undefined) rows.push(poseBounds(pose, found, view, width, height, !kept.has(pose)));
  }
  return rows;
}

interface PosedMesh {
  readonly sampler: Sampler & { rendererData: { geosetAlpha: number[] } };
  readonly geosets: readonly GeosetBounds[];
  /** Per drawn geoset: skinned model-space positions, each vertex's most-weighted node (or -1), and its triangles. */
  readonly drawn: readonly { readonly positions: Float64Array; readonly main: Int32Array; readonly faces: ArrayLike<number> }[];
}

/** Poses and skins a model on the CPU, as drawEffect in browser/headlessRender.ts poses it. */
function posedMesh(pose: DrawnPose, found: BoundsModel, view: ReturnType<typeof camera>): PosedMesh {
  const { data, renderer } = found, sampler = renderer as unknown as PosedMesh["sampler"];
  const kind = pose.unit === true ? "unit" : "effect";
  const sample = animationSample(found.sequences, { animation: pose.animation, subAnimations: pose.subAnimations, elapsed: pose.animationElapsed }, kind);
  renderer.setCamera(new Float32Array(view.eye), view.quaternion);
  show(sampler, data, sample);
  data.GlobalSequences.forEach((length, index) => { sampler.rendererData.globalSequencesFrames[index] = globalSequenceFrame(pose.animationClock, length); });
  const blend = pose.animationBlend, weight = blendWeight(pose);
  const saved = blend === undefined ? undefined : animationSample(found.sequences, blend.from, kind);
  renderer.update(0);
  if (saved !== undefined && weight > 0) poseNodes(sampler, data, saved, weight);

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
    drawnMeshes.push({ positions, main: mains, faces: geoset.Faces });
  });
  return { sampler, geosets, drawn: drawnMeshes };
}

export function poseBounds(pose: DrawnPose, found: BoundsModel, view: ReturnType<typeof camera>, width: number, height: number, farCulled = false): ModelBounds {
  const { sampler, geosets, drawn } = posedMesh(pose, found, view);
  const m = multiply(multiply(view.projection, view.view), transform(pose));
  const nodes = sampler.rendererData.nodes, near = view.near, far = view.far;
  const nodeBox = new Float64Array(nodes.length * 4);
  for (let i = 0; i < nodes.length; i++) nodeBox.set([Infinity, Infinity, -Infinity, -Infinity], i * 4);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, ahead = false;
  const m0 = m[0] ?? 0, m1 = m[1] ?? 0, m3 = m[3] ?? 0, m4 = m[4] ?? 0, m5 = m[5] ?? 0, m7 = m[7] ?? 0, m8 = m[8] ?? 0, m9 = m[9] ?? 0, m11 = m[11] ?? 0, m12 = m[12] ?? 0, m13 = m[13] ?? 0, m15 = m[15] ?? 0;
  for (const { positions, main: mains } of drawn) {
    for (let vertex = 0; vertex < mains.length; vertex++) {
      const x = positions[vertex * 3] ?? 0, y = positions[vertex * 3 + 1] ?? 0, z = positions[vertex * 3 + 2] ?? 0, main = mains[vertex] ?? -1;
      const w = m3 * x + m7 * y + m11 * z + m15;
      if (w < near) continue;
      ahead = true;
      if (w > far) continue;
      const px = ((m0 * x + m4 * y + m8 * z + m12) / w + 1) * width / 2, py = (1 - (m1 * x + m5 * y + m9 * z + m13) / w) * height / 2;
      if (px < left) left = px; if (px > right) right = px; if (py < top) top = py; if (py > bottom) bottom = py;
      if (main < 0) continue;
      const o = main * 4;
      if (px < (nodeBox[o] ?? 0)) nodeBox[o] = px; if (py < (nodeBox[o + 1] ?? 0)) nodeBox[o + 1] = py;
      if (px > (nodeBox[o + 2] ?? 0)) nodeBox[o + 2] = px; if (py > (nodeBox[o + 3] ?? 0)) nodeBox[o + 3] = py;
    }
  }

  const box = left <= right ? { left, top, right, bottom } : undefined;
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
    behindEye: !ahead, farCulled, geosets, nodes: nodeRows,
  };
}

/** A portrait texture's receipt: the scene it was rendered from at `width` x `height`, the crop of that render the texture holds, and the game's parts. */
export interface Portrait {
  readonly scene: Pick<RenderScene, "camera" | "effects" | "world">;
  readonly width: number;
  readonly height: number;
  /** Render pixels the texture holds, origin top left, y down. */
  readonly crop: PixelRect;
  readonly texture: { readonly width: number; readonly height: number };
  /** Declared part name to node names; `head` and `weapon` also give the crown margin and the head pixels the weapon hides. */
  readonly parts: Readonly<Record<string, readonly string[]>>;
}

export interface PartInFrame {
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
}

const EMPTY = -1, UNNAMED = -2;

/**
 * Per declared part, what of a portrait shows inside a HUD frame drawn at `frame` (screen pixels), with the texture drawn
 * whole. The portrait's posed triangles are rasterized with a depth buffer at its render size, each pixel labelled with the
 * node its nearest vertex weights most; each frame pixel samples the texel it shows and the render pixel at that texel's centre.
 */
export function inFrame(portrait: Portrait, models: (path: string) => BoundsModel | undefined, frame: PixelRect): InFrame {
  const { width, height, crop, texture, parts } = portrait;
  const view = camera(portrait.scene as RenderScene, width / height);
  const names = new Map<string, number>(), weapon = new Set(parts.weapon ?? []);
  const label = new Int32Array(width * height).fill(EMPTY), depth = new Float64Array(width * height);
  const under = new Int32Array(width * height).fill(EMPTY), underDepth = new Float64Array(width * height);
  const near = view.near, far = view.far;
  for (const pose of drawnPoses(portrait.scene.effects, view.eye, far, portrait.scene.world)) {
    const found = models(pose.model);
    if (found === undefined) continue;
    const { sampler, drawn } = posedMesh(pose, found, view);
    const nodeLabels = sampler.rendererData.nodes.map((entry) => {
      const name = (entry as { node?: model.Node }).node?.Name;
      if (name === undefined) return UNNAMED;
      if (!names.has(name)) names.set(name, names.size);
      return names.get(name) ?? UNNAMED;
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
  const headBox = rows.head?.box;
  return { parts: rows, crownMargin: headBox === undefined ? undefined : headBox.top - firstRow, headHiddenByWeapon: hidden };
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
  const [a = [], b = [], c = []] = triangle;
  const screen = (p: readonly number[]) => [((p[0] ?? 0) / (p[2] ?? 1) + 1) * width / 2, (1 - (p[1] ?? 0) / (p[2] ?? 1)) * height / 2, 1 / (p[2] ?? 1)] as const;
  const [ax, ay, ai] = screen(a), [bx, by, bi] = screen(b), [cx, cy, ci] = screen(c);
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (area === 0 || !Number.isFinite(area)) return;
  const left = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)), right = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
  const top = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)), bottom = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
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
      visit(row * width + column, inverse, weights);
    }
  }
}

/** A decoded capture: `rgb` holds 3 bytes a pixel, as decodePng (wisp:scripts/wisp/fidelity/image.ts) and decodePpm (wisp:scripts/wisp/frameProbe.ts) give it. */
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
