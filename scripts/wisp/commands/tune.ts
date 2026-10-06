// `wisp tune`: serves a panel on this computer that changes the game's
// declared values in a running match (wisp:docs/tune.md). Each change is a
// hot reload, installed in every client on the same frame or in none.
import { Console, Effect, Layer, Schema } from "effect";
import { type Command, UsageFailure, flagValues } from "../command";
import { GameFiles } from "../gameFiles";
import { HotReload } from "../hotReload";
import { MapBuild } from "../mapBuild";
import { SourceErrors } from "../sourceErrors";
import { Tune, type Tunable } from "../tune";
import { TUNE_PAGE } from "../tunePage";
import { step } from "../timings";
import { type HotProject, validateDataDirectories, waitForProcessStop } from "./hot";

export interface TuneProject extends HotProject {
  /** The directory each tunable's file is relative to. */
  readonly root: string;
  readonly tunables: readonly Tunable[];
}

export const DEFAULT_TUNE_PORT = 7341;

const ApplyRequest = Schema.Struct({ name: Schema.String, value: Schema.Finite });
const NameRequest = Schema.Struct({ name: Schema.String });

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Serves the panel on 127.0.0.1 until the scope closes; returns its address.
 * Requests must name this address as their host and post JSON, so another
 * site open in the browser can't change values or write the source.
 */
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
  const server = yield* Effect.acquireRelease(
    Effect.try({
      try: () => Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch: (request) => {
          const url = new URL(request.url);
          const host = request.headers.get("host");
          if (host !== `127.0.0.1:${url.port}` && host !== `localhost:${url.port}`) return json({ error: "the panel answers only its own address" }, 403);
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
        },
      }),
      catch: (cause) => new UsageFailure({ problem: `can't serve the panel on 127.0.0.1:${port}: ${String(cause)}` }),
    }),
    (server) => Effect.promise(() => server.stop(true)),
  );
  return `http://127.0.0.1:${server.port}/`;
});

/** `tune --data DIR [--data DIR ...] [--port N]`. */
export const makeTune = ({ project, sourceDirectory, sourceMapDirectory, filePrefix = "wisp", root, tunables }: TuneProject): Command => (args) => Effect.gen(function*() {
  const directories = yield* validateDataDirectories(flagValues(args, "data"));
  const [portText = String(DEFAULT_TUNE_PORT)] = flagValues(args, "port");
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return yield* new UsageFailure({ problem: `--port takes a port number, not ${portText}` });
  // The source files with the values the match runs; every compile reads these instead of the files.
  const replacements = new Map<string, string>();
  const services = Tune.layer(root, tunables, replacements).pipe(
    Layer.provideMerge(HotReload.layer(directories, filePrefix)),
    Layer.provideMerge(MapBuild.layer(project, () => replacements)),
    Layer.provideMerge(SourceErrors.layer({ sourceMapDirectory, filePrefix })),
    Layer.provideMerge(GameFiles.layer()),
  );
  yield* Effect.scoped(Effect.gen(function*() {
    // The first compile loads and checks the whole map, seconds a first change would otherwise wait.
    yield* (yield* MapBuild).compile.pipe(step("compile the map"));
    const address = yield* servePanel(port);
    yield* Console.log(`tuning ${tunables.length} value(s) of ${sourceDirectory} in ${directories.length} client(s): ${address}`);
    yield* waitForProcessStop;
  })).pipe(Effect.provide(services));
});
