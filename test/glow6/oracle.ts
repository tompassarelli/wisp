import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installHeadless } from "../../host/headless/headless";
import { captureScene } from "../../host/render/headlessRender";
import { multiply } from "../../host/browser/matrix";
import { camera, transform } from "../../host/render/screen";
import { boundsModel, sceneBounds, texels, type Texels } from "../../host/render/screenBounds";
import { parseModelMDX } from "../../host/models/models";
import { GLOW, ORACLE_FRAME, PHASE_SECONDS, QUAD_CORNERS, TWIN } from "./layout";
import { GLOW_NOOPS, install, start } from "./main";
import { fixtureModels } from "./models";
import { twinTexture } from "./textures";

export const WIDTH = 1920, HEIGHT = 1080;

const peak = (values: Float32Array) => values.reduce((best, value) => Math.max(best, value), 0);

export interface Oracle {
  readonly quad: "glow" | "twin";
  readonly corners: readonly (readonly [number, number])[];
  readonly box: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | undefined;
  /** Predicted added level per pixel and channel (RGB, 0 to 255, unrounded), row-major over the canvas. */
  readonly added: Float32Array;
}

/** Wisp's texel rule for an additive layer: the top mip sampled bilinearly at the perspective-correct texture coordinate, clamped at the edge, its colour times its alpha times the layer's opacity. */
export function predict(quad: "glow" | "twin", matrix: ArrayLike<number>, texture: Texels, opacity: number, offset: readonly [number, number] = [0, 0]): Oracle {
  const corners = QUAD_CORNERS;
  const m = (i: number) => matrix[i] ?? 0;
  const projected = corners.map(([x, y, z, u, v]) => {
    const w = m(3) * x + m(7) * y + m(11) * z + m(15);
    return { x: ((m(0) * x + m(4) * y + m(8) * z + m(12)) / w + 1) * WIDTH / 2 + offset[0], y: (1 - (m(1) * x + m(5) * y + m(9) * z + m(13)) / w) * HEIGHT / 2 + offset[1], w, u, v };
  });
  const added = new Float32Array(WIDTH * HEIGHT * 3);
  const { width, height, data } = texture;
  const at = (column: number, row: number, k: number) => (data[(Math.min(height - 1, Math.max(0, row)) * width + Math.min(width - 1, Math.max(0, column))) * 4 + k] ?? 0) / 255;
  for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]] as const) {
    const p = [projected[a], projected[b], projected[c]].flatMap((point) => point === undefined ? [] : [point]);
    const [p0, p1, p2] = p;
    if (p0 === undefined || p1 === undefined || p2 === undefined) continue;
    const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
    for (let row = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y))); row <= Math.min(HEIGHT - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y))); row++) {
      for (let column = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x))); column <= Math.min(WIDTH - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x))); column++) {
        const x = column + 0.5, y = row + 0.5;
        const l1 = ((x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (y - p0.y)) / area;
        const l2 = ((p1.x - p0.x) * (y - p0.y) - (x - p0.x) * (p1.y - p0.y)) / area;
        const l0 = 1 - l1 - l2;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const q0 = l0 / p0.w, q1 = l1 / p1.w, q2 = l2 / p2.w, sum = q0 + q1 + q2;
        const u = (q0 * p0.u + q1 * p1.u + q2 * p2.u) / sum, v = (q0 * p0.v + q1 * p1.v + q2 * p2.v) / sum;
        const tx = u * width - 0.5, ty = v * height - 0.5, x0 = Math.floor(tx), y0 = Math.floor(ty), fx = tx - x0, fy = ty - y0;
        const texel = [0, 1, 2, 3].map((k) => (at(x0, y0, k) * (1 - fx) + at(x0 + 1, y0, k) * fx) * (1 - fy) + (at(x0, y0 + 1, k) * (1 - fx) + at(x0 + 1, y0 + 1, k) * fx) * fy);
        const alpha = (texel[3] ?? 0) * opacity, o = (row * WIDTH + column) * 3;
        for (let k = 0; k < 3; k++) added[o + k] = (texel[k] ?? 0) * alpha * 255;
      }
    }
  }
  return { quad, corners: projected.map(({ x, y }) => [x, y] as const), box: undefined, added };
}

/** Runs the map headless to the middle of its glow and twin phases and predicts each quad's added light from Wisp's projection of that scene. */
export function oracles(glowTexture: Texels, offset: readonly [number, number] = [0, 0]): Oracle[] {
  const runtime = installHeadless({ filePrefix: "glow6", globalPrefixes: ["__glow6"], intentionalNoops: GLOW_NOOPS });
  const clients = runtime.clients({ install, start }, [0, 1], {});
  clients.start();
  const client = clients.clients[0];
  if (client === undefined) throw new Error("no headless client");
  const scenes: ReturnType<typeof captureScene>[] = [];
  clients.frames(ORACLE_FRAME);
  scenes.push(captureScene(client));
  clients.frames(PHASE_SECONDS * 60);
  scenes.push(captureScene(client));
  runtime.restore();
  const models = fixtureModels();
  const twin = twinTexture();
  const bounds = new Map([GLOW, TWIN].map((path) => [path, boundsModel(parseModelMDX((models.get(path) ?? new Uint8Array()).slice().buffer))]));
  return (["glow", "twin"] as const).map((quad, index) => {
    const scene = scenes[index];
    if (scene === undefined) throw new Error(`no  phase scene`);
    const path = quad === "glow" ? GLOW : TWIN;
    const pose = scene.effects.find((effect) => effect.model === path && effect.y === 0);
    if (pose === undefined) throw new Error(`the ${quad} phase scene doesn't show the ${quad} quad at the origin`);
    const view = camera(scene, WIDTH / HEIGHT);
    const matrix = multiply(multiply(view.projection, view.view), transform(pose));
    const texture = quad === "glow" ? glowTexture : twin;
    const box = sceneBounds(scene, (model) => bounds.get(model), WIDTH, HEIGHT, { image: () => twin, teamGlow: () => glowTexture }).find((row) => row.model === path)?.box;
    const shifted = box === undefined ? undefined : { left: box.left + offset[0], top: box.top + offset[1], right: box.right + offset[0], bottom: box.bottom + offset[1] };
    return { ...predict(quad, matrix, texture, pose.alpha / 255, offset), box: shifted };
  });
}

if (import.meta.main) {
  const [glowPng, out, shift] = process.argv.slice(2);
  if (glowPng === undefined || out === undefined) throw new Error("usage: bun test/glow6/oracle.ts TEAMGLOW00.png OUT_DIR [DX,DY]");
  const [dx = 0, dy = 0] = (shift ?? "0,0").split(",").map(Number);
  const glow = texels(new Uint8Array(await Bun.file(glowPng).arrayBuffer()));
  if (glow === undefined) throw new Error(`${glowPng} isn't a PNG or BLP texture`);
  mkdirSync(out, { recursive: true });
  for (const oracle of oracles(glow, [dx, dy])) {
    writeFileSync(join(out, `${oracle.quad}.f32`), new Uint8Array(oracle.added.buffer));
    writeFileSync(join(out, `${oracle.quad}.json`), `${JSON.stringify({ quad: oracle.quad, width: WIDTH, height: HEIGHT, corners: oracle.corners, box: oracle.box, offset: [dx, dy], peak: peak(oracle.added) }, null, 1)}\n`);
    console.log(oracle.quad, JSON.stringify(oracle.corners.map(([x, y]) => [Number(x.toFixed(2)), Number(y.toFixed(2))])), "box", JSON.stringify(oracle.box), "peak", peak(oracle.added).toFixed(2));
  }
}
