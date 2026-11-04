import { join } from "node:path";
import { Effect, Schema } from "effect";
import type { RenderFailure } from "../render/headlessRender";
import type { createSoundResolver } from "../render/standaloneSound";
import { attempt, decode, failed, problemOf, thrownAsFailure } from "./renderAttempt";
import type { StandaloneGame, StandaloneSession } from "./standaloneGame";

const framesAhead = (scripted: boolean) => (scripted ? 3 : 1);

const Sound = Schema.Struct({
  event: Schema.Literals(["create", "start", "stop", "volume"]), frame: Schema.Finite,
  kind: Schema.Literals(["sound", "music"]), looping: Schema.Boolean, effectiveVolume: Schema.Finite,
  source: Schema.optional(Schema.String), label: Schema.optional(Schema.String),
  handle: Schema.Struct({ kind: Schema.String, id: Schema.Finite }),
  volume: Schema.Finite, pitch: Schema.Finite, x: Schema.Finite, y: Schema.Finite, z: Schema.Finite,
});

const Completion = Schema.fromJsonString(Schema.StructWithRest(Schema.Struct({ error: Schema.optional(Schema.String) }), [Schema.Record(Schema.String, Schema.Unknown)]));

interface PageOptions {
  readonly script?: string;
  readonly out?: string;
  readonly frames?: number;
  readonly gamepadIndex?: number;
}

export interface PageRun {
  readonly session: StandaloneSession;
  readonly javascript: string;
  readonly sounds: ReturnType<typeof createSoundResolver>;
  readonly prepare: () => unknown;
  readonly finish: (result: Readonly<Record<string, unknown>>) => Effect.Effect<Readonly<Record<string, unknown>>, RenderFailure>;
}

const pageFiles = (game: StandaloneGame, options: PageOptions, { session, javascript, prepare }: PageRun, url: URL) => {
  if (url.pathname === "/") return new Response(`<!doctype html><html><head><title>${game.title.replaceAll("<", "&lt;")}</title><style>html,body{margin:0;width:100%;height:100%;background:#101522;overflow:hidden}body{display:flex;align-items:center;justify-content:center}canvas{max-width:100%;max-height:100%;object-fit:contain}#status{position:fixed;bottom:12px;left:16px;color:white;font:14px sans-serif;background:#101522bb;padding:6px 10px;border-radius:5px}</style></head><body><script type="module" src="/player.js"></script></body></html>`, { headers: {
    "content-type": "text/html",
    "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp",
  } });
  if (url.pathname === "/player.js") return new Response(javascript, { headers: { "content-type": "text/javascript" } });
  if (url.pathname === "/config") return Response.json({ title: game.title, width: game.render.width ?? 1280, height: game.render.height ?? 720, scripted: options.script !== undefined, samples: options.out !== undefined, gamepadIndex: options.gamepadIndex, frames: session.paced === true ? undefined : options.frames, ahead: framesAhead(options.script !== undefined) });
  if (url.pathname === "/prepare") return Response.json(prepare());
  return undefined;
};

const mapAsset = (game: StandaloneGame, assets: Map<string, Promise<Uint8Array | undefined>>, url: URL) => Effect.gen(function*() {
  const path = url.searchParams.get("path") ?? "";
  let data = assets.get(path);
  if (data === undefined) assets.set(path, data = game.render.readAsset(path));
  const pending = data;
  const bytes = yield* attempt(() => pending);
  return bytes === undefined ? new Response(`missing map asset: ${path}`, { status: 404 }) : new Response(new Uint8Array(bytes));
});

const mapSound = (sounds: PageRun["sounds"], request: Request) => Effect.gen(function*() {
  const cue = yield* decode(Sound, yield* attempt(() => request.json()));
  const resolved = yield* attempt(() => sounds({ ...cue, source: cue.source, label: cue.label }));
  return resolved === undefined ? new Response(`missing sound: ${cue.source ?? cue.label}`, { status: 404 }) : new Response(new Uint8Array(resolved.bytes), { headers: { "x-wisp-sound-path": resolved.path } });
});

const savedCapture = (session: StandaloneSession, out: string, url: URL, request: Request) => Effect.gen(function*() {
  const frame = Number(url.searchParams.get("frame")), slot = session.client.slot;
  if (!Number.isSafeInteger(frame) || frame < 0) return yield* failed("invalid capture frame");
  const image = yield* attempt(() => request.arrayBuffer());
  yield* attempt(() => Bun.write(join(out, `p${slot}-frame-${frame}.png`), image));
  return new Response("saved");
});

export const pageRoutes = (game: StandaloneGame, options: PageOptions, page: PageRun) => {
  const assets = new Map<string, Promise<Uint8Array | undefined>>();
  return (request: Request, server: Bun.Server<undefined>) => Effect.gen(function*() {
    const url = new URL(request.url);
    const file = pageFiles(game, options, page, url);
    if (file !== undefined) return file;
    if (url.pathname === "/asset") return yield* mapAsset(game, assets, url);
    if (url.pathname === "/sound" && request.method === "POST") return yield* mapSound(page.sounds, request);
    if (url.pathname === "/frames") return server.upgrade(request) ? undefined : new Response("frames need a WebSocket", { status: 400 });
    if (url.pathname === "/capture" && request.method === "POST" && options.out !== undefined) return yield* savedCapture(page.session, options.out, url, request);
    if (url.pathname === "/complete" && request.method === "POST") {
      yield* page.finish(yield* decode(Completion, yield* attempt(() => request.text())));
      return new Response("saved");
    }
    return new Response("not found", { status: 404 });
  }).pipe(thrownAsFailure, Effect.catch((failure) => Effect.succeed(new Response(problemOf(failure), { status: 500 }))));
};
