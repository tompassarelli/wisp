import { Console, Effect, Layer, Schema } from "effect";
import { type Command, UsageFailure, flagValues, portFlag } from "../command";
import { GameFiles } from "../gameFiles";
import { HotReload } from "../hotReload";
import { MapBuild } from "../mapBuild";
import { SourceErrors } from "../sourceErrors";
import { Tune, type Tunable } from "../tune";
import { TUNE_PAGE } from "../tunePage";
import { step } from "../timings";
import { panelServer } from "../panelServer";
import { type HotProject, validateDataDirectories, waitForProcessStop } from "./hot";

export interface TuneProject extends HotProject {

  readonly root: string;
  readonly tunables: readonly Tunable[];
}

export const DEFAULT_TUNE_PORT = 7341;

const ApplyRequest = Schema.Struct({ name: Schema.String, value: Schema.Finite });
const NameRequest = Schema.Struct({ name: Schema.String });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const servePanel = (port: number) => Effect.gen(function*() {
  const tune = yield* Tune;
  const context = yield* Effect.context<never>();
  const run = <A>(effect: Effect.Effect<A, { readonly message: string }>) =>
    Effect.runPromiseWith(context)(effect.pipe(
      Effect.map((body) => json(body)),
      Effect.catch((failure) => Effect.succeed(json({ error: failure.message }, 400))),
    ));
  const decode = <S extends Schema.Top>(schema: S, request: Request) =>
    Effect.tryPromise({ try: () => request.json(), catch: () => new UsageFailure({ problem: "the request is not JSON" }) }).pipe(
      Effect.flatMap((body) => Schema.decodeUnknownEffect(schema)(body)),
      Effect.mapError((cause) => new UsageFailure({ problem: cause.message })),
    );
  const server = yield* panelServer(port, (request) => {
          const url = new URL(request.url);
          if (request.method === "GET" && url.pathname === "/") return new Response(TUNE_PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
          if (request.method === "GET" && url.pathname === "/tunables") return run(tune.state);
          if (request.method !== "POST" || request.headers.get("content-type")?.startsWith("application/json") !== true) return json({ error: "not found" }, 404);
          switch (url.pathname) {
            case "/apply":
              return run(decode(ApplyRequest, request).pipe(Effect.flatMap(({ name, value }) => tune.apply(name, value))));
            case "/keep":
              return run(decode(NameRequest, request).pipe(Effect.flatMap(({ name }) => tune.keep(name)), Effect.map((diff) => ({ diff }))));
            case "/reset":
              return run(decode(NameRequest, request).pipe(Effect.flatMap(({ name }) => tune.reset(name))));
            default:
              return json({ error: "not found" }, 404);
          }
        }).pipe(Effect.mapError(cause => new UsageFailure({ problem: `can't serve the panel on 127.0.0.1:${port}: ${String(cause)}` })));
  return `http://127.0.0.1:${server.port}/`;
});

export const makeTune = ({ project, sourceDirectory, sourceMapDirectory, filePrefix = "wisp", root, tunables }: TuneProject): Command => (args) => Effect.gen(function*() {
  const directories = yield* validateDataDirectories(flagValues(args, "data"));
  const port = portFlag(args, DEFAULT_TUNE_PORT, { min: 0 });
  if (port instanceof UsageFailure) return yield* port;

  const replacements = new Map<string, string>();
  const services = Tune.layer(root, tunables, replacements).pipe(
    Layer.provideMerge(HotReload.layer(directories, filePrefix)),
    Layer.provideMerge(MapBuild.layer(project, () => replacements)),
    Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory, filePrefix })),
    Layer.provideMerge(GameFiles.layer()),
  );
  yield* Effect.scoped(Effect.gen(function*() {

    yield* (yield* MapBuild).compile.pipe(step("compile the map"));
    const address = yield* servePanel(port);
    yield* Console.log(`tuning ${tunables.length} value(s) of ${sourceDirectory} in ${directories.length} client(s): ${address}`);
    yield* waitForProcessStop;
  })).pipe(Effect.provide(services));
});
