import { afterEach, expect, test } from "bun:test";
import { readNativeDeclarations } from "../host/headless/headless";
import { multiply } from "../host/browser/matrix";
import type { DrawnPose, RenderScene } from "../host/render/headlessRender";
import { camera, transform, uiPixels, uiReport } from "../host/render/screen";
import type { FrameDefinition } from "../host/compile/frames";
import { FramePoint, OriginFrame, createFrameByType, createSimpleFrame, namedFrame, originFrame, setFrameAbsPoint, setFrameColor, setFrameLevel, setFramePoint, setFrameScale, setFrameSize, setFrameTextColor, setFrameTexture, setFrameVisible } from "../src/game/native/frames";
import type { Frame, FrameKind } from "../src/game/frames";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { MEASURED_1280X720, MEASURED_800X600 } from "./frames125/expected";
import { PLACEMENTS } from "./frames125/layout";

// Player 0 of four: absolute top-left (0.02625, 0.102), size 0.08, one 0.19 slot per player (wisp#125 plan).
// Two players take two slots each with the bust centred, half a slot right.
const bust = (slot: number) => [0.02625 + 0.19 * slot, 0.102, 0.02625 + 0.19 * slot + 0.08, 0.102 - 0.08] as const;
afterEach(() => { bindWorld(undefined); });

test("[reference makgora#363] HUD bust rectangles match native captures", () => {
  const near = (rect: ReturnType<typeof uiPixels>, x: number, y: number, size: number) => {
    for (const [actual, expected] of [[rect.x, x], [rect.y, y], [rect.width, size], [rect.height, size]] as const) expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  };
  for (const p of [0, 1]) near(uiPixels(bust(2 * p + 0.5), 800, 600), 121.25 + 380 * p, 498, 80);
  for (const p of [0, 1, 2, 3]) near(uiPixels(bust(p), 1280, 720), 191.5 + 228 * p, 597.6, 96);
});

test("[reference makgora#363] a BACKDROP bust reports its native rectangle and its whole texture at both resolutions", () => {
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "screen", localNatives: {}, network: [], screen: { width: 1280, height: 720 } });
  bindWorld(client.world);
  const frame = (name: string) => {
    const created = createFrameByType("BACKDROP", name, originFrame(OriginFrame.gameUi, 0), "", 0);
    setFrameAbsPoint(created, FramePoint.topLeft, 0.02625, 0.102);
    setFrameSize(created, 0.08, 0.08);
    setFrameTexture(created, "Bust.blp", 0, true);
    return created;
  };
  frame("bust");
  setFrameVisible(frame("hidden"), false);
  const identity = { layer: "base", sha256: "ab".repeat(32) };
  for (const [width, height, x, y, size] of [[1280, 720, 191.5, 597.6, 96], [800, 600, 26.25, 498, 80]] as const) {
    const [row, ...rest] = uiReport({ ui: client.frames.snapshot() }, width, height, (path) => (path === "Bust.blp" ? identity : undefined));
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ name: "bust", type: "BACKDROP", texture: "Bust.blp", ...identity, region: [0, 0, 1, 1], outside43: false });
    for (const [actual, expected] of [[row?.pixels.x, x], [row?.pixels.y, y], [row?.pixels.width, size], [row?.pixels.height, size]] as const) expect(actual).toBeCloseTo(expected, 4);
  }
});

