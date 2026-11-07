import { afterEach, expect, test } from "bun:test";
import { readNativeDeclarations } from "../host/headless/headless";
import { multiply } from "../host/browser/matrix";
import type { RenderScene } from "../host/render/headlessRender";
import { camera, uiPixels, uiReport } from "../host/render/screen";
import { FramePoint, OriginFrame, createFrameByType, namedFrame, originFrame, setFrameAbsPoint, setFrameColor, setFrameLevel, setFramePoint, setFrameScale, setFrameSize, setFrameTextColor, setFrameTexture } from "../src/game/native/frames";
import type { Frame, FrameKind } from "../src/game/frames";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { MEASURED_1280X720, MEASURED_800X600 } from "./frames125/expected";
import { PLACEMENTS } from "./frames125/layout";

// Player 0 of four: absolute top-left (0.02625, 0.102), size 0.08, one 0.19 slot per player (wisp#125 plan).
// Two players take two slots each with the bust centred, half a slot right.
const bust = (slot: number) => [0.02625 + 0.19 * slot, 0.102, 0.02625 + 0.19 * slot + 0.08, 0.102 - 0.08] as const;
afterEach(() => { bindWorld(undefined); });

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

test("[reference makgora#862] a frame painted with a signed JASS colour reaches the window as an unsigned ARGB word", () => {
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "screen", localNatives: {}, network: [], screen: { width: 1280, height: 720 } });
  bindWorld(client.world);
  const portrait = createFrameByType("BACKDROP", "portrait", originFrame(OriginFrame.gameUi, 0), "", 0);
  setFrameColor(portrait, -1);
  setFrameTextColor(portrait, -16744193);
  const row = client.frames.snapshot().find((shown) => shown.name === "portrait");
  expect(row).toMatchObject({ name: "portrait", color: 0xffffffff, textColor: 0xff0080ff });
});
