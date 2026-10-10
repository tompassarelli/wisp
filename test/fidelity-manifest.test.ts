import { expect, test } from "bun:test";
import { Effect } from "effect";
import { decodeManifest, type CaptureControl } from "../scripts/wisp/fidelity/manifest";

const controls = [
  { id: "stock", mode: "stock", fog: false, bloom: false, dof: 0, cine: false },
  { id: "mask", mode: "mask", fog: false, bloom: false, dof: 0, cine: false },
  { id: "stage", mode: "stage", fog: false, bloom: false, dof: 0, cine: false },
  { id: "fog-on", mode: "stage", fog: true, bloom: false, dof: 0, cine: false },
];
const fixture = {
  version: 1, split: { frozenAt: "2026-10-10T00:00:00Z", fit: ["synthetic-fit"], heldOut: ["synthetic-ruler"], retired: [] },
  slices: [{
    lever: "fog", scene: "synthetic-ruler", kind: "lever", split: "held-out", pad: "synthetic.pad", frames: [0, 1],
    camera: { position: [0, -10, 5], target: [0, 0, 0], fov: 60 }, look: "definitive",
    identity: { build: "synthetic-build", assetLayers: ["synthetic-assets"], mapHash: "synthetic-map-hash", settingsFile: "synthetic-settings.json", resolution: { width: 4, height: 4 }, gpu: "synthetic-gpu" },
    settings: { density: 0.5 }, calibratedRanges: { density: { min: 0, max: 1 } },
    regions: [{ id: "critical", x: 0, y: 0, width: 4, height: 4, critical: true }], controls, cineWindow: { start: 0, end: 1 },
    runs: [0, 1, 2].map((run) => ({ id: `run-${run}`, captures: [0, 1].flatMap((frame) => controls.map((control) => ({ frame, frameSource: "journal", control: control.id, image: `${run}/${frame}-${control.id}.ppm` }))) })),
  }],
};

function fieldPaths(value: unknown, path: readonly (string | number)[] = []): (readonly (string | number)[])[] {
  if (Array.isArray(value)) return value.length === 0 ? [] : fieldPaths(value[0], [...path, 0]);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) => [[...path, key], ...fieldPaths(nested, [...path, key])]);
}

function omit(value: unknown, path: readonly (string | number)[]): void {
  let cursor = value;
  for (const part of path.slice(0, -1)) {
    if (typeof cursor !== "object" || cursor === null) throw new Error("invalid omission path");
    cursor = (cursor as Record<string | number, unknown>)[part];
  }
  const last = path.at(-1);
  if (typeof cursor !== "object" || cursor === null || last === undefined) throw new Error("invalid omission target");
  delete (cursor as Record<string | number, unknown>)[last];
}

