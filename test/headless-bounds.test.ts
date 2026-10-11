import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Console, Effect, Exit, Layer } from "effect";
import { platformLayer } from "../scripts/platform/layer";
import { makeHeadless } from "../scripts/wisp/commands/headless";
import type { HeadlessRenderProject } from "../scripts/wisp/headlessRender";
import { timingsLayer } from "../scripts/wisp/timings";

const cube = `Version { FormatVersion 800, }
Model "Cube" { NumGeosets 1, NumBones 1, BlendTime 150, }
Sequences 1 { Anim "Stand" { Interval { 0, 1000 }, } }
Textures 1 { Bitmap { Image "", ReplaceableId 1, } }
Materials 1 { Material { Layer { FilterMode None, static TextureID 0, } } }
Geoset {
    Vertices 8 { ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `{ ${i & 1 ? 40 : -40}, ${i & 2 ? 40 : -40}, ${i & 4 ? 80 : 0} },`).join(" ")} }
    Normals 8 { ${"{ 0, 0, 1 }, ".repeat(8)}}
    TVertices 8 { ${"{ 0, 0 }, ".repeat(8)}}
    VertexGroup { ${"0, ".repeat(8)}}
    Faces 1 36 { Triangles { { 0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3 }, } }
    Groups 1 1 { Matrices { 0 }, }
    MaterialID 0,
    SelectionGroup 0,
}
Bone "Root" { ObjectId 0, GeosetId 0, GeosetAnimId None, }
PivotPoints 1 { { 0, 0, 0 }, }
`;
const assets: Record<string, Uint8Array> = { "Cube.mdl": new TextEncoder().encode(cube), "Bust.blp": new Uint8Array([1, 2, 3]) };

// The bust texture's receipt: the cube filling a 128x128 render, whole into a 64x64 texture.
const portrait = {
  scene: { camera: { x: 0, y: 0, fields: { CAMERA_FIELD_TARGET_DISTANCE: 300, CAMERA_FIELD_ZOFFSET: 40 } }, effects: [{ handle: { kind: "effect", id: 1 }, model: "Cube.mdl", created: 0, x: 0, y: 0, z: 0, alpha: 255, scale: 1, timeScale: 1,
    queuedAnimations: [], yaw: 0, pitch: 0, roll: 0, color: [255, 255, 255], teamColor: 0, matrixScale: [1, 1, 1], flat: false, animation: "stand", subAnimations: [], animationElapsed: 0, animationClock: 0, animationBlendTime: 0, animationBlend: undefined }] },
  width: 128, height: 128, crop: { x: 0, y: 0, width: 128, height: 128 }, texture: { width: 64, height: 64 }, parts: { head: ["Root"], weapon: [] },
} as unknown as NonNullable<HeadlessRenderProject["portraits"]>[string];

test("[boundary] wisp headless --bounds writes frame rows with their portraits' in-frame verdict and posed model rows for every requested frame and client, without Chrome", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wisp-bounds-"));
  const command = makeHeadless(async () => ({
    map: { filePrefix: "bounds", globalPrefixes: ["__bounds"] },
    entry: join(import.meta.dir, "bounds/entry.ts"),
    journeys: { still: { frames: 30, events: [] } },
    render: {
      readAsset: async () => { throw new Error("--bounds reads through resolveAsset"); },
      resolveAsset: async (path, graphics) => {
        const bytes = assets[path];
        const selected = bytes === undefined ? undefined : { source: "map" as const, layer: "_de.w3mod" as const, path };
        return { requested: path, graphics, attempts: selected === undefined ? [] : [selected], selected, bytes };
      },
      chrome: "/nonexistent/chrome",
      portraits: { "Bust.blp": portrait },
    },
  }));
  const exit = await Effect.runPromiseExit(command(["--bounds", directory, "--frames", "1", "30", "--resolution", "800x600", "--graphics", "definitive"]).pipe(
    Effect.provide(Layer.merge(timingsLayer(() => undefined), platformLayer())),
    Effect.provideService(Console.Console, { ...console, log: () => undefined }),
  ));
  expect(Exit.isSuccess(exit)).toBe(true);
  const report = JSON.parse(readFileSync(join(directory, "bounds.json"), "utf8"));
  expect(report).toMatchObject({ graphics: "definitive", width: 800, height: 600 });
  expect(report.images.map((image: { client: number; frame: number }) => `${image.client}@${image.frame}`).sort()).toEqual(["0@1", "0@30", "1@1", "1@30"]);
  const sha256 = new Bun.CryptoHasher("sha256").update(assets["Bust.blp"] ?? new Uint8Array()).digest("hex");
  for (const image of report.images) {
    const [frame, ...others] = image.ui;
    expect(others).toEqual([]);
    expect(frame).toMatchObject({ name: "bust", type: "BACKDROP", texture: "Bust.blp", layer: "_de.w3mod", sha256, region: [0, 0, 1, 1], outside43: false });
    expect(frame.inFrame.headHiddenByWeapon).toBe(0);
    expect(frame.inFrame.parts.head.pixels).toBeGreaterThan(100);
    expect(frame.inFrame.parts.head.box.left).toBeGreaterThanOrEqual(26);
    expect(frame.inFrame.parts.head.box.bottom).toBeLessThanOrEqual(578);
    expect(frame.inFrame.crownMargin).toBe(frame.inFrame.parts.head.box.top - 498);
    for (const [actual, expected] of [[frame.pixels.x, 26.25], [frame.pixels.y, 498], [frame.pixels.width, 80], [frame.pixels.height, 80]]) expect(actual).toBeCloseTo(expected, 4);
    const [effect, ...rest] = image.models;
    expect(rest).toEqual([]);
    expect(effect).toMatchObject({ model: "Cube.mdl", unit: false, offFrame: false, behindEye: false, farCulled: false });
    expect(effect.box.right - effect.box.left).toBeGreaterThan(0);
    expect(effect.box.bottom - effect.box.top).toBeGreaterThan(0);
  }
});
