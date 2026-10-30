import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Deferred, Effect, Fiber, FiberSet, Schema } from "effect";
import { ChildProcess } from "effect/process";
import type { HeadlessClient } from "../../src/headless/client";
import type { LockstepLink } from "../../src/headless/lockstep";
import { spawnLogged } from "../process/hostProcess";
import { requireGpuLease } from "../render/gpuLease";
import { joinCode, joinTarget, relayCode, relayRegions, CODE_HASH_DIGITS, type RelayChoice } from "../net/joinCode";
import { chooseHostRelay, showJoinPing } from "../net/regionChoice";
import { NetFailure } from "../net/failure";
import { type NetListening, type NetRole, type NetSession, runNetPeer } from "../net/peer";
import { captureScene, sceneWithUnits, RenderFailure, type HeadlessRenderProject } from "../render/headlessRender";
import { browserBundle } from "../render/browserBundle";
import { createSoundResolver } from "../render/standaloneSound";
import { openSimPlayer } from "../window/simPlayer";
import type { NativeGameModule } from "../window/simProtocol";
import type { StandaloneFrame, StandaloneInput } from "../render/standaloneFrames";

export type { StandaloneFrame, StandaloneInput } from "../render/standaloneFrames";

export interface StandaloneSession {
  readonly client: HeadlessClient;
  step(input: StandaloneInput): void;
  checksum(): string;
  frame?(): number;
  finished?(): boolean;
  close(): void;
  /** Frames advance on their own (a networked match); `step` only hands over the input and the scene is read as it stands. */
  readonly paced?: boolean;
}

/** One slot of a networked match: the transport steps it, the window reads its scene and gives it the local input. */
export interface StandaloneNetSession extends NetSession {
  readonly client: HeadlessClient;
  input(this: void, input: StandaloneInput): void;
  finished?(this: void): boolean;
}

export interface StandaloneGame {
  readonly title: string;
  readonly render: HeadlessRenderProject;
  create(options?: { readonly script?: string }): Promise<StandaloneSession>;
  /** Host and join (wisp:docs/play.md): the map's hash, compared before a match, and one slot's session over the link. */
  readonly net?: {
    mapHash(this: void): Promise<string>;
    create(this: void, link: LockstepLink, slot: number, humans: number, options?: { readonly script?: string }): Promise<StandaloneNetSession>;
  };
}

type StandaloneNet = { readonly host: { readonly port: number; readonly relay?: string } } | { readonly join: string };

export type StandaloneWindow = "chrome" | "native";

export interface StandaloneOptions {
  /** `native` opens wisp-window (wisp:docs/native-window-plan.md); `chrome` is today's page. */
  readonly window?: StandaloneWindow;
  readonly script?: string;
  readonly frames?: number;
  readonly out?: string;
  readonly headless?: boolean;
  readonly captureFrames?: readonly number[];
  readonly recordChecksums?: boolean;
  readonly gamepadIndex?: number;
  readonly net?: StandaloneNet;
  /** False skips the gpu machine-capacity lease check, which otherwise applies only to a scripted, captured or headless run (`agentRender`). */
  readonly gpuLease?: boolean;
  /** With `window: "native"`, where a worker thread imports the game from; the worker steps the game there, so the native window requires it. */
  readonly nativeGame?: NativeGameModule;
}

class MapMismatch extends Schema.TaggedError<MapMismatch, { readonly brand: unique symbol }>()("MapMismatch", { code: Schema.String, here: Schema.String }) {
  override get message(): string {
    return `the join code is for map ${this.code}, this build is map ${this.here.slice(0, CODE_HASH_DIGITS)}; both players need the same build`;
  }
}

/** This machine's IPv4 addresses other players can reach, LAN ones first. */
function reachableAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal).map((entry) => entry.address);
}

const framesAhead = (scripted: boolean) => (scripted ? 3 : 1);

const Input = Schema.Struct({ buttons: Schema.Array(Schema.String), axisX: Schema.Finite, axisY: Schema.Finite });
const Sound = Schema.Struct({
  event: Schema.Literals(["create", "start", "stop", "volume"]), frame: Schema.Finite,
  kind: Schema.Literals(["sound", "music"]), looping: Schema.Boolean, effectiveVolume: Schema.Finite,
  source: Schema.optional(Schema.String), label: Schema.optional(Schema.String),
  handle: Schema.Struct({ kind: Schema.String, id: Schema.Finite }),
  volume: Schema.Finite, pitch: Schema.Finite, x: Schema.Finite, y: Schema.Finite, z: Schema.Finite,
});

