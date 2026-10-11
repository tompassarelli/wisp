import { ModelRenderer, type model } from "../../vendor/war3-model.mjs";
import { type AnimationSequence, animationSample, blendWeight, globalSequenceFrame } from "../../src/headless/animation";
import { drawnPoses } from "./culling";
import type { DrawnPose, RenderScene } from "./headlessRender";
import { camera, multiply, poseNodes, type Sampler, show, transform } from "./screen";

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

export function poseBounds(pose: DrawnPose, found: BoundsModel, view: ReturnType<typeof camera>, width: number, height: number, farCulled = false): ModelBounds {
  const { data, renderer } = found, sampler = renderer as unknown as Sampler & { rendererData: { geosetAlpha: number[] } };
  // The same posing as drawEffect in browser/headlessRender.ts.
  const kind = pose.unit === true ? "unit" : "effect";
  const sample = animationSample(found.sequences, { animation: pose.animation, subAnimations: pose.subAnimations, elapsed: pose.animationElapsed }, kind);
  renderer.setCamera(new Float32Array(view.eye), view.quaternion);
  show(sampler, data, sample);
  data.GlobalSequences.forEach((length, index) => { sampler.rendererData.globalSequencesFrames[index] = globalSequenceFrame(pose.animationClock, length); });
  const blend = pose.animationBlend, weight = blendWeight(pose);
  const saved = blend === undefined ? undefined : animationSample(found.sequences, blend.from, kind);
  renderer.update(0);
  if (saved !== undefined && weight > 0) poseNodes(sampler, data, saved, weight);

  const m = multiply(multiply(view.projection, view.view), transform(pose));
  const nodes = sampler.rendererData.nodes, near = view.near, far = view.far;
  const nodeBox = new Float64Array(nodes.length * 4);
  for (let i = 0; i < nodes.length; i++) nodeBox.set([Infinity, Infinity, -Infinity, -Infinity], i * 4);
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, ahead = false;
  const m0 = m[0] ?? 0, m1 = m[1] ?? 0, m3 = m[3] ?? 0, m4 = m[4] ?? 0, m5 = m[5] ?? 0, m7 = m[7] ?? 0, m8 = m[8] ?? 0, m9 = m[9] ?? 0, m11 = m[11] ?? 0, m12 = m[12] ?? 0, m13 = m[13] ?? 0, m15 = m[15] ?? 0;
  const geosets: GeosetBounds[] = [];
  data.Geosets.forEach((geoset, index) => {
    const alpha = sampler.rendererData.geosetAlpha[index] ?? 1;
    const drawn = alpha >= GEOSET_HIDDEN && (geoset.LevelOfDetail === undefined || geoset.LevelOfDetail === 0);
    geosets.push({ index, alpha, filterMode: Number(data.Materials[geoset.MaterialID]?.Layers[0]?.FilterMode ?? 0), drawn });
    if (!drawn) return;
    const source = geoset.Vertices, skin = geoset.SkinWeights !== undefined && geoset.SkinWeights.length > 0 ? geoset.SkinWeights : undefined;
    for (let vertex = 0; vertex < source.length / 3; vertex++) {
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
        const count = Math.min(4, group.length);
        for (let j = 0; j < count; j++) {
          const n = nodes[group[j] ?? 0]?.matrix;
          if (n === undefined) continue;
          x += (n[0] ?? 0) * vx + (n[4] ?? 0) * vy + (n[8] ?? 0) * vz + (n[12] ?? 0);
          y += (n[1] ?? 0) * vx + (n[5] ?? 0) * vy + (n[9] ?? 0) * vz + (n[13] ?? 0);
          z += (n[2] ?? 0) * vx + (n[6] ?? 0) * vy + (n[10] ?? 0) * vz + (n[14] ?? 0);
        }
        if (count > 0) { x /= count; y /= count; z /= count; main = group[0] ?? -1; }
      }
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
  });

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
