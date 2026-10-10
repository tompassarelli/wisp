import { expect, test } from "bun:test";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Effect } from "effect";
import { join } from "node:path";
import fixture from "./fixtures/fidelity-manifest/manifest.json";
import { decodeManifest, readManifest } from "../scripts/wisp/fidelity/manifest";

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
  const manifest = await Effect.runPromise(readManifest(join(import.meta.dir, "fixtures/fidelity-manifest")).pipe(Effect.provide(BunServices.layer)));
  expect(manifest.slices).toHaveLength(1);
  const paths = fieldPaths(fixture);
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
  for (const key of ["fog", "bloom", "cine"] as const) for (const value of [false, true]) faults.push((input) => {
    const slice = input.slices[0]; if (slice) for (const control of slice.controls) control[key] = value;
  });
  faults.push((input) => { const slice = input.slices[0]; if (slice) for (const control of slice.controls) control.dof = 0; });
  for (const [index, fault] of faults.entries()) {
    const incomplete = structuredClone(fixture);
    fault(incomplete);
    expect(await Effect.runPromise(decodeManifest(incomplete).pipe(Effect.isSuccess)), `fault ${index}`).toBe(false);
  }
  console.log(`capture manifest: ${paths.length} required-field omissions and ${faults.length} invalid slices rejected`);
});
