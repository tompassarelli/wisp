// What a player sees once a match runs, in every signed-in client: the scene
// report the map's recorder writes, and one frame captured off-screen from the
// client's private desktop, each checked against the game's expectations. The
// frame stays on disk; the check decides by pixel measurement.
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Console, Effect, Schema } from "effect";
import { sceneFile } from "../../src/runtime/scene";
import { FILE_SLOT_NUMBERS, type GameFileKind, MalformedGameFile, preloadRecord } from "./boundary";
import { type Client, Clients, type DesktopFailure, waitFor } from "./clients";
import { describeCause } from "./command";
import { type Frame, type FrameFeature, decodePpm, encodePpm, frameProblems, measureFrame } from "./frameProbe";
import { dataDirectory, readGameFile } from "./gameFiles";
import { type SceneExpectations, type SceneProblem, type SceneReport, describeScene, readSceneLines, sceneProblems } from "./scene";
import { step } from "./timings";

const SceneLines = preloadRecord({ rest: "lines" }, Schema.Struct({ lines: Schema.Array(Schema.String) }));

/** A client's scene report file. */
export const SceneReportFile: GameFileKind<SceneReport> = {
  decode: (file, text) => Effect.gen(function*() {
    const read = readSceneLines((yield* SceneLines.decode(file, text)).lines);
    if ("problem" in read) return yield* new MalformedGameFile({ file, field: `line ${read.line}`, problem: read.problem });
    return read;
  }),
};

/** What a player would see wrong in one client, with the evidence and where it came from. */
export class PlayerViewFailure extends Schema.TaggedError<PlayerViewFailure>()("PlayerViewFailure", {
  client: Schema.String,
  /** The scene report or captured frame the problems were found in. */
  source: Schema.String,
  problems: Schema.Array(Schema.Struct({ seen: Schema.String, evidence: Schema.String })),
}) {
  override get message(): string {
    return `${this.client}: a player would see\n${this.problems.map(({ seen, evidence }) => `  - ${seen} (${evidence})`).join("\n")}\n  from ${this.source}`;
  }
}

export class FrameFileFailure extends Schema.TaggedError<FrameFileFailure>()("FrameFileFailure", {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Unknown,
}) {
  override get message(): string {
    return `${this.operation} failed for ${this.path}: ${describeCause(this.cause)}`;
  }
}

/** Keeps a frame on disk as a PPM image any viewer opens. */
export const writeFrame = (path: string, frame: Frame) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true });
      await Bun.write(path, encodePpm(frame));
    },
    catch: (cause) => new FrameFileFailure({ operation: "write frame", path, cause }),
  });

export const readFrame = (path: string) =>
  Effect.gen(function*() {
    const bytes = yield* Effect.tryPromise({ try: () => Bun.file(path).bytes(), catch: (cause) => new FrameFileFailure({ operation: "read frame", path, cause }) });
    const frame = decodePpm(bytes);
    if (frame === undefined) return yield* new FrameFileFailure({ operation: "decode frame", path, cause: "not an 8-bit binary PPM image" });
    return frame;
  });

export interface PlayerViewExpectations {
  /** The map's runtime file prefix (configureRuntime). */
  readonly filePrefix: string;
  /** For maps that start the scene recorder: what its report must show once the match has run `settledFrame` frames. */
  readonly scene?: SceneExpectations & { readonly settledFrame: number };
  /** What one captured frame must show. */
  readonly frame?: readonly FrameFeature[];
}

/** The newest scene report this client wrote after `since` that describes a settled match. */
const settledReport = (client: Client, since: number, filePrefix: string, settledFrame: number) => Effect.gen(function*() {
  let problem: MalformedGameFile | undefined;
  // Each client writes only its own slot's report.
  const newest = Effect.forEach(FILE_SLOT_NUMBERS, (slot) => {
    const path = join(dataDirectory(client.documents), sceneFile(slot, filePrefix));
    return readGameFile(path, SceneReportFile).pipe(
      Effect.map((file) => (file !== undefined && file.modified > since && file.value.frame >= settledFrame ? { path, report: file.value } : undefined)),
      // The game may be rewriting it; read it again on the next poll.
      Effect.catchTag("MalformedGameFile", (malformed) => Effect.sync(() => {
        problem = malformed;
        return undefined;
      })),
    );
  }).pipe(Effect.map((reports) => reports.find((found): found is { readonly path: string; readonly report: SceneReport } => found !== undefined)));
  return yield* waitFor(client, `scene report at frame ${settledFrame}`, 15, newest).pipe(
    Effect.catchTag("DesktopFailure", (timeout): Effect.Effect<never, DesktopFailure | MalformedGameFile> => (problem === undefined ? Effect.fail(timeout) : Effect.fail(problem))),
  );
});

/**
 * Checks every client's view of a match that started after `since`, keeping
 * each captured frame as FRAMES/CLIENT.ppm. Fails with what a player would see
 * wrong in each client that shows a problem.
 */
export const checkPlayerView = (expected: PlayerViewExpectations, since: number, frames: string) => Effect.gen(function*() {
  const clients = yield* Clients;
  const failures = yield* Effect.forEach(clients.all, (client) => Effect.gen(function*() {
    const problems: SceneProblem[] = [];
    const sources: string[] = [];
    if (expected.scene !== undefined) {
      const { path, report } = yield* settledReport(client, since, expected.filePrefix, expected.scene.settledFrame);
      problems.push(...sceneProblems(report, expected.scene));
      sources.push(path);
      yield* Console.log(`${client.name} scene: ${describeScene(report, expected.scene)}`);
    }
    if (expected.frame !== undefined) {
      const frame = yield* clients.capture(client);
      const path = join(frames, `${client.name}.ppm`);
      yield* writeFrame(path, frame);
      const results = measureFrame(frame, expected.frame);
      problems.push(...frameProblems(results));
      sources.push(path);
      yield* Console.log(`${client.name} frame: ${results.map(({ feature, present, measured }) => `${feature.name} ${present ? "present" : "absent"} (${measured})`).join("; ")}; ${path}`);
    }
    return problems.length === 0 ? [] : [new PlayerViewFailure({ client: client.name, source: sources.join(", "), problems })];
  }).pipe(step(`${client.name} player view`)), { concurrency: "unbounded" });
  const failed = failures.flat();
  const [first, ...others] = failed;
  if (first === undefined) return;
  // One failure carries every client's problems, so no client's report is lost.
  return yield* others.length === 0 ? first : new PlayerViewFailure({
    client: failed.map(({ client }) => client).join(", "),
    source: failed.map(({ source }) => source).join(", "),
    problems: failed.flatMap(({ client, problems }) => problems.map(({ seen, evidence }) => ({ seen: `${client}: ${seen}`, evidence }))),
  });
});