const Completion = Schema.fromJsonString(Schema.StructWithRest(Schema.Struct({ error: Schema.optional(Schema.String) }), [Schema.Record(Schema.String, Schema.Unknown)]));

const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new RenderFailure({ cause }) });
const failed = (problem: string) => new RenderFailure({ cause: new Error(problem) });

const problemOf = (failure: RenderFailure) => (failure.cause instanceof Error ? failure.cause.message : String(failure.cause));
const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(Effect.mapError((cause) => failed(cause.message)));

const thrownAsFailure = Effect.catchDefect((cause) => Effect.fail(new RenderFailure({ cause })));

export const openStandalone = (game: StandaloneGame, options: StandaloneOptions = {}) => Effect.gen(function*() {
  const script = options.script === undefined ? undefined : yield* attempt(() => Bun.file(options.script!).text());
  const session = yield* Effect.acquireRelease(attempt(() => game.create(script === undefined ? undefined : { script })), (opened) => Effect.sync(() => opened.close()));
  let soundOffset = 0, steps = 0;
  const checksums: { step: number; frame: number; checksum: string; simulationMs: number }[] = [];
  const captures = new Set(options.captureFrames ?? []);
  const recordChecksums = options.recordChecksums ?? (options.script !== undefined && session.paced !== true);
  const sounds = createSoundResolver(game.render.readAsset);
  const assets = new Map<string, Promise<Uint8Array | undefined>>();
  const completion = yield* Deferred.make<Readonly<Record<string, unknown>>, RenderFailure>();
  const javascript = options.window === "native" ? "" : yield* attempt(() => browserBundle(join(import.meta.dir, "../browser/standalone.ts")));
  if (options.out !== undefined) yield* attempt(() => mkdir(options.out!, { recursive: true }));
  const advance = (input: StandaloneInput) => {
    const start = performance.now();
    session.step(input);
    const frame = session.frame?.() ?? session.client.frame;
    const checksum = recordChecksums ? session.checksum() : undefined;
    steps++;
    if (checksum !== undefined) checksums.push({ step: steps, frame, checksum, simulationMs: performance.now() - start });
    const capture = captures.delete(frame);
    const done = options.frames !== undefined && (session.paced === true ? frame >= options.frames : steps >= options.frames);
    const scene = sceneWithUnits(game.render, captureScene(session.client, { visibleOnly: !capture }));
    const cues = session.client.soundLog.slice(soundOffset);
    soundOffset = session.client.soundLog.length;
    const frameOf = { scene: { ...scene, frame, units: [], effects: scene.effects.filter((effect) => effect.alpha > 0 && effect.scale > 0 && !effect.flat), ui: scene.ui.filter((element) => element.visible && element.alpha > 0) },
      sounds: cues, step: steps, frame, ...(checksum === undefined ? {} : { checksum }), capture, done, serverMs: performance.now() - start } satisfies StandaloneFrame;
    return { frame: frameOf, saved: capture ? scene : undefined };
  };
  const step = (body: string) => Effect.gen(function*() {
    const { frame, saved } = advance(yield* decode(Schema.fromJsonString(Input), body));
    if (saved !== undefined && options.out !== undefined) yield* attempt(() => Bun.write(join(options.out!, `p${saved.client}-frame-${frame.frame}.json`), JSON.stringify(saved)));
    return frame;
  });
  const finish = (result: Readonly<Record<string, unknown>>) => Effect.gen(function*() {
    if (options.out !== undefined) {
      const out = options.out;
      if (recordChecksums) yield* attempt(() => Bun.write(join(out, "checksums.jsonl"), checksums.map((row) => JSON.stringify(row)).join("\n") + "\n"));
      yield* attempt(() => Bun.write(join(out, "standalone.json"), JSON.stringify({ ...result, steps, capturesMissing: [...captures] }, null, 2) + "\n"));
    }
    if (result.error !== undefined) yield* Deferred.fail(completion, failed(String(result.error)));
    else if (captures.size > 0) yield* Deferred.fail(completion, failed(`capture frames not reached: ${[...captures].join(", ")}`));
    else yield* Deferred.succeed(completion, result);
  });
  const handle = (request: Request, server: Bun.Server<undefined>) => Effect.gen(function*() {
    const url = new URL(request.url);
    if (url.pathname === "/") return new Response(`<!doctype html><html><head><title>${game.title.replaceAll("<", "&lt;")}</title><style>html,body{margin:0;width:100%;height:100%;background:#101522;overflow:hidden}body{display:flex;align-items:center;justify-content:center}canvas{max-width:100%;max-height:100%;object-fit:contain}#status{position:fixed;bottom:12px;left:16px;color:white;font:14px sans-serif;background:#101522bb;padding:6px 10px;border-radius:5px}</style></head><body><script type="module" src="/player.js"></script></body></html>`, { headers: {
      "content-type": "text/html",

      "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp",
    } });
    if (url.pathname === "/player.js") return new Response(javascript, { headers: { "content-type": "text/javascript" } });
    if (url.pathname === "/config") return Response.json({ title: game.title, width: game.render.width ?? 1280, height: game.render.height ?? 720, scripted: options.script !== undefined, samples: options.out !== undefined, gamepadIndex: options.gamepadIndex, frames: session.paced === true ? undefined : options.frames, ahead: framesAhead(options.script !== undefined) });
    if (url.pathname === "/prepare") return Response.json({ scene: sceneWithUnits(game.render, captureScene(session.client)), models: game.render.preloadModels ?? [], step: steps });
    if (url.pathname === "/asset") {
      const path = url.searchParams.get("path") ?? "";
      let data = assets.get(path);
      if (data === undefined) assets.set(path, data = game.render.readAsset(path));
      const pending = data;
      const bytes = yield* attempt(() => pending);
      return bytes === undefined ? new Response(`missing map asset: ${path}`, { status: 404 }) : new Response(new Uint8Array(bytes));
    }
    if (url.pathname === "/sound" && request.method === "POST") {
      const cue = yield* decode(Sound, yield* attempt(() => request.json()));
      const resolved = yield* attempt(() => sounds({ ...cue, source: cue.source, label: cue.label }));
      return resolved === undefined ? new Response(`missing sound: ${cue.source ?? cue.label}`, { status: 404 }) : new Response(new Uint8Array(resolved.bytes), { headers: { "x-wisp-sound-path": resolved.path } });
    }
    if (url.pathname === "/frames") return server.upgrade(request) ? undefined : new Response("frames need a WebSocket", { status: 400 });
    if (url.pathname === "/capture" && request.method === "POST" && options.out !== undefined) {
      const frame = Number(url.searchParams.get("frame")), slot = session.client.slot;
      if (!Number.isSafeInteger(frame) || frame < 0) return yield* failed("invalid capture frame");
      const image = yield* attempt(() => request.arrayBuffer());
      yield* attempt(() => Bun.write(join(options.out!, `p${slot}-frame-${frame}.png`), image));
      return new Response("saved");
    }
    if (url.pathname === "/complete" && request.method === "POST") {
      yield* finish(yield* decode(Completion, yield* attempt(() => request.text())));
      return new Response("saved");
    }
    return new Response("not found", { status: 404 });
  }).pipe(thrownAsFailure, Effect.catch((failure) => Effect.succeed(new Response(problemOf(failure), { status: 500 }))));
  const run = yield* FiberSet.makeRuntimePromise<never>();
  let steps$ = Promise.resolve();

  const server = yield* Effect.acquireRelease(Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, websocket: {
    message(socket, message) {

      steps$ = steps$.then(async () => {
        socket.send(JSON.stringify(await run(step(String(message)).pipe(thrownAsFailure, Effect.catch((failure) => Effect.succeed({ error: problemOf(failure) }))))));
      }).catch(() => undefined);
    },
  }, fetch: (request, server) => run(handle(request, server)) })), (open) => Effect.promise(() => open.stop(true)));
  return {
    url: `http://127.0.0.1:${server.port}/`, completed: Deferred.await(completion),
    /** What the native window drives in place of the page: the scene before the first step, one step, and the end of the run. */
    native: { prepare: () => ({ scene: sceneWithUnits(game.render, captureScene(session.client)), models: game.render.preloadModels ?? [], step: steps }), advance: (input: StandaloneInput) => advance(input).frame, finish: (result: Readonly<Record<string, unknown>>) => run(finish(result)) },
  };
});

