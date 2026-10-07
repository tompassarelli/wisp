import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import type { EffectPose, HeadlessClient } from "../../src/headless/client";

export interface HeadlessRenderProject {
  /** The map's imported assets and Warcraft assets, kept outside the repository. */
  readonly readAsset: (path: string) => Promise<Uint8Array | undefined>;
  /** Unit object type IDs to model paths; effect models already name their paths. */
  readonly unitModels?: Readonly<Record<number, string>>;
  readonly width?: number;
  readonly height?: number;
  readonly chrome?: string;
}

export interface RenderScene {
  readonly frame: number;
  readonly client: number;
  readonly effects: readonly EffectPose[];
  readonly units: ReturnType<HeadlessClient["unitPoses"]>;
  readonly camera: ReturnType<HeadlessClient["cameraPose"]>;
  readonly ui: ReturnType<HeadlessClient["frames"]["snapshot"]>;
}

export const captureScene = (client: HeadlessClient): RenderScene => ({
  frame: client.frame, client: client.slot, effects: client.effectPoses(), units: client.unitPoses(), camera: client.cameraPose(), ui: client.frames.snapshot(),
});

/** Both the still renderer and the player draw unit objects with the same model poses. */
export function sceneWithUnits(project: HeadlessRenderProject, scene: RenderScene): RenderScene {
  const units: EffectPose[] = scene.units.filter((unit) => unit.visible && unit.alpha > 0).map((unit) => {
    const model = project.unitModels?.[unit.typeId];
    if (model === undefined) throw new Error(`no render.unitModels entry for visible unit type ${unit.typeId}`);
    return { handle: unit.handle, model, created: 0, x: unit.x, y: unit.y, z: unit.z, alpha: unit.alpha, scale: 1, timeScale: unit.timeScale,
      animation: unit.animation, subAnimations: [], animationElapsed: unit.animationElapsed, yaw: unit.facing * Math.PI / 180, pitch: 0, roll: 0, color: unit.color, teamColor: unit.teamColor, matrixScale: unit.scale, flat: unit.scale.some((value) => value === 0) };
  });
  return { ...scene, effects: [...scene.effects, ...units] };
}

export class RenderFailure extends Schema.TaggedError<RenderFailure>()("RenderFailure", {
  cause: Schema.Unknown,
}) {
  override get message(): string { return `headless render: ${String(this.cause)}`; }
}

class DevTools {
  private serial = 0;
  private readonly waiting = new Map<number, { resolve: (value: unknown) => void; reject: (cause: unknown) => void }>();
  constructor(readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const reply = JSON.parse(String(event.data));
      const pending = this.waiting.get(reply.id);
      if (pending === undefined) return;
      this.waiting.delete(reply.id);
      if (reply.error !== undefined) pending.reject(new Error(JSON.stringify(reply.error)));
      else pending.resolve(reply.result);
    });
    socket.addEventListener("close", () => {
      for (const pending of this.waiting.values()) pending.reject(new Error("Chrome closed during rendering"));
      this.waiting.clear();
    });
  }
  call(method: string, params: object = {}): Promise<unknown> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression: string): Promise<unknown> {
    const reply = await this.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }) as {
      result: { value?: unknown; description?: string }; exceptionDetails?: unknown;
    };
    if (reply.exceptionDetails !== undefined) throw new Error(reply.result.description ?? JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  }
}

