import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { multiply } from "../../host/browser/matrix";
import { parseModelMDX } from "../../host/models/models";
import type { RenderScene } from "../../host/render/renderScene";
import { camera, transform } from "../../host/render/screen";
import { boundsModel, posedMesh, sceneBounds, texels, type BoundsModel, type Texels } from "../../host/render/screenBounds";
import { twinTexture } from "../glow6/textures";
import { PHASES, TWIN_TEXTURE } from "./layout";
import { phaseScenes } from "./scenes";

export const WIDTH = 1920, HEIGHT = 1080;
const TWO_SIDED = 16, ADDITIVE = 3;

interface Corner { readonly x: number; readonly y: number; readonly w: number; readonly u: number; readonly v: number }

/** The top mip's bilinear RGBA sample (0 to 1) at (u, v), clamped at the edge. */
function bilinear(image: Texels, u: number, v: number): number[] {
  const tx = u * image.width - 0.5, ty = v * image.height - 0.5, x0 = Math.floor(tx), y0 = Math.floor(ty), fx = tx - x0, fy = ty - y0;
  const at = (c: number, r: number, k: number) => (image.data[(Math.min(image.height - 1, Math.max(0, r)) * image.width + Math.min(image.width - 1, Math.max(0, c))) * 4 + k] ?? 0) / 255;
  return [0, 1, 2, 3].map((k) => (at(x0, y0, k) * (1 - fx) + at(x0 + 1, y0, k) * fx) * (1 - fy) + (at(x0, y0 + 1, k) * (1 - fx) + at(x0 + 1, y0 + 1, k) * fx) * fy);
}

/** Adds one screen triangle's light: each covered pixel centre's perspective-correct texel, colour times alpha times `opacity`; a back face adds nothing unless `twoSided`. */
function addTriangle(added: Float32Array, [p0, p1, p2]: readonly [Corner, Corner, Corner], image: Texels, opacity: number, twoSided: boolean): void {
  const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
  if (area === 0 || (!twoSided && area > 0)) return;
  for (let row = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y))); row <= Math.min(HEIGHT - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y))); row++) {
    for (let column = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x))); column <= Math.min(WIDTH - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x))); column++) {
      const x = column + 0.5, y = row + 0.5;
      const l1 = ((x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (y - p0.y)) / area, l2 = ((p1.x - p0.x) * (y - p0.y) - (x - p0.x) * (p1.y - p0.y)) / area, l0 = 1 - l1 - l2;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      const q0 = l0 / p0.w, q1 = l1 / p1.w, q2 = l2 / p2.w, sum = q0 + q1 + q2;
      const texel = bilinear(image, (q0 * p0.u + q1 * p1.u + q2 * p2.u) / sum, (q0 * p0.v + q1 * p1.v + q2 * p2.v) / sum);
      const o = (row * WIDTH + column) * 3, alpha = (texel[3] ?? 0) * opacity;
      for (let k = 0; k < 3; k++) added[o + k] = (added[o + k] ?? 0) + (texel[k] ?? 0) * alpha * 255;
    }
  }
}