const openWindow = (game: StandaloneGame, options: StandaloneOptions, url: string) => Effect.gen(function*() {
  const directory = yield* Effect.acquireRelease(attempt(() => mkdtemp(join(tmpdir(), "wisp-player-"))), (path) => Effect.promise(() => rm(path, { recursive: true, force: true })));
  const browser = yield* spawnLogged(ChildProcess.make(game.render.chrome ?? process.env.CHROME ?? "google-chrome-stable", [
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--autoplay-policy=no-user-gesture-required",
    "--disable-renderer-backgrounding", "--disable-background-timer-throttling", `--user-data-dir=${directory}`, `--window-size=${game.render.width ?? 1280},${game.render.height ?? 720}`,
    ...(options.headless === true ? ["--headless=new", "--use-gl=angle", ...(process.env.CI === "true" ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : ["--use-angle=gl"])] : []), `--app=${url}`,
  ]), { stdout: join(directory, "chrome.out"), stderr: join(directory, "chrome.log") }).pipe(Effect.mapError((cause) => new RenderFailure({ cause })));
  console.log(`${game.title}: standalone window opened. Connect a controller or use the keyboard.`);
  return {
    closed: browser.handle.exitCode.pipe(
      Effect.mapError((cause) => new RenderFailure({ cause })),
      Effect.flatMap((code) => (code !== 0 ? Effect.fail(failed(`player window exited (${code})`)) : Effect.void)),
    ),
  };
});

