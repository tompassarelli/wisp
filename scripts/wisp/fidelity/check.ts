import { resolve, relative as relativePath, isAbsolute } from "node:path";
import { Effect, Schema } from "effect";
import { readManifest, type CaptureManifest, type CaptureSlice } from "./manifest";
import { decodePng, type Image, type Region } from "./image";
import { type Metric } from "./metric";
import { sky } from "./sky";
import { fog } from "./fog";
import { water } from "./water";
import { cinematicFilter } from "./cinematic-filter";
import { dof } from "./dof";
import { bloom } from "./bloom";
import { shading } from "./shading";

export class FidelityFailure extends Schema.TaggedError<FidelityFailure>()("FidelityFailure", { problem: Schema.String }) {
  override get message(): string { return this.problem; }
}
export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";
export interface Measurement { readonly slice: string; readonly frame: number; readonly control: string; readonly region: string; readonly metric: string; readonly bound: number; readonly spread: number; readonly error: number; readonly verdict: Verdict }
export interface FidelityResult { readonly lever: string; readonly verdict: Verdict; readonly measurements: readonly Measurement[] }
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
};
const key = (slice: CaptureSlice) => `${slice.lever}/${slice.scene}/${slice.look}`;
export function validateComparison(reference: CaptureManifest, candidate: CaptureManifest, lever: string): readonly (readonly [CaptureSlice,CaptureSlice])[] {
  if (stable(reference.split) !== stable(candidate.split)) throw new Error("capture split differs");
  const refs = reference.slices.filter(s => s.lever === lever), candidates = candidate.slices.filter(s => s.lever === lever);
  if (refs.length === 0 || refs.length !== candidates.length) throw new Error(`missing or unequal slices for ${lever}`);
  return refs.map(ref => {
    const matches = candidates.filter(s => key(s) === key(ref));
    const cand = matches[0];
    if (matches.length !== 1 || cand === undefined) throw new Error(`missing or duplicate candidate ${key(ref)}`);
    if (ref.split !== "held-out" || cand.split !== "held-out" || !reference.split.heldOut.includes(ref.scene) || reference.split.fit.includes(ref.scene) || reference.split.retired.includes(ref.scene)) throw new Error(`refusing fit-set or retired scene ${ref.scene}`);
    for (const field of ["identity","pad","frames","camera","look","controls","regions","settings","calibratedRanges","cineWindow"] as const) {
      if (stable(ref[field]) !== stable(cand[field])) throw new Error(`${key(ref)} ${field} mismatch`);
    }
    for (const slice of [ref,cand]) for (const [setting,value] of Object.entries(slice.settings)) {
      const range = slice.calibratedRanges[setting];
      if (range === undefined || value < range.min || value > range.max) throw new Error(`${key(slice)} setting ${setting} outside calibrated range`);
    }
    return [ref,cand] as const;
  });
}
export function metricsFor(lever: string, settings: Readonly<Record<string,number>>): readonly Metric[] {
  switch (lever) {
    case "sky": return sky;
    case "fog": case "height-fog-falloff": return fog;
    case "water": return water;
    case "cinematic-filter": return cinematicFilter;
    case "dof": return dof;
    case "bloom": {
      const threshold = settings["thresholdLuma"];
      if (threshold === undefined || threshold < 0 || threshold > 255) throw new Error("bloom requires calibrated thresholdLuma in 0..255");
      return bloom(threshold);
    }
    case "day-night-light": case "point-lights": case "pbr": return shading;
    default: throw new Error(`no decided fidelity bound for lever ${lever}`);
  }
}
export function measureImages(metric: Metric, reference: readonly Image[], candidate: readonly Image[], region: Region): { bound: number; spread: number; error: number; verdict: Verdict } {
  if (reference.length < 3 || candidate.length === 0) throw new Error("need three reference images and at least one candidate image");
  const first = reference[0];
  if (first === undefined) throw new Error("missing reference");
  for (const image of [...reference,...candidate]) {
    if (image.width !== first.width || image.height !== first.height || image.rgb.length !== image.width*image.height*3) throw new Error("image dimensions differ");
    if (region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1 || region.x+region.width > image.width || region.y+region.height > image.height) throw new Error(`region ${region.id} outside image`);
  }
  let spread = 0, error = 0;
  for (const a of reference) for (const b of reference) spread = Math.max(spread,metric.distance(a,b,region));
  for (const a of reference) for (const b of candidate) error = Math.max(error,metric.distance(a,b,region));
  if (Number.isNaN(spread) || Number.isNaN(error)) throw new Error("metric returned NaN");
  return { bound: metric.bound, spread, error, verdict: spread > metric.bound/2 ? "INCONCLUSIVE" : error > metric.bound ? "FAIL" : "PASS" };
}
const readImage = (directory: string, name: string) => Effect.gen(function*() {
  const file = resolve(directory,name), local = relativePath(resolve(directory),file);
  if (local.startsWith("..") || isAbsolute(local)) return yield* new FidelityFailure({ problem: `image outside capture directory: ${name}` });
  const bytes = yield* Effect.tryPromise({ try: () => Bun.file(file).bytes(), catch: cause => new FidelityFailure({ problem: `${file}: ${String(cause)}` }) });
  return yield* Effect.try({ try: () => decodePng(bytes), catch: cause => new FidelityFailure({ problem: `${file}: ${String(cause)}` }) });
});
export const checkFidelity = (lever: string, referenceDirectory: string, candidateDirectory: string) => Effect.gen(function*() {
  const reference = yield* readManifest(referenceDirectory), candidate = yield* readManifest(candidateDirectory);
  const pairs = yield* Effect.try({ try: () => validateComparison(reference,candidate,lever), catch: cause => new FidelityFailure({ problem: String(cause) }) });
  const measurements: Measurement[] = [];
  for (const [ref,cand] of pairs) {
    const metrics = yield* Effect.try({ try: () => metricsFor(lever,ref.settings), catch: cause => new FidelityFailure({ problem: String(cause) }) });
    for (const frame of ref.frames) for (const control of ref.controls) {
      const load = (slice: CaptureSlice, directory: string) => Effect.forEach(slice.runs, run => {
        const capture = run.captures.find(c => c.frame === frame && c.control === control.id);
        return capture === undefined ? Effect.fail(new FidelityFailure({ problem: `missing ${key(slice)} frame ${frame} control ${control.id}` })) : readImage(directory,capture.image);
      }, { concurrency: 1 });
      const references = yield* load(ref,referenceDirectory), candidates = yield* load(cand,candidateDirectory);
      if ([...references,...candidates].some(image => image.width !== ref.identity.resolution.width || image.height !== ref.identity.resolution.height)) return yield* new FidelityFailure({ problem: `${key(ref)} image resolution differs from identity` });
      for (const region of ref.regions) for (const metric of metrics) {
        const measured = yield* Effect.try({ try: () => measureImages(metric,references,candidates,region), catch: cause => new FidelityFailure({ problem: String(cause) }) });
        measurements.push({ slice:key(ref), frame, control:control.id, region:region.id, metric:metric.name, ...measured });
      }
    }
  }
  const verdict: Verdict = measurements.some(m=>m.verdict === "INCONCLUSIVE") ? "INCONCLUSIVE" : measurements.some(m=>m.verdict === "FAIL") ? "FAIL" : "PASS";
  return { lever,verdict,measurements } satisfies FidelityResult;
});
