import { expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createReproViewer, serveReproViewer } from "../scripts/wisp/reproViewer";
import type { ReproInspector } from "../src/runtime/repro";

const sources = { project: join(import.meta.dir, "../tsconfig.json"), file: join(import.meta.dir, "fixtures/repro/viewerState.ts"), type: "ViewerState" };
// The host tsconfig doesn't include tests; the fixture gets its own small source project.
const fixtureProject = join(import.meta.dir, "fixtures/repro/tsconfig.viewer.json");
const inspect: ReproInspector = (_repro, frame) => {
  if (frame < 2 || frame > 5) return "outside the saved interval";
  const total = frame + (frame >= 4 ? GetPlayerId(GetLocalPlayer()) : 0);
  return { frame, checksum: String(total), state: `total=${total}|position.x=${frame}|position.y=0`, fields: [{ path: "total", value: String(total) }, { path: "position.x", value: String(frame) }, { path: "position.y", value: "0" }] };
};

test("saved frames keep both desynced clients, previous changes and three declaration links", async () => {
  const viewer = createReproViewer({ filePrefix: "viewer", globalPrefixes: ["__viewer"] }, inspect, { build: "seeded-desync", frame: 5, checksum: "5", lines: [] }, { ...sources, project: fixtureProject });
  const server = serveReproViewer(viewer);
  try {
    const address = `http://127.0.0.1:${server.port}`;
    expect(await (await fetch(`${address}/meta`)).json()).toEqual({ build: "seeded-desync", start: 2, end: 5, firstDivergentFrame: 4 });
    const frame = await (await fetch(`${address}/frame?frame=4`)).json();
    expect(frame.differences).toEqual([{ path: "total", before: "4", after: "5" }]);
    expect(frame.clients.map((client: { changes: unknown }) => client.changes)).toEqual([
      [{ path: "position.x", before: "3", after: "4" }, { path: "total", before: "3", after: "4" }],
      [{ path: "position.x", before: "3", after: "4" }, { path: "total", before: "3", after: "5" }],
    ]);
    const fields = frame.clients[0].fields;
    expect(fields.map((field: { source: { file: string; line: number } }) => [field.source.file, field.source.line])).toEqual([[sources.file, 2], [sources.file, 3], [sources.file, 3]]);
    for (const field of fields) {
      const response = await fetch(`${address}/source?file=${encodeURIComponent(field.source.file)}`);
      expect(await response.text()).toContain(`id="L${field.source.line}"`);
    }
    const backward = await (await fetch(`${address}/frame?frame=2`)).json();
    expect(backward.differences).toEqual([]);
    expect(backward.clients[0].changes).toEqual([]);
    expect((await fetch(`${address}/frame?frame=1`)).status).toBe(400);
    const page = await (await fetch(address)).text();
    expect(page).toContain('type="range"');
    expect(page).toContain("First differing frame");
    expect(readFileSync(sources.file, "utf8")).toContain("readonly total");
  } finally { await server.stop(true); }
});

test("large imported moments compare selected frames without a full startup scan", () => {
  const visited: number[] = [];
  const viewer = createReproViewer({ filePrefix: "viewer", globalPrefixes: [] }, (_repro, frame) => {
    visited.push(frame);
    return { frame, checksum: String(frame), state: String(frame), fields: [{ path: "frame", value: String(frame) }] };
  }, { build: "imported", frame: 100000, checksum: "100000", lines: [] }, undefined, false);
  expect(viewer.metadata).toEqual({ build: "imported", start: 0, end: 100000, firstDivergentFrame: null, divergenceScanned: false });
  expect(visited.length).toBeLessThan(40);
  expect(viewer.frame(70000).clients.map(client => client.checksum)).toEqual(["70000", "70000"]);
  expect(viewer.frame(0).clients[0]?.changes).toEqual([]);
});
