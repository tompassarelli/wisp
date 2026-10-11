import { expect, test } from "bun:test";
import { readNativeDeclarations } from "../scripts/wisp/headless";
import { uiPixels, uiReport } from "../scripts/wisp/screen";
import { HeadlessClient } from "../src/headless/client";
import { MEASURED_1280X720, MEASURED_800X600 } from "./frames125/expected";
import { PLACEMENTS } from "./frames125/layout";

// Player 0 of four: absolute top-left (0.02625, 0.102), size 0.08, one 0.19 slot per player (wisp#125 plan).
// Two players take two slots each with the bust centred, half a slot right.
const bust = (slot: number) => [0.02625 + 0.19 * slot, 0.102, 0.02625 + 0.19 * slot + 0.08, 0.102 - 0.08] as const;

test("[reference smashcraft#363] HUD bust rectangles match native captures", () => {
  const near = (rect: ReturnType<typeof uiPixels>, x: number, y: number, size: number) => {
    for (const [actual, expected] of [[rect.x, x], [rect.y, y], [rect.width, size], [rect.height, size]] as const) expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);
  };
  for (const p of [0, 1]) near(uiPixels(bust(2 * p + 0.5), 800, 600), 121.25 + 380 * p, 498, 80);
  for (const p of [0, 1, 2, 3]) near(uiPixels(bust(p), 1280, 720), 191.5 + 228 * p, 597.6, 96);
});

test("[reference smashcraft#363] a BACKDROP bust reports its native rectangle and its whole texture at both resolutions", () => {
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "screen", localNatives: {}, network: [], screen: { width: 1280, height: 720 } });
  const call = (name: string, ...args: unknown[]) => (client.natives[name] as (this: void, ...args: unknown[]) => unknown)(...args);
  const frame = (name: string) => {
    const created = call("BlzCreateFrameByType", "BACKDROP", name, undefined, "", 0);
    call("BlzFrameSetAbsPoint", created, 0, 0.02625, 0.102);
    call("BlzFrameSetSize", created, 0.08, 0.08);
    call("BlzFrameSetTexture", created, "Bust.blp", 0, true);
    return created;
  };
  frame("bust");
  call("BlzFrameSetVisible", frame("hidden"), false);
  const identity = { layer: "_de.w3mod", sha256: "ab".repeat(32) };
  for (const [width, height, x, y, size] of [[1280, 720, 191.5, 597.6, 96], [800, 600, 26.25, 498, 80]] as const) {
    const [row, ...rest] = uiReport({ ui: client.frames.snapshot() }, width, height, (path) => (path === "Bust.blp" ? identity : undefined));
    expect(rest).toEqual([]);
    expect(row).toMatchObject({ name: "bust", type: "BACKDROP", texture: "Bust.blp", ...identity, region: [0, 0, 1, 1], outside43: false });
    for (const [actual, expected] of [[row?.pixels.x, x], [row?.pixels.y, y], [row?.pixels.width, size], [row?.pixels.height, size]] as const) expect(actual).toBeCloseTo(expected, 4);
  }
});

test("[reference wisp#125] frames125 boxes match native at 800x600 and 1280x720: frame scale and the 4:3 area", () => {
  const client = new HeadlessClient({ slot: 0, humans: [0], declarations: readNativeDeclarations(), filePrefix: "frames125", localNatives: {}, network: [] });
  const call = (name: string, ...args: unknown[]) => (client.natives[name] as (this: void, ...args: unknown[]) => unknown)(...args);
  const created = new Map<string, unknown>();
  const gameUi = call("BlzGetOriginFrame", client.natives.ORIGIN_FRAME_GAME_UI, 0);
  // As test/frames125/main.ts places them.
  for (const placement of PLACEMENTS) {
    const parent = placement.parent === "console" ? call("BlzGetFrameByName", "ConsoleUIBackdrop", 0) : placement.parent === "red" ? created.get("abs-scaled") : gameUi;
    const frame = call("BlzCreateFrameByType", "BACKDROP", `Wisp125${placement.name}`, parent, "", 0);
    call("BlzFrameSetTexture", frame, placement.texture, 0, true);
    call("BlzFrameSetSize", frame, placement.size, placement.size);
    if (placement.scale !== 1) call("BlzFrameSetScale", frame, placement.scale);
    const point = client.natives[placement.point === "center" ? "FRAMEPOINT_CENTER" : "FRAMEPOINT_TOPLEFT"];
    if (placement.abs !== undefined) call("BlzFrameSetAbsPoint", frame, point, placement.abs[0], placement.abs[1]);
    const relative = placement.relative;
    if (relative !== undefined) call("BlzFrameSetPoint", frame, point, created.get(relative.to), client.natives[relative.to === "anchor" ? "FRAMEPOINT_BOTTOMRIGHT" : "FRAMEPOINT_TOPRIGHT"], relative.x, relative.y);
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