test("[wisp#75 P4.2] public capture file boundary accepts a complete slice and rejects every missing required field", async () => {
  const manifest = await Effect.runPromise(decodeManifest(fixture));
  expect(manifest.slices).toHaveLength(1);
  const paths = fieldPaths(fixture).filter((path) => path.join(".") !== "slices.0.cineWindow" && !(path[2] === "controls" && path.length === 5 && path[4] !== "id"));
  for (const path of paths) {
    const incomplete = structuredClone(fixture);
    omit(incomplete, path);
    expect(await Effect.runPromise(decodeManifest(incomplete).pipe(Effect.isSuccess)), `missing ${path.join(".")}`).toBe(false);
  }
  const faults: ((input: typeof fixture) => void)[] = [
    (input) => { input.split.heldOut = []; },
    (input) => { input.split.fit.push("synthetic-ruler"); },
    (input) => { input.split.frozenAt = "not-a-date"; },
    (input) => { const slice = input.slices[0]; if (slice) slice.frames = []; },
    (input) => { const slice = input.slices[0]; if (slice) slice.identity.assetLayers = []; },
    (input) => { const slice = input.slices[0]; if (slice) slice.regions = []; },
    (input) => { const region = input.slices[0]?.regions[0]; if (region) region.width = 5; },
    (input) => { const slice = input.slices[0]; if (slice) slice.runs.pop(); },
    (input) => { input.slices[0]?.runs[0]?.captures.pop(); },
    (input) => { const capture = input.slices[0]?.runs[0]?.captures[0]; if (capture) capture.image = "../private.ppm"; },
    (input) => { const slice = input.slices[0]; if (slice) slice.cineWindow.end = 2; },
    (input) => { const slice = input.slices[0]; if (slice) slice.calibratedRanges.density.min = 2; },
    (input) => { const slice = input.slices[0]; if (slice) slice.settings.density = Number.NaN; },
  ];
  for (const mode of ["stock", "mask", "stage"]) faults.push((input) => {
    const slice = input.slices[0]; if (slice) slice.controls = slice.controls.filter((control) => control.mode !== mode);
  });
  for (const value of [false, true]) faults.push((input) => {
    const slice = input.slices[0]; if (slice) for (const control of slice.controls) control.fog = value;
  });
  for (const [index, fault] of faults.entries()) {
    const incomplete = structuredClone(fixture);
    fault(incomplete);
    expect(await Effect.runPromise(decodeManifest(incomplete).pipe(Effect.isSuccess)), `fault ${index}`).toBe(false);
  }
  console.log(`capture manifest: ${paths.length} required-field omissions and ${faults.length} invalid slices rejected`);
});

test("[wisp#75 P1.3] capture slices require their own lever's controls per look and record the frame source", async () => {
  const makeManifest = (lever: string, look: "classic" | "definitive", controls: readonly CaptureControl[]) => {
    const original = fixture.slices[0];
    if (!original) throw new Error("missing capture fixture");
    const { cineWindow, ...slice } = original;
    return { ...fixture, slices: [{
      ...slice, lever, look, controls,
      ...(lever === "cinematic-filter" ? { cineWindow } : {}),
      runs: slice.runs.map((run) => ({ ...run, captures: slice.frames.flatMap((frame) => controls.map((control) => ({ frame, frameSource: "journal", control: control.id, image: `${run.id}/${frame}-${control.id}.ppm` }))) })),
    }] };
  };
  const accepted = (input: unknown) => Effect.runPromise(decodeManifest(input).pipe(Effect.isSuccess));
  const ko = makeManifest("cinematic-filter", "classic", [{ id: "cine-off", cine: false }, { id: "cine-on", cine: true }]);
  expect(await accepted(ko)).toBe(true);
  const debuggerKO = structuredClone(ko);
  for (const run of debuggerKO.slices[0]?.runs ?? []) for (const capture of run.captures) capture.frameSource = "debugger";
  expect(await accepted(debuggerKO)).toBe(true);
  const invalidSource = structuredClone(ko);
  const capture = invalidSource.slices[0]?.runs[0]?.captures[0];
  if (capture) capture.frameSource = "wall-clock";
  expect(await accepted(invalidSource)).toBe(false);
  await expect(Effect.runPromise(decodeManifest(makeManifest("cinematic-filter", "classic", [{ id: "cine-off", cine: false }])))).rejects.toThrow("missing cine on control");
  const tombControls: CaptureControl[] = [
    { id: "stock", mode: "stock", fog: false }, { id: "mask", mode: "mask", fog: false },
    { id: "stage", mode: "stage", fog: false }, { id: "fog-on", mode: "stage", fog: true },
  ];
  for (const look of ["classic", "definitive"] as const) {
    expect(await accepted(makeManifest("fog", look, tombControls))).toBe(true);
    expect(await accepted(makeManifest("fog", look, tombControls.filter((control) => control.fog !== true)))).toBe(false);
    expect(await accepted(makeManifest("fog", look, tombControls.filter((control) => control.mode !== "mask")))).toBe(false);
  }
  console.log("capture manifest: Classic KO and Tomb accepted; missing own-lever controls and invalid frame source rejected");
});
