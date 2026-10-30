import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Console, Effect, Schema } from "effect";
import { type Command, describeCause, flagValues, UsageFailure } from "../cli/command";
import { type ChromeAngle, renderScenes } from "../render/headlessRender";
import { compareScene, type RegionReport } from "../render/renderCompare";
import { modelPath, readSceneList, sceneOf } from "../render/compareScenes";
import { rerunInGpuLease } from "../render/gpuLease";

class RenderCompareFailure extends Schema.TaggedError<RenderCompareFailure, { readonly brand: unique symbol }>()("RenderCompareFailure", { problem: Schema.String }) {
  override get message() { return this.problem; }
}

const NVIDIA_EGL = "/run/opengl-driver/share/glvnd/egl_vendor.d/10_nvidia.json";

const BACKENDS: Readonly<Record<string, ChromeAngle>> = { "chrome-gl": "gl-egl", "chrome-vulkan": "vulkan", "chrome-swiftshader": "swiftshader" };
const USAGE = `compare --reference ${Object.keys(BACKENDS).join("|")} --candidate ${Object.keys(BACKENDS).join("|")} --scenes FILE --out DIR   (wisp:docs/render-compare.md)`;

/** `render compare`: renders every scene of a scene list through two Chrome ANGLE backends and writes the per-region, per-metric spread between them as `bound.json`. */
export const renderCommand: Command = (args) => Effect.gen(function*() {
  const [action] = args, [reference] = flagValues(args, "reference"), [candidate] = flagValues(args, "candidate"), [scenes] = flagValues(args, "scenes"), [out] = flagValues(args, "out");
  const referenceAngle = reference === undefined ? undefined : BACKENDS[reference], candidateAngle = candidate === undefined ? undefined : BACKENDS[candidate];
  if (action !== "compare" || referenceAngle === undefined || candidateAngle === undefined || scenes === undefined || out === undefined) return yield* new UsageFailure({ problem: USAGE });
  const leased = yield* rerunInGpuLease();
  if (leased !== undefined) return leased === 0 ? undefined : yield* new RenderCompareFailure({ problem: `the run inside the gpu lease exited ${leased}` });
  const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new RenderCompareFailure({ problem: describeCause(cause) }) });
  const { list, models } = yield* attempt(() => readSceneList(resolve(scenes)));
  const sceneSet = list.scenes.map((spec, index) => sceneOf(spec, index));
  const project = { readAsset: async (path: string) => models.get(path), width: list.width, height: list.height };
  const render = (angle: ChromeAngle, directory: string) => renderScenes({ ...project, angle, ...(existsSync(NVIDIA_EGL) ? { chromeEnv: { __EGL_VENDOR_LIBRARY_FILENAMES: NVIDIA_EGL } } : {}) }, sceneSet, directory).pipe(Effect.mapError((cause) => new RenderCompareFailure({ problem: cause.message })));
  const root = resolve(out), referenceDirectory = join(root, "reference"), candidateDirectory = join(root, "candidate");
  yield* attempt(() => mkdir(root, { recursive: true }));
  const referenceImages = yield* render(referenceAngle, referenceDirectory);
  const candidateImages = yield* render(candidateAngle, candidateDirectory);
  const regions: RegionReport[] = yield* attempt(async () => (await Promise.all(list.scenes.map(async (spec, index) => {
    const read = (directory: string, image: string | undefined) => Bun.file(join(directory, image ?? "")).bytes();
    return compareScene(spec.name, await read(referenceDirectory, referenceImages[index]?.image), await read(candidateDirectory, candidateImages[index]?.image));
  }))).flat());
  const gpu = async (directory: string) => (JSON.parse(await Bun.file(join(directory, "render.json")).text()) as { gpu: string }).gpu;
  const report = { reference, candidate, gpu: yield* attempt(async () => ({ reference: await gpu(referenceDirectory), candidate: await gpu(candidateDirectory) })), width: list.width, height: list.height, scenes: list.scenes.map(modelPath), regions };
  yield* attempt(() => writeFile(join(root, "bound.json"), JSON.stringify(report, null, 2) + "\n"));
  yield* Console.log(JSON.stringify({ regions: regions.length, out: join(root, "bound.json") }));
});