test("[scenario] a SIMPLEFRAME texture with a TexCoord reports its sub-rectangle region and draws beneath a BACKDROP at a higher level", () => {
  const arch: FrameDefinition = { name: "Arch", type: "SIMPLEFRAME", width: 0.25, height: 0.125, textures: [{ key: "tile", layer: "BACKGROUND", file: "Tile.blp", texCoord: [0.5, 1, 0, 0.5] }] };
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "screen", localNatives: {}, network: [], screen: { width: 1280, height: 720 }, frames: [arch] });
  bindWorld(client.world);
  const backdrop = createFrameByType("BACKDROP", "plate", originFrame(OriginFrame.gameUi, 0), "", 0);
  setFrameAbsPoint(backdrop, FramePoint.topLeft, 0.25, 0.75);
  setFrameSize(backdrop, 0.25, 0.125);
  setFrameTexture(backdrop, "Plate.blp", 0, true);
  setFrameLevel(backdrop, -3);
  const simple = createSimpleFrame("Arch", originFrame(OriginFrame.gameUi, 0), 0);
  setFrameAbsPoint(simple, FramePoint.topLeft, 0.25, 0.75);
  const rows = uiReport({ ui: client.frames.snapshot() }, 1280, 720);
  expect(rows.filter((row) => row.texture !== null).map((row) => [row.name, row.type, row.texture, row.region])).toEqual([
    ["ArchTile", "TEXTURE", "Tile.blp", [0.5, 0, 1, 0.5]],
    ["plate", "BACKDROP", "Plate.blp", [0, 0, 1, 1]],
  ]);
  expect(rows.find((row) => row.name === "ArchTile")?.ui).toEqual([0.25, 0.75, 0.5, 0.625]);
});

test("[reference wisp#125] frames125 boxes match native at 800x600 and 1280x720: frame scale and the 4:3 area", () => {
  const client = new HeadlessClient({ screen: { width: 1920, height: 1080 }, slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "frames125", localNatives: {}, network: [] });
  bindWorld(client.world);
  const created = new Map<string, Frame>();
  const gameUi = originFrame(OriginFrame.gameUi, 0);
  // As test/frames125/main.ts places them.
  for (const placement of PLACEMENTS) {
    const parent = placement.parent === "console" ? namedFrame("ConsoleUIBackdrop", 0) : placement.parent === "red" ? created.get("abs-scaled") : gameUi;
    const frame = createFrameByType("BACKDROP", `Wisp125${placement.name}`, parent, "", 0);
    setFrameTexture(frame, placement.texture, 0, true);
    setFrameSize(frame, placement.size, placement.size);
    if (placement.scale !== 1) setFrameScale(frame, placement.scale);
    const point = placement.point === "center" ? FramePoint.center : FramePoint.topLeft;
    if (placement.abs !== undefined) setFrameAbsPoint(frame, point, placement.abs[0], placement.abs[1]);
    const relative = placement.relative;
    if (relative !== undefined) setFramePoint(frame, point, created.get(relative.to) as Frame, relative.to === "anchor" ? FramePoint.bottomRight : FramePoint.topRight, relative.x, relative.y);
    created.set(placement.name, frame);
  }
  for (const [width, height, measured] of [[800, 600, MEASURED_800X600], [1276, 716, MEASURED_1280X720]] as const) {
    const rows = new Map(uiReport({ ui: client.frames.snapshot() }, width, height).map((row) => [row.name.slice("Wisp125".length), row.pixels]));
    for (const [name, box] of Object.entries(measured)) {
      const pixels = rows.get(name);
      if (box === "gone") expect({ name, width, pixels }).toEqual({ name, width, pixels: undefined });
      else for (const key of ["x", "y", "width", "height"] as const) expect({ name, width, key, off: Math.abs((pixels?.[key] ?? Infinity) - box[key]) <= 1 }).toEqual({ name, width, key, off: true });
    }
  }
});

