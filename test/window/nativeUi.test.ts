import { expect, test } from "bun:test";
import type { FrameSnapshot } from "../../src/headless/frames";
import { nativeUi, uiAssets } from "../../host/window/nativeUi";

const frame = (over: Partial<FrameSnapshot>): FrameSnapshot => ({
  handle: { kind: "frame", id: 1 } as FrameSnapshot["handle"], name: "f", type: "BACKDROP", parentId: undefined, rectangle: [0, 0.1, 0.1, 0], text: "", texture: "", color: 0xffffffff, textColor: 0xffffffff,
  alpha: 255, visible: true, level: 0, font: { file: "", height: 0, flags: 0 }, alignment: undefined, scale: 1, plain: true, ...over,
});

test("nativeUi_keeps_only_frames_that_draw", () => {
  const drawn = [frame({ name: "tile", texture: "a.tga" }), frame({ name: "label", text: "x" })];
  const left = [frame({ visible: false, texture: "a.tga" }), frame({ alpha: 0, text: "x" }), frame({ rectangle: undefined, text: "x" }), frame({ name: "bare" })];
  expect(nativeUi([...left, ...drawn]).map((each) => each.name)).toEqual(["tile", "label"]);
});

test("uiAssets_names_each_file_once", () => {
  const ttf = { file: "Fonts\\FRIZQT__.TTF", height: 0.01, flags: 1 };
  const frames = [frame({ texture: "a.tga" }), frame({ texture: "a.tga" }), frame({ text: "x", font: ttf }), frame({ text: "y", font: ttf }), frame({ text: "z", font: { file: "MasterFont", height: 0, flags: 0 } }), frame({ texture: "b.blp", font: ttf })];
  expect(uiAssets(frames)).toEqual(["a.tga", "Fonts\\FRIZQT__.TTF", "b.blp"]);
});
