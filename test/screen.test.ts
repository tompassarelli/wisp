import { afterEach, expect, test } from "bun:test";
import { readNativeDeclarations } from "../host/headless/headless";
import { uiReport } from "../host/render/screen";
import { FramePoint, OriginFrame, createFrameByType, namedFrame, originFrame, setFrameAbsPoint, setFrameColor, setFramePoint, setFrameScale, setFrameSize, setFrameTextColor, setFrameTexture } from "../src/game/native/frames";
import type { Frame } from "../src/game/frames";
import { bindWorld } from "../src/game/native/world";
import { HeadlessClient } from "../src/headless/client";
import { MEASURED_1280X720, MEASURED_800X600 } from "./frames125/expected";
import { PLACEMENTS } from "./frames125/layout";

// Player 0 of four: absolute top-left (0.02625, 0.102), size 0.08, one 0.19 slot per player (wisp#125 plan).
// Two players take two slots each with the bust centred, half a slot right.
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


test("[reference makgora#862] a frame painted with a signed JASS colour reaches the window as an unsigned ARGB word", () => {
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "screen", localNatives: {}, network: [], screen: { width: 1280, height: 720 } });
  bindWorld(client.world);
  const portrait = createFrameByType("BACKDROP", "portrait", originFrame(OriginFrame.gameUi, 0), "", 0);
  setFrameColor(portrait, -1);
  setFrameTextColor(portrait, -16744193);
  const row = client.frames.snapshot().find((shown) => shown.name === "portrait");
  expect(row).toMatchObject({ name: "portrait", color: 0xffffffff, textColor: 0xff0080ff });
});