/** Wisp's per-pixel added light (RGB, 0 to 255) of every additive team-glow or twin layer the scene shows: each triangle projected through `camera()`, back faces culled unless two-sided, its texture sampled bilinearly at the perspective-correct coordinate and its colour times alpha times opacity summed over overlapping triangles. */
export function addedLight(scene: RenderScene, models: (path: string) => BoundsModel | undefined, glow: Texels, twin: Texels): Float32Array {
  const added = new Float32Array(WIDTH * HEIGHT * 3);
  const view = camera(scene, WIDTH / HEIGHT);
  for (const pose of scene.effects) {
    const found = models(pose.model);
    if (found === undefined || pose.y < -8000) continue;
    const { sampler, drawn } = posedMesh(pose, found, view);
    const m = multiply(multiply(view.projection, view.view), transform(pose)), k = (i: number) => m[i] ?? 0;
    for (const mesh of drawn) {
      const geoset = found.data.Geosets[mesh.geoset];
      for (const layer of found.data.Materials[geoset?.MaterialID ?? -1]?.Layers ?? []) {
        const texture = typeof layer.TextureID === "number" ? found.data.Textures[layer.TextureID] : undefined;
        const image = texture?.ReplaceableId === 2 ? glow : texture?.Image === TWIN_TEXTURE ? twin : undefined;
        if (Number(layer.FilterMode) !== ADDITIVE || image === undefined || geoset === undefined) continue;
        const own = typeof layer.Alpha === "number" ? layer.Alpha : layer.Alpha === undefined ? 1 : sampler.interp.animVectorVal(layer.Alpha, 1);
        const opacity = (sampler.rendererData.geosetAlpha[mesh.geoset] ?? 1) * Number(own) * pose.alpha / 255;
        const uv = geoset.TVertices[layer.CoordId ?? 0] ?? [];
        const corner = (v: number): Corner => {
          const x = mesh.positions[v * 3] ?? 0, y = mesh.positions[v * 3 + 1] ?? 0, z = mesh.positions[v * 3 + 2] ?? 0, w = k(3) * x + k(7) * y + k(11) * z + k(15);
          return { x: ((k(0) * x + k(4) * y + k(8) * z + k(12)) / w + 1) * WIDTH / 2, y: (1 - (k(1) * x + k(5) * y + k(9) * z + k(13)) / w) * HEIGHT / 2, w, u: uv[v * 2] ?? 0, v: uv[v * 2 + 1] ?? 0 };
        };
        for (let face = 0; face + 2 < mesh.faces.length; face += 3) {
          const triangle = [corner(mesh.faces[face] ?? 0), corner(mesh.faces[face + 1] ?? 0), corner(mesh.faces[face + 2] ?? 0)] as const;
          if (triangle.every((p) => p.w >= view.near)) addTriangle(added, triangle, image, opacity, (Number(layer.Shading ?? 0) & TWO_SIDED) !== 0);
        }
      }
    }
  }
  return added;
}

if (import.meta.main) {
  const [glowPng, assets, out] = process.argv.slice(2);
  if (glowPng === undefined || assets === undefined || out === undefined) throw new Error("usage: bun test/glow6e/oracle.ts TEAMGLOW00.png BUILT_ASSETS_DIR OUT_DIR");
  const glow = texels(new Uint8Array(readFileSync(glowPng)));
  if (glow === undefined) throw new Error(`${glowPng} isn't a PNG or BLP texture`);
  const twin = twinTexture();
  const loaded = new Map(readdirSync(assets).filter((file) => file.endsWith(".mdx")).map((file) => [`war3mapImported\\${file}`, boundsModel(parseModelMDX(new Uint8Array(readFileSync(join(assets, file))).slice().buffer))]));
  const models = (path: string) => loaded.get(path);
  mkdirSync(out, { recursive: true });
  const scenes = phaseScenes();
  for (const phase of PHASES) {
    const scene = scenes.get(phase.name);
    if (scene === undefined || phase.shown.length === 0) continue;
    const added = addedLight(scene, models, glow, twin);
    writeFileSync(join(out, `${phase.name}.f32`), new Uint8Array(added.buffer));
    const boxes = sceneBounds(scene, models, WIDTH, HEIGHT, { image: (path) => path === TWIN_TEXTURE ? twin : undefined, teamGlow: () => glow }).filter((row) => phase.shown.some((placed) => placed.model === row.model));
    writeFileSync(join(out, `${phase.name}.json`), `${JSON.stringify({ phase: phase.name, camera: scene.camera, boxes: boxes.map((row) => ({ model: row.model, box: row.box, body: row.body, teamGlow: row.teamGlow })) }, null, 1)}\n`);
    console.log(phase.name, JSON.stringify(boxes.map((row) => row.box)));
  }
}
