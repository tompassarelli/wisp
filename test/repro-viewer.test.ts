import { expect, test } from "bun:test";
import { createReproViewer } from "../scripts/wisp/reproViewer";
import type { ReproInspector } from "../src/runtime/repro";

// Client 1's total drifts from frame 4: a desync injected into the saved interval 2..5.
const inspect: ReproInspector = (_repro, frame) => {
  if (frame < 2 || frame > 5) return "outside the saved interval";
  const total = frame + (frame >= 4 ? GetPlayerId(GetLocalPlayer()) : 0);
  return { frame, checksum: String(total), state: `total=${total}|position.x=${frame}|position.y=0`, fields: [{ path: "total", value: String(total) }, { path: "position.x", value: String(frame) }, { path: "position.y", value: "0" }] };
};

test("[invariant] an injected desync is found at its first divergent frame, with each client's changes", () => {
  const viewer = createReproViewer({ filePrefix: "viewer", globalPrefixes: ["__viewer"] }, inspect, { build: "seeded-desync", frame: 5, checksum: "5", lines: [] });
  expect(viewer.metadata).toMatchObject({ build: "seeded-desync", start: 2, end: 5, firstDivergentFrame: 4 });
  const frame = viewer.frame(4);
  expect(frame.differences).toEqual([{ path: "total", before: "4", after: "5" }]);
  expect(frame.clients.map((client) => client.changes)).toEqual([
    [{ path: "position.x", before: "3", after: "4" }, { path: "total", before: "3", after: "4" }],
    [{ path: "position.x", before: "3", after: "4" }, { path: "total", before: "3", after: "5" }],
  ]);
  const backward = viewer.frame(2);
  expect(backward.differences).toEqual([]);
  expect(backward.clients[0]?.changes).toEqual([]);
});
