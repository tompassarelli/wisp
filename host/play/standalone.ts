import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as BunServices from "@effect/platform-bun/BunServices";
import { Deferred, Effect, FiberSet, Schema } from "effect";
import { ChildProcess } from "effect/process";
import { missingNativeMessage } from "../../src/headless/journey";
import { spawnLogged } from "../process/hostProcess";
import { findReforgedInstall, STORAGE_ENV, type InstallLookup } from "../os/warcraft/reforgedInstall";
import { requireGpuLease } from "../render/gpuLease";
import { captureScene, sceneWithUnits, RenderFailure } from "../render/headlessRender";
import { browserBundle } from "../render/browserBundle";
import { playerChromeArguments } from "../render/chromeArguments";
import { createSoundResolver } from "../render/standaloneSound";
import { prepareWindowLibrary } from "../window/binding";
import { openNativeAudio } from "../window/audio";
import { openSimPlayer } from "../window/simPlayer";
import { createSoundPlayer } from "../window/soundPlayer";
import type { NativeGameModule } from "../window/simProtocol";
import type { StandaloneFrame, StandaloneInput } from "../render/standaloneFrames";
import type { StandaloneGame, StandaloneNet } from "./standaloneGame";
import { attempt, decode, failed, problemOf, thrownAsFailure } from "./renderAttempt";
import { pageRoutes } from "./standalonePage";
import { openNetMatch } from "./standaloneNet";

export type { StandaloneFrame, StandaloneInput } from "../render/standaloneFrames";
export type { StandaloneGame, StandaloneNet, StandaloneNetSession, StandaloneSession } from "./standaloneGame";

export type StandaloneWindow = "chrome" | "native";

export interface StandaloneOptions {
  /** `native`, the default, opens wisp-window (wisp:docs/native-window-plan.md); `chrome` opens the browser page, the fallback for the checks the native window does not run yet. */
  readonly window?: StandaloneWindow;
  readonly script?: string;
  readonly frames?: number;
  readonly out?: string;
  readonly headless?: boolean;
  readonly captureFrames?: readonly number[];
  readonly recordChecksums?: boolean;
  readonly gamepadIndex?: number;
  /** A JSON file the run ends by writing the client's emulated-native call counts to, one count per Warcraft-named native (wisp:docs/game-api-plan.md); a migrated family reads zero. */
  readonly emulatedCalls?: string;
  readonly net?: StandaloneNet;
  /** False skips the gpu machine-capacity lease check, which otherwise applies only to a scripted, captured or headless run (`agentRender`). */
  readonly gpuLease?: boolean;
  /** With `window: "native"`, where a worker thread imports the game from (an export that is a function receives `arguments` and returns the game, so the worker reads the player's own map and install as the main thread does); the worker steps the game there, so the native window requires it. */
  readonly nativeGame?: NativeGameModule;
  /** The player's Warcraft III: Reforged install, looked for before a window opens: the run stops with one message when none is found (wisp:docs/play.md, "Warcraft III: Reforged is required"). Passing it also points the worker thread's Classic-art reader at the install it found. */
  readonly reforged?: InstallLookup;
  /** With `window: "native"`, the `wisp-window` library the sound output loads, else the one the window uses. */
  readonly library?: string | undefined;
}

const Input = Schema.Struct({ buttons: Schema.Array(Schema.String), axisX: Schema.Finite, axisY: Schema.Finite });

/** The file `emulatedCalls` names: an object of native name to call count, names in order. */
export const emulatedCallsJson = (calls: ReadonlyMap<string, number>) =>
  JSON.stringify(Object.fromEntries([...calls].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), null, 2) + "\n";

