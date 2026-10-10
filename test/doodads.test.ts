import { expect, test } from "bun:test";
import { join } from "node:path";
import { decodeDoodads } from "../scripts/wisp/doodads";
import { sceneWithUnits, type RenderScene } from "../scripts/wisp/headlessRender";

// Fixture placements use WC3MapSpecification/Doodads/8_11.md.
function placements(skinIds = true, visible = true): Uint8Array {
  const bytes: number[] = [];
  const id = (value: string) => bytes.push(...[...value].map((c) => c.charCodeAt(0)));
  const number = (value: number, float = false) => { const b = new Uint8Array(4), v = new DataView(b.buffer); if (float) v.setFloat32(0, value, true); else v.setInt32(0, value, true); bytes.push(...b); };
  id("W3do"); number(8); number(11); number(2);
  for (let index = 0; index < 2; index++) {
    id("TEST"); number(index);
    for (const value of [100 + index * 5000, 200, 30, Math.PI / 2, 2, 3, 4]) number(value, true);
    if (skinIds) id("SKIN");
    bytes.push(visible ? 6 : 4, 100);
    number(-1); number(index === 0 ? 1 : 0);
    if (index === 0) { number(1); id("ITEM"); number(100); }
    number(index);
  }
  number(0); number(0);
  return new Uint8Array(bytes);
}

const scene: RenderScene = { frame: 60, client: 0, effects: [], units: [], ui: [],
  camera: { x: 0, y: 0, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 270, CAMERA_FIELD_TARGET_DISTANCE: 300 } },
  environment: { sky: "", skyVisible: false, terrainVisible: false, dayNight: { terrain: "", unit: "" }, timeOfDay: 12 } };

test("[reference] doodad 8/11 skin and legacy records retain placements after item sets and join the scene at the map origin with their skin variations", () => {
  for (const skinIds of [true, false]) {
    const rows = decodeDoodads(placements(skinIds), skinIds);
    expect(rows.map((row) => [row.type, row.skin, row.variation, row.x, row.y, row.z, row.scale, row.visible])).toEqual([
      ["TEST", skinIds ? "SKIN" : "TEST", 0, 100, 200, 30, [2, 3, 4], true],
      ["TEST", skinIds ? "SKIN" : "TEST", 1, 5100, 200, 30, [2, 3, 4], true],
    ]);
    expect(rows[0]?.angle).toBeCloseTo(Math.PI / 2, 6);
  }
  {
    const project = { readAsset: async () => undefined, terrain: { origin: [100, 200] as const }, doodads: { doo: placements(), models: { SKIN: ["first.mdx", "second.mdx"] } } };
    const poses = sceneWithUnits(project, scene).effects;
    expect(poses.map((pose) => [pose.model, pose.x, pose.y, pose.z, pose.matrixScale, pose.animation])).toEqual([
      ["first.mdx", 0, 0, 30, [2, 3, 4], "stand"], ["second.mdx", 5000, 0, 30, [2, 3, 4], "stand"],
    ]);
    expect(sceneWithUnits({ ...project, doodads: { ...project.doodads, doo: placements(true, false) } }, scene).effects).toEqual([]);
  }
});