// wisp#125 box N's native reads (build 3.0.0.24268, Classic 1920x1080) and the first StageMainDeck pixel of each hidden capture.
type DeckRead = readonly [fixture: string, frame: number, fov: number, eye: readonly [number, number, number], target: readonly [number, number], top: number, left: readonly [number, number], right: readonly [number, number] | null];
const DECK_READS: readonly DeckRead[] = [
  ["i432-mk-stop", 130, 1.09859, [-174.0, -1165.2, 2017.6], [-174.0, 1857.3], 606, [703, 235], null],
  ["i432-mk-stop", 135, 1.09859, [-203.7, -1204.1, 2022.8], [-203.7, 1855.7], 601, [693, 314], null],
  ["i432-mk-stop", 140, 1.09859, [-228.6, -1233.9, 2026.6], [-228.6, 1854.1], 597, [686, 374], null],
  ["i432-mk-stop", 145, 1.09859, [-249.5, -1259.1, 2029.6], [-249.5, 1852.8], 594, [680, 421], null],
  ["i432-mk-stop", 150, 1.09859, [-266.3, -1276.8, 2031.6], [-266.3, 1851.6], 591, [676, 456], null],
  ["i440-warden-fair-right", 57, 1.09810, [0.1, -1236.5, 2051.9], [0.1, 1879.0], 631, [723, 19], [723, 1901]],
  ["i440-warden-fair-right", 58, 1.09815, [0.2, -1237.4, 2052.7], [0.2, 1879.7], 632, [724, 20], [724, 1899]],
  ["i440-warden-fair-right", 60, 1.09824, [0.5, -1237.8, 2054.2], [0.5, 1881.1], 634, [726, 20], [726, 1898]],
  ["i440-warden-fair-right", 61, 1.09827, [0.7, -1237.4, 2054.9], [0.7, 1881.8], 635, [727, 20], [727, 1898]],
  ["i440-warden-fair-right", 62, 1.09830, [0.8, -1236.6, 2055.4], [0.8, 1882.5], 636, [728, 19], [728, 1898]],
  ["i440-warden-fair-right", 63, 1.09833, [1.0, -1235.4, 2055.9], [1.0, 1883.2], 637, [730, 18], [730, 1899]],
  ["i440-warden-nair-right", 64, 1.09836, [0.0, -1234.0, 2056.2], [0.0, 1883.8], 638, [731, 18], [731, 1902]],
  ["i440-warden-nair-right", 65, 1.09838, [0.0, -1232.2, 2056.4], [0.0, 1884.3], 639, [732, 16], [732, 1904]],
  ["i440-warden-nair-right", 66, 1.09840, [0.0, -1230.1, 2056.5], [0.0, 1884.8], 639, [733, 14], [733, 1906]],
  ["i440-warden-nair-right", 67, 1.09842, [0.0, -1227.6, 2056.4], [0.0, 1885.1], 640, [734, 12], [734, 1908]],
  ["i440-warden-nair-right", 68, 1.09844, [0.0, -1224.9, 2056.2], [0.0, 1885.4], 641, [735, 9], [735, 1911]],
  ["i440-warden-nair-right", 70, 1.09847, [0.0, -1218.2, 2055.1], [0.0, 1885.5], 642, [737, 2], [737, 1918]],
];
const DECK_Z = 1800, DECK_X = 600, DECK_Y = 60, CORNER_DEPTH = 63;
const READ_TARGET_Y = -256, MAP_TARGET_Y = 0;

