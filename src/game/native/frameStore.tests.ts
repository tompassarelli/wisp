import { assertEquals, assertLessThan, test } from "../../runtime/testing";
import { FRAME_POINTS, Frames, type FrameSnapshot } from "./frameStore";
import { FrameUi } from "./frameUi";

const points = new Map<unknown, readonly [number, number]>(FRAME_POINTS.map(([name, fromLeft, fromTop]) => [name, [fromLeft, fromTop] as const]));

function world() {
  const frames = new Frames(points);
  frames.define([{
    name: "Arch", type: "SIMPLEFRAME", width: 0.25, height: 0.125,
    textures: [
      { key: "tile", layer: "BACKGROUND", file: "tile.blp", texCoord: [0.5, 1, 0, 0.5] },
      { key: "first", layer: "ARTWORK", file: "first.blp" },
      { key: "second", layer: "ARTWORK", file: "second.blp", width: 0.0625, height: 0.0625, anchor: { point: "TOPLEFT", x: 0.0625, y: -0.0625 } },
      { key: "over", layer: "ARTWORK", file: "over.blp" },
    ],
  }]);
  let id = 0;
  const ui = new FrameUi(() => frames, (kind) => ({ kind, id: ++id }), () => undefined, { width: 800, height: 600 });
  const row = (name: string): FrameSnapshot => {
    for (const each of frames.snapshot()) if (each.name === name) return each;
    throw new Error(`no frame ${name}`);
  };
  return { frames, ui, row };
}

const box = (frame: FrameSnapshot) => (frame.rectangle ?? []).join(",");

test("[scenario] a simple frame's textures keep their texCoord through SetTexture, follow the frame, and draw beneath every other frame by layer", () => {
  const { ui, row } = world();
  const hud = ui.createByType("BACKDROP", "Hud", undefined, "", 0);
  ui.setLevel(hud, -50);
  const arch = ui.createSimple("Arch", undefined, 0);
  ui.setAbsPoint(arch, "FRAMEPOINT_TOPLEFT", 0.25, 0.75);

  const tile = ui.named("ArchTile", 0);
  assertEquals(tile.type, "TEXTURE");
  assertEquals(row("ArchTile").uv?.join(","), "0.5,0,1,0.5");
  assertEquals(row("ArchTile").texture, "tile.blp");
  assertEquals(row("ArchOver").uv, undefined);
  assertEquals(box(row("ArchTile")), "0.25,0.75,0.5,0.625");
  assertEquals(box(row("ArchSecond")), "0.3125,0.6875,0.375,0.625");

  ui.setTexture(tile, "other.blp");
  assertEquals(row("ArchTile").texture, "other.blp");
  assertEquals(row("ArchTile").uv?.join(","), "0.5,0,1,0.5");

  assertLessThan(row("ArchOver").level, row("Hud").level);
  assertLessThan(row("ArchTile").level, row("ArchFirst").level);
  assertEquals(row("ArchFirst").level, row("ArchSecond").level);
  assertEquals(row("ArchSecond").level, row("ArchOver").level);

  ui.setSize(arch, 0.5, 0.25);
  assertEquals(box(row("ArchTile")), "0.25,0.75,0.75,0.5");
  ui.setAlpha(arch, 128);
  assertEquals(row("ArchTile").alpha, 128);
  ui.setVisible(arch, false);
  assertEquals(row("ArchTile").visible, false);
});

test("a hit test asks whether a frame takes clicks only of a shown frame under the point, so hidden frames cost a match nothing per step", () => {
  const { frames, ui } = world();
  const place = (name: string, visible: boolean) => {
    const frame = ui.createByType("BUTTON", name, undefined, "", 0);
    ui.setSize(frame, 0.25, 0.125);
    ui.setAbsPoint(frame, "FRAMEPOINT_TOPLEFT", 0.25, 0.5);
    ui.setVisible(frame, visible);
    return frame;
  };
  for (let index = 0; index < 50; index++) place(`Hidden${index}`, false);
  const shown = place("Shown", true);
  const elsewhere = ui.createByType("BUTTON", "Elsewhere", undefined, "", 0);
  ui.setSize(elsewhere, 0.0625, 0.0625);
  ui.setAbsPoint(elsewhere, "FRAMEPOINT_TOPLEFT", 0.625, 0.25);
  const asked: string[] = [];
  const found = frames.at(0.3125, 0.4375, (frame) => { asked.push(frame.name); return true; });
  assertEquals(found, shown);
  assertEquals(asked.join(","), "Shown");
});