const printSummary = (result: Readonly<Record<string, unknown>> | void) => {
  if (result === undefined) return;
  const { frameSamplesMs, intervalSamplesMs, requestSamplesMs, renderSamplesMs, frameTimings, ...summary } = result;
  console.log(JSON.stringify(summary));
};

const FOREVER_FRAMES = 60 * 60 * 60 * 24;

/** One player of a networked match: `--host` listens (or, with `--relay REGION`, opens a relay room) and prints the join code, `--join CODE|ADDRESS:PORT` joins it (wisp:docs/play.md). */
const runNetStandalone = (game: StandaloneGame, options: StandaloneOptions, net: StandaloneNet) => Effect.gen(function*() {
  const hooks = game.net;
  if (hooks === undefined) return yield* new NetFailure({ problem: `${game.title} doesn't support host and join` });
  const mapHash = yield* attempt(() => hooks.mapHash());
  let role: NetRole;
  let relay: RelayChoice | undefined;
  if ("host" in net) {
    relay = net.host.relay === undefined ? undefined : yield* chooseHostRelay(net.host.relay, relayRegions(), console.error);
    role = relay === undefined ? { kind: "host", port: net.host.port } : { kind: "relayHost", relay: relay.relay };
  } else {
    const target = joinTarget(net.join);
    if (typeof target === "string") return yield* new NetFailure({ problem: target });
    if ("relay" in target) {
      yield* showJoinPing(target.relay, relayRegions(), console.error);
      role = { kind: "relayJoin", relay: target.relay, room: target.room };
    } else {
      if (target.mapHash !== undefined && target.mapHash !== mapHash.slice(0, CODE_HASH_DIGITS)) return yield* new MapMismatch({ code: target.mapHash, here: mapHash });
      role = { kind: "join", to: { address: target.address, port: target.port } };
    }
  }
  const script = options.script === undefined ? undefined : yield* attempt(() => Bun.file(options.script!).text());
  const created = Promise.withResolvers<StandaloneNetSession>();
  const listening = (at: NetListening) => {
    if ("room" in at) {
      if (relay !== undefined) console.log(`${game.title}: join code ${relayCode(relay, at.room)} (relay room; the joiner's map must match ${mapHash.slice(0, CODE_HASH_DIGITS)})`);
      return;
    }
    const { port } = at;
    const addresses = reachableAddresses();
    const [lan] = addresses;
    if (lan !== undefined) console.log(`${game.title}: join code ${joinCode(lan, port, mapHash)} (map ${mapHash.slice(0, CODE_HASH_DIGITS)})`);
    for (const address of addresses) console.log(`${game.title}: direct address ${address}:${port} (UDP; forward this port to ${address} for a player outside this network)`);
    if (lan === undefined) console.log(`${game.title}: no network address; on this machine join 127.0.0.1:${port}`);
  };
  const peer = yield* Effect.forkScoped(runNetPeer({
    create: async (link, slot, humans) => {
      const session = await hooks.create(link, slot, humans, script === undefined ? undefined : { script });
      return { ...session, start: () => { session.start(); created.resolve(session); }, close: () => undefined };
    },
  }, { role, game: `${game.title} map ${mapHash}`, frames: options.frames ?? FOREVER_FRAMES, listening }));
  const player = yield* openStandalone({
    ...game,
    create: async () => {
      const session = await created.promise;
      return { client: session.client, paced: true, step: session.input, checksum: session.checksum, frame: session.frame, ...(session.finished === undefined ? {} : { finished: session.finished }), close: session.close };
    },
  }, options);
  const { closed } = yield* openWindow(game, options, player.url);
  const ended = Fiber.join(peer).pipe(Effect.tap((report) => Effect.sync(() => console.error(`net: ${JSON.stringify(report)}`))));
  const outcome = yield* Effect.raceFirst(
    Effect.all([player.completed, ended], { concurrency: "unbounded" }).pipe(Effect.map(([result]) => result)),
    closed,
  ).pipe(Effect.catchTags({
    PeerLeft: (left) => Effect.sync(() => console.log(`${game.title}: ${left.message}; the session ended`)),
    PeerSilent: (silent) => Effect.sync(() => console.log(`${game.title}: ${silent.message}; the session ended`)),
  }));
  printSummary(outcome);
});

