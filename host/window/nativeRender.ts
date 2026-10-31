import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { createModelLibrary, drawScene, preloadScene } from "./drawScene";
import { prepareWindowLibrary } from "./binding";
import { openOffscreen } from "./offscreen";
import type { RenderScene } from "../render/renderScene";

export class NativeRenderFailure extends Schema.TaggedError<NativeRenderFailure, { readonly brand: unique symbol }>()("NativeRenderFailure", { problem: Schema.String }) {
  override get message() { return this.problem; }
}

export interface NativeRenderProject {
  readonly readAsset: (path: string) => Promise<Uint8Array | undefined>;
  readonly width: number;
  readonly height: number;
}

/** Draws each scene through the native renderer with no window (wisp:docs/native-window-plan.md, W3) and writes `<frame>.png` and `render.json` (with the GPU) to `directory`, in the layout `renderScenes` writes for Chrome. */
export const renderNativeScenes = (project: NativeRenderProject, scenes: readonly RenderScene[], directory: string) => Effect.gen(function*() {
  const fail = (cause: unknown) => new NativeRenderFailure({ problem: cause instanceof Error ? cause.message : String(cause) });
  yield* Effect.tryPromise({ try: () => mkdir(directory, { recursive: true }), catch: fail });
  const library = yield* prepareWindowLibrary.pipe(Effect.mapError(fail));
  const offscreen = yield* Effect.acquireRelease(Effect.try({ try: () => openOffscreen(project.width, project.height, library), catch: fail }), (opened) => Effect.sync(() => opened.close()));
  const problems: string[] = [];
  const models = createModelLibrary(project.readAsset, offscreen, (problem) => problems.push(problem));
  const images: { image: string }[] = [];
  for (const scene of scenes) {
    yield* preloadScene(scene, models, offscreen.pending);
    const image = `p${scene.client}-frame-${scene.frame}.png`;
    const png = yield* Effect.try({ try: () => offscreen.render(JSON.stringify(drawScene(scene, models))), catch: fail });
    yield* Effect.tryPromise({ try: () => Bun.write(join(directory, image), png), catch: fail });
    images.push({ image });
  }
  const { adapter, backend, problems: found } = offscreen.info();
  yield* Effect.tryPromise({ try: () => Bun.write(join(directory, "render.json"), JSON.stringify({ renderer: "wisp-window offscreen", gpu: `${adapter} (${backend})`, images }, null, 2) + "\n"), catch: fail });
  const all = [...problems, ...found];
  if (all.length > 0) return yield* new NativeRenderFailure({ problem: all.join("\n") });
  return images;
}).pipe(Effect.scoped);
