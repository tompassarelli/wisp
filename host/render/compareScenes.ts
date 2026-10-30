import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { Schema } from "effect";
import { generateMDX, parseMDL } from "../../vendor/war3-model.mjs";
import { freshAnimation } from "../../src/game/native/animation";
import type { RenderScene } from "./renderScene";

const Camera = Schema.Struct({
  x: Schema.Finite, y: Schema.Finite, distance: Schema.Finite, angleOfAttack: Schema.Finite, rotation: Schema.Finite,
});
const Texture = Schema.Struct({ path: Schema.String, size: Schema.Finite, cell: Schema.Finite });
const Pose = Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite, yaw: Schema.Finite, teamColor: Schema.Finite });
const SceneSpec = Schema.Struct({ name: Schema.String, model: Schema.String, texture: Schema.optional(Texture), camera: Camera, pose: Pose });
const SceneList = Schema.Struct({ width: Schema.Finite, height: Schema.Finite, scenes: Schema.Array(SceneSpec) });

export type SceneSpec = typeof SceneSpec.Type;
export type SceneList = typeof SceneList.Type;

export const readSceneList = async (file: string): Promise<{ readonly list: SceneList; readonly models: Map<string, Uint8Array> }> => {
  const list = Schema.decodeUnknownSync(SceneList)(JSON.parse(await readFile(file, "utf8")));
  const models = new Map<string, Uint8Array>();
  for (const spec of list.scenes) {
    models.set(modelPath(spec), new Uint8Array(generateMDX(parseMDL(await readFile(resolve(spec.model), "utf8")))));
    if (spec.texture !== undefined) models.set(spec.texture.path, checkerPng(spec.texture.size, spec.texture.cell));
  }
  return { list, models };
};

export const modelPath = (spec: SceneSpec) => `war3mapImported\\${spec.name}.mdx`;

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (bytes: Uint8Array) => { let c = 0xffffffff; for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
};

/** A deterministic `size`-square RGB checker of `cell`-pixel cells, shaded by a diagonal ramp so filtering and mip selection have gradients to blur. */
export const checkerPng = (size: number, cell: number): Uint8Array => {
  const raw = new Uint8Array((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0, ramp = Math.round(255 * (x + y) / (2 * size - 2)), at = y * (size * 3 + 1) + 1 + x * 3;
    raw[at] = on ? 255 : 24; raw[at + 1] = on ? ramp : 255 - ramp; raw[at + 2] = on ? 40 : 200;
  }
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, size); view.setUint32(4, size); header[8] = 8; header[9] = 2;
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  return Uint8Array.from(parts.flatMap((part) => [...part]));
};

export const sceneOf = (spec: SceneSpec, frame: number): RenderScene => ({
  frame, client: 0, units: [], ui: [], effects: [{
    ...freshAnimation(), animation: "Stand", handle: { kind: "effect", id: frame + 1 }, model: modelPath(spec), created: 0,
    x: spec.pose.x, y: spec.pose.y, z: spec.pose.z, alpha: 255, scale: 1, timeScale: 1, queuedAnimations: [], yaw: spec.pose.yaw, pitch: 0, roll: 0,
    color: [255, 255, 255], teamColor: spec.pose.teamColor, matrixScale: [1, 1, 1], flat: false,
  }],
  camera: { x: spec.camera.x, y: spec.camera.y, fields: { CAMERA_FIELD_TARGET_DISTANCE: spec.camera.distance, CAMERA_FIELD_ANGLE_OF_ATTACK: spec.camera.angleOfAttack, CAMERA_FIELD_ROTATION: spec.camera.rotation } },
  environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 },
});