test("[reference wisp#125] world projection matches native at 1920x1080", () => {
  for (const [fixture, frame, fov, eye, [targetX, targetZ], top, left, right] of DECK_READS) {
    const run = Math.hypot(eye[0] - targetX, eye[1] - READ_TARGET_Y), rise = targetZ - eye[2];
    const scene = { camera: { x: targetX, y: MAP_TARGET_Y, fields: { CAMERA_FIELD_ROTATION: 90, CAMERA_FIELD_ANGLE_OF_ATTACK: 360 + Math.atan2(rise, run) * 180 / Math.PI, CAMERA_FIELD_TARGET_DISTANCE: Math.hypot(run, rise), CAMERA_FIELD_ZOFFSET: targetZ, CAMERA_FIELD_FIELD_OF_VIEW: fov * 180 / Math.PI, CAMERA_FIELD_FARZ: 13000 } } } as unknown as RenderScene;
    const view = camera(scene, 1920 / 1080), m = multiply(view.projection, view.view);
    const pixel = (x: number, y: number, z: number) => {
      const w = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0);
      return [(((m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0)) / w + 1) * 960, (1 - ((m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0)) / w) * 540] as const;
    };
    const cornerAt = (x: number, row: number) => {
      const [ax, ay] = pixel(x, -DECK_Y, DECK_Z), [bx, by] = pixel(x, -DECK_Y, DECK_Z - CORNER_DEPTH);
      return ax + (bx - ax) * (row + 0.5 - ay) / (by - ay);
    };
    const edges = { top: [pixel(0, DECK_Y, DECK_Z)[1], top], left: [cornerAt(-DECK_X, left[0]), left[1]], ...(right === null ? {} : { right: [cornerAt(DECK_X, right[0]), right[1]] }) };
    for (const [edge, [wisp, native]] of Object.entries(edges)) expect({ fixture, frame, edge, within1px: Math.abs((wisp ?? NaN) - (native ?? NaN)) <= 1 }).toEqual({ fixture, frame, edge, within1px: true });
  }
});

test("[reference wisp#46] an effect draws at the scale and position its map set: scale about its origin, Z as given", () => {
  const pose = { x: -240, y: -12, z: 1842, yaw: 0, pitch: 0, roll: 0, scale: 2, matrixScale: [1, 1, 1] } as unknown as DrawnPose;
  const placed = transform(pose);
  const at = (point: readonly [number, number, number]) => [0, 1, 2].map((row) => (placed[row] ?? 0) * point[0] + (placed[4 + row] ?? 0) * point[1] + (placed[8 + row] ?? 0) * point[2] + (placed[12 + row] ?? 0));
  expect(at([0, 0, 0])).toEqual([-240, -12, 1842]);
  expect(at([30, 0, 47])).toEqual([-180, -12, 1936]);
});

test("[reference wisp-standalone-menu] a child of a raised panel draws above a lower-level sibling, and a button's text is centred", () => {
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "screen", localNatives: {}, network: [], screen: { width: 1280, height: 720 } });
  bindWorld(client.world);
  const frame = (type: FrameKind, name: string, owner?: Frame) => {
    const created = createFrameByType(type, name, owner ?? originFrame(OriginFrame.gameUi, 0), "", 0);
    setFrameAbsPoint(created, FramePoint.topLeft, 0.1, 0.5);
    setFrameSize(created, 0.2, 0.05);
    return created;
  };
  const chip = frame("BACKDROP", "Chip");
  setFrameLevel(chip, 10);
  const panel = frame("BACKDROP", "Panel");
  setFrameLevel(panel, 20);
  frame("TEXT", "PanelText", panel);
  frame("GLUETEXTBUTTON", "PanelButton", panel);
  const rows = new Map(client.frames.snapshot().map((row) => [row.name, row]));
  expect(rows.get("PanelText")!.level).toBeGreaterThan(rows.get("Chip")!.level);
  expect(rows.get("PanelButton")!.level).toBeGreaterThan(rows.get("Chip")!.level);
  expect(rows.get("PanelButton")!.alignment).toEqual({ vertical: "middle", horizontal: "center" });
  expect(rows.get("PanelText")!.alignment).toBeUndefined();
});

test("[reference makgora#862] a frame painted with a signed JASS colour reaches the window as an unsigned ARGB word", () => {
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "screen", localNatives: {}, network: [], screen: { width: 1280, height: 720 } });
  bindWorld(client.world);
  const portrait = createFrameByType("BACKDROP", "portrait", originFrame(OriginFrame.gameUi, 0), "", 0);
  setFrameColor(portrait, -1);
  setFrameTextColor(portrait, -16744193);
  const row = client.frames.snapshot().find((shown) => shown.name === "portrait");
  expect(row).toMatchObject({ name: "portrait", color: 0xffffffff, textColor: 0xff0080ff });
});
