import { expect, test } from "bun:test";
import { FRAME_POINTS, Frames, type Frame } from "../src/game/native/frameStore";

const points = new Map<unknown, readonly [number, number]>(FRAME_POINTS.map(([name, fromLeft, fromTop]) => [name, [fromLeft, fromTop] as const]));

function cycleTree(dFirst: boolean) {
  const frames = new Frames(points);
  let id = 0;
  const add = (name: string, parent?: Frame) => {
    const frame = frames.add({ kind: "frame", id: ++id } as never, "BACKDROP", name, parent, 0);
    frame.width = 0.1;
    frame.height = 0.05;
    return frame;
  };
  const root = add("Root");
  root.points.set("FRAMEPOINT_TOPLEFT", { x: 0.1, y: 0.5 });
  const a = add("A", root);
  a.anchors.push({ point: "TOPLEFT", relative: root, relativePoint: "BOTTOMRIGHT", x: 0.01, y: 0 });
  const [c, d] = dFirst ? (() => { const d = add("D", root); return [add("C", root), d] as const; })() : [add("C", root), add("D", root)] as const;
  d.points.set("FRAMEPOINT_BOTTOMLEFT", { x: 0.3, y: 0.2 });
  c.anchors.push({ point: "TOPLEFT", relative: a, relativePoint: "BOTTOMLEFT", x: 0, y: -0.01 });
  c.anchors.push({ point: "BOTTOMRIGHT", relative: d, relativePoint: "TOPRIGHT", x: 0, y: 0 });
  d.anchors.push({ point: "TOPLEFT", relative: c, relativePoint: "BOTTOMLEFT", x: 0.02, y: 0 });
  return frames;
}

const rectangles = (frames: Frames) => Object.fromEntries(frames.snapshot().map((row) => [row.name, row.rectangle?.map((value) => Number(value.toFixed(6)))]));

test("a frame in an anchor cycle is placed by its own walk, whichever cycle member the read reaches first", () => {
  const expected = { Root: [0.1, 0.5, 0.2, 0.45], A: [0.21, 0.45, 0.31, 0.4], C: [0.21, 0.39, 0.4, 0.25], D: [0.23, 0.34, 0.4, 0.2] };
  expect(rectangles(cycleTree(false))).toEqual(expected);
  expect(rectangles(cycleTree(true))).toEqual(expected);
});