export const openStandalone = (game: StandaloneGame, options: StandaloneOptions = {}) => Effect.gen(function*() {
  const script = options.script === undefined ? undefined : yield* attempt(() => Bun.file(options.script!).text());
  const session = yield* Effect.acquireRelease(attempt(() => game.create(script === undefined ? undefined : { script })), (opened) => Effect.sync(() => opened.close()));
  let soundOffset = 0, steps = 0;
  const checksums: { step: number; frame: number; checksum: string; simulationMs: number }[] = [];
  const captures = new Set(options.captureFrames ?? []);
  const recordChecksums = options.recordChecksums ?? (options.script !== undefined && session.paced !== true);
  const sounds = createSoundResolver(game.render.readAsset);
  const audio = options.window === "native" ? yield* Effect.acquireRelease(attempt(async () => openNativeAudio(options.library)), (open) => Effect.sync(() => open.close())) : undefined;
  const soundPlayer = audio === undefined ? undefined : createSoundPlayer(sounds, audio);
  const completion = yield* Deferred.make<Readonly<Record<string, unknown>>, RenderFailure>();
  const javascript = options.window === "native" ? "" : yield* attempt(() => browserBundle(join(import.meta.dir, "../browser/standalone.ts")));
  if (options.out !== undefined) yield* attempt(() => mkdir(options.out!, { recursive: true }));
  const advance = (input: StandaloneInput) => {
    const start = performance.now();
    if (input.screen !== undefined) session.client.screen.resize(input.screen.width, input.screen.height);
    session.step(input);
    const outside = session.client.missingNatives.find((missing) => missing.outsideProfile === true);
    if (outside !== undefined) throw new Error(`p${outside.client} frame ${outside.frame}: ${missingNativeMessage(outside)}`);
    const frame = session.frame?.() ?? session.client.frame;
    const stages = session.stages?.();
    const checksum = recordChecksums ? session.checksum() : undefined;
    steps++;
    if (checksum !== undefined) checksums.push({ step: steps, frame, checksum, simulationMs: performance.now() - start });
    const capture = captures.delete(frame);
    const done = options.frames !== undefined && (session.paced === true ? frame >= options.frames : steps >= options.frames);
    const sceneStart = performance.now();
    const scene = sceneWithUnits(game.render, captureScene(session.client, { visibleOnly: !capture }));
    const drawn = { ...scene, frame, units: [], effects: scene.effects.filter((effect) => effect.alpha > 0 && effect.scale > 0 && !effect.flat), ui: scene.ui.filter((element) => element.visible && element.alpha > 0) };
    const sceneMs = performance.now() - sceneStart;
    const cues = session.client.soundLog.slice(soundOffset);
    soundOffset = session.client.soundLog.length;
    soundPlayer?.cues(cues);
    const frameOf = { scene: drawn, sounds: cues, step: steps, frame, ...(checksum === undefined ? {} : { checksum }), capture, done, stages: { ...stages, scene: sceneMs }, serverMs: performance.now() - start } satisfies StandaloneFrame;
    return { frame: frameOf, saved: capture ? scene : undefined };
  };
  const step = (body: string) => Effect.gen(function*() {
    const { frame, saved } = advance(yield* decode(Schema.fromJsonString(Input), body));
    if (saved !== undefined && options.out !== undefined) yield* attempt(() => Bun.write(join(options.out!, `p${saved.client}-frame-${frame.frame}.json`), JSON.stringify(saved)));
    return frame;
  });
  const finish = (result: Readonly<Record<string, unknown>>) => Effect.gen(function*() {
    if (soundPlayer !== undefined && result.error === undefined) result = { ...result, ...(yield* attempt(() => soundPlayer.settle())) };
    if (options.emulatedCalls !== undefined) {
      const path = options.emulatedCalls;
      yield* attempt(() => Bun.write(path, emulatedCallsJson(session.client.emulatedCalls)));
    }
    if (options.out !== undefined) {
      const out = options.out;
      if (recordChecksums) yield* attempt(() => Bun.write(join(out, "checksums.jsonl"), checksums.map((row) => JSON.stringify(row)).join("\n") + "\n"));
      yield* attempt(() => Bun.write(join(out, "standalone.json"), JSON.stringify({ ...result, steps, capturesMissing: [...captures] }, null, 2) + "\n"));
    }
    if (result.error !== undefined) yield* Deferred.fail(completion, failed(String(result.error)));
    else if (captures.size > 0) yield* Deferred.fail(completion, failed(`capture frames not reached: ${[...captures].join(", ")}`));
    else yield* Deferred.succeed(completion, result);
    return result;
  });
  const prepare = () => ({ scene: sceneWithUnits(game.render, captureScene(session.client)), models: game.render.preloadModels ?? [], step: steps });
  const handle = pageRoutes(game, options, { session, javascript, sounds, prepare, finish });
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
    native: { prepare, advance: (input: StandaloneInput) => advance(input).frame, finish: (result: Readonly<Record<string, unknown>>) => run(finish(result)) },
  };
});