async function openBrowser(project: HeadlessRenderProject, bundle: string, fallback: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "wisp-render-"));
  const assets = new Map<string, Promise<Uint8Array | undefined>>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response('<!doctype html><html><body style="margin:0;background:#101522"><script type="module" src="/renderer.js"></script></body></html>', { headers: { "content-type": "text/html" } });
    if (url.pathname === "/renderer.js") return new Response(bundle, { headers: { "content-type": "text/javascript" } });
    if (url.pathname !== "/asset") return new Response("not found", { status: 404 });
    const path = url.searchParams.get("path") ?? "";
    let pending = assets.get(path);
    if (pending === undefined) assets.set(path, pending = project.readAsset(path));
    const data = await pending;
    return data === undefined ? new Response(`missing map asset: ${path}`, { status: 404 }) : new Response(new Uint8Array(data));
  }});
  const chrome = Bun.spawn([project.chrome ?? process.env.CHROME ?? "google-chrome-stable", "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--remote-debugging-port=0", `--user-data-dir=${directory}`, "--use-gl=angle", `--use-angle=${fallback ? "swiftshader" : "gl"}`, ...(fallback ? ["--enable-unsafe-swiftshader"] : []), `http://127.0.0.1:${server.port}/`], { stdout: "ignore", stderr: Bun.file(join(directory, "chrome.log")) });
  let devtools: DevTools | undefined;
  const close = async () => {
    devtools?.socket.close();
    chrome.kill();
    await chrome.exited;
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  };
  try {
    let port: string | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      const active = await readFile(join(directory, "DevToolsActivePort"), "utf8").catch(() => "");
      port = active.split("\n")[0];
      if (port) break;
      if (chrome.exitCode !== null) throw new Error(`Chrome exited: ${await readFile(join(directory, "chrome.log"), "utf8")}`);
      await Bun.sleep(50);
    }
    if (!port) throw new Error("Chrome did not open its DevTools port within 10 seconds");
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()) as { type: string; webSocketDebuggerUrl: string }[];
    const page = pages.find((candidate) => candidate.type === "page");
    if (page === undefined) throw new Error("Chrome has no render page");
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => { socket.addEventListener("open", () => resolve(), { once: true }); socket.addEventListener("error", reject, { once: true }); });
    devtools = new DevTools(socket);
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await devtools.evaluate("typeof window.renderScene === 'function'")) break;
      if (attempt === 199) throw new Error("The model renderer did not load within 10 seconds");
      await Bun.sleep(50);
    }
    const gpu = await devtools.evaluate(`window.prepareRenderer(${project.width ?? 1280},${project.height ?? 720})`);
    return { devtools, gpu, close };
  } catch (cause) { await close(); throw cause; }
}

/** Draws captured scenes with the map's models, textures, camera and UI. */
export const renderScenes = (project: HeadlessRenderProject, scenes: readonly RenderScene[], directory: string) => Effect.scoped(Effect.gen(function*() {
  const bundle = yield* Effect.tryPromise({ try: async () => {
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, "browser/headlessRender.ts")], target: "browser", minify: true });
    if (!result.success || result.outputs[0] === undefined) throw new Error(result.logs.join("\n"));
    return result.outputs[0].text();
  }, catch: (cause) => new RenderFailure({ cause }) });
  const browser = yield* Effect.acquireRelease(Effect.tryPromise({ try: () => openBrowser(project, bundle, false).catch(() => openBrowser(project, bundle, true)), catch: (cause) => new RenderFailure({ cause }) }), (resource) => Effect.promise(resource.close));
  return yield* Effect.tryPromise({ try: async () => {
    await mkdir(directory, { recursive: true });
    const images: { frame: number; client: number; image: string; models: number; textures: number }[] = [];
    for (const scene of scenes) {
      const result = await browser.devtools.evaluate(`window.renderScene(${JSON.stringify(sceneWithUnits(project, scene))})`) as { png: string; models: number; textures: number };
      const image = `p${scene.client}-frame-${scene.frame}.png`;
      await Bun.write(join(directory, image), Buffer.from(result.png.split(",")[1] ?? "", "base64"));
      await Bun.write(join(directory, `p${scene.client}-frame-${scene.frame}.json`), JSON.stringify(scene));
      images.push({ frame: scene.frame, client: scene.client, image, models: result.models, textures: result.textures });
    }
    await Bun.write(join(directory, "render.json"), JSON.stringify({ renderer: "war3-model 4.0.1", gpu: browser.gpu, images }, null, 2) + "\n");
    return images;
  }, catch: (cause) => new RenderFailure({ cause }) });
})).pipe(Effect.timeout("2 minutes"));