/** True for a run an agent drives (headless, scripted or capturing frames), never for the window a person plays. */
export const agentRender = (options: StandaloneOptions) =>
  options.headless === true || options.script !== undefined || options.out !== undefined || options.recordChecksums === true || (options.captureFrames ?? []).length > 0;

/** Plays in the native window: a worker thread imports the game and owns the frame loop ("Seam (revised)" in wisp:docs/native-window-plan.md), and the netcode joins it in W2 (wisp#107). */
const runNativeStandalone = (game: StandaloneGame, options: StandaloneOptions) => Effect.gen(function*() {
  if (options.net !== undefined) return yield* failed("the native window can't play over --net until the netcode moves onto it (wisp#107); use --window chrome");
  if (options.nativeGame === undefined) return yield* failed("the native window needs nativeGame, the module and export a worker thread imports the game from");
  if ((options.captureFrames ?? []).length > 0) return yield* failed("the native window can't capture frames yet; use --window chrome");
  const sim = yield* openSimPlayer({ title: game.title, width: game.render.width ?? 1280, height: game.render.height ?? 720, scripted: options.script !== undefined, game: options.nativeGame, standalone: options });
  printSummary(yield* Effect.raceFirst(sim.completed, sim.closed));
});

export const runStandalone = (game: StandaloneGame, options: StandaloneOptions = {}) => Effect.scoped(Effect.gen(function*() {
  if (options.gpuLease !== false && agentRender(options)) yield* requireGpuLease();
  if (options.window === "native") return yield* runNativeStandalone(game, options);
  if (options.net !== undefined) return yield* runNetStandalone(game, options, options.net);
  const player = yield* openStandalone(game, options);
  const { closed } = yield* openWindow(game, options, player.url);
  printSummary(yield* Effect.raceFirst(player.completed, closed));
})).pipe(Effect.provide(BunServices.layer));

/** Reads `--window chrome|native` from a play command's arguments; the rest come back untouched. */
export function standaloneWindowArgument(args: readonly string[]): { readonly window?: StandaloneWindow; readonly rest: readonly string[] } | string {
  const at = args.indexOf("--window");
  if (at < 0) return { rest: args };
  const value = args[at + 1];
  if (value !== "chrome" && value !== "native") return "--window needs chrome or native";
  return { window: value, rest: [...args.slice(0, at), ...args.slice(at + 2)] };
}

/** Reads `--host [--port N | --relay REGION]` or `--join CODE|ADDRESS:PORT` from a play command's arguments; the rest come back untouched. */
export function standaloneNetArguments(args: readonly string[]): { readonly net?: StandaloneNet; readonly rest: readonly string[] } | string {
  const rest: string[] = [];
  let host = false, port = 0, join: string | undefined, relay: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--host") host = true;
    else if (arg === "--port" || arg === "--join" || arg === "--relay") {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) return `${arg} needs a value`;
      if (arg === "--join") join = value;
      else if (arg === "--relay") relay = value;
      else if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) return "--port needs a UDP port number";
      else port = Number(value);
    } else if (arg !== undefined) rest.push(arg);
  }
  if (host && join !== undefined) return "--host and --join are two different players; pick one";
  if (port !== 0 && !host) return "--port goes with --host";
  if (relay !== undefined && !host) return "--relay goes with --host";
  if (relay !== undefined && port !== 0) return "--relay and --port are two ways to host; pick one";
  return { rest, ...(host ? { net: { host: { port, ...(relay === undefined ? {} : { relay }) } } } : join === undefined ? {} : { net: { join } }) };
}