const openWindow = (game: StandaloneGame, options: StandaloneOptions, url: string) => Effect.gen(function*() {
  const directory = yield* Effect.acquireRelease(attempt(() => mkdtemp(join(tmpdir(), "wisp-player-"))), (path) => Effect.promise(() => rm(path, { recursive: true, force: true })));
  const browser = yield* spawnLogged(ChildProcess.make(game.render.chrome ?? process.env.CHROME ?? "google-chrome-stable", playerChromeArguments(directory, { width: game.render.width ?? 1280, height: game.render.height ?? 720 }, url, options.headless === true, process.env.CI === "true")), { stdout: join(directory, "chrome.out"), stderr: join(directory, "chrome.log") }).pipe(Effect.mapError((cause) => new RenderFailure({ cause })));
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

/** One player of a networked match in the Chrome page (wisp:docs/play.md, "Host and join"). */
const runNetStandalone = (game: StandaloneGame, options: StandaloneOptions, net: StandaloneNet) => Effect.gen(function*() {
  const match = yield* openNetMatch(game, options, net);
  const player = yield* openStandalone(match.game, options);
  const { closed } = yield* openWindow(game, options, player.url);
  const outcome = yield* Effect.raceFirst(
    Effect.all([player.completed, match.ended], { concurrency: "unbounded" }).pipe(Effect.map(([result]) => result)),
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

/** Plays in the native window: a worker thread imports the game and owns the frame loop ("Seam (revised)" in wisp:docs/native-window-plan.md); with `--host` or `--join` the match's peer runs on that thread too ("Networked play on the worker"). */
const runNativeStandalone = (game: StandaloneGame, options: StandaloneOptions) => Effect.gen(function*() {
  if (options.nativeGame === undefined) return yield* failed("the native window needs nativeGame, the module and export a worker thread imports the game from");
  if ((options.captureFrames ?? []).length > 0) return yield* failed("the native window can't capture frames yet; use --window chrome");
  yield* prepareWindowLibrary.pipe(Effect.mapError((cause) => failed(cause.message)));
  const sim = yield* openSimPlayer({ title: game.title, width: game.render.width ?? 1280, height: game.render.height ?? 720, scripted: options.script !== undefined, game: options.nativeGame, standalone: options });
  printSummary(yield* Effect.raceFirst(sim.completed, sim.closed));
});

export const runStandalone = (game: StandaloneGame, options: StandaloneOptions = {}) => Effect.scoped(Effect.gen(function*() {
  if (options.reforged !== undefined) {
    const install = yield* findReforgedInstall(options.reforged);
    process.env[STORAGE_ENV] = install.storage;
  }
  if (options.gpuLease !== false && agentRender(options)) yield* requireGpuLease();
  if (options.window !== "chrome") return yield* runNativeStandalone(game, options);
  if (options.net !== undefined) return yield* runNetStandalone(game, options, options.net);
  const player = yield* openStandalone(game, options);
  const { closed } = yield* openWindow(game, options, player.url);
  printSummary(yield* Effect.raceFirst(player.completed, closed));
})).pipe(Effect.provide(BunServices.layer));

/** Reads `--window chrome|native` from a play command's arguments, native when absent; the rest come back untouched. */
export function standaloneWindowArgument(args: readonly string[]): { readonly window: StandaloneWindow; readonly rest: readonly string[] } | string {
  const at = args.indexOf("--window");
  if (at < 0) return { window: "native", rest: args };
  const value = args[at + 1];
  if (value !== "chrome" && value !== "native") return "--window needs chrome or native";
  return { window: value, rest: [...args.slice(0, at), ...args.slice(at + 2)] };
}

/** Reads `--emulated-calls FILE` from a play command's arguments; the rest come back untouched. */
export function standaloneEmulatedCallsArgument(args: readonly string[]): { readonly emulatedCalls?: string; readonly rest: readonly string[] } | string {
  const at = args.indexOf("--emulated-calls");
  if (at < 0) return { rest: args };
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) return "--emulated-calls needs a file";
  return { emulatedCalls: value, rest: [...args.slice(0, at), ...args.slice(at + 2)] };
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
