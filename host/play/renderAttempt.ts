import { Effect, Schema } from "effect";
import { RenderFailure } from "../render/headlessRender";

export const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (cause) => new RenderFailure({ cause }) });
export const failed = (problem: string) => new RenderFailure({ cause: new Error(problem) });

export const problemOf = (failure: RenderFailure) => (failure.cause instanceof Error ? failure.cause.message : String(failure.cause));
export const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(Effect.mapError((cause) => failed(cause.message)));

export const thrownAsFailure = Effect.catchDefect((cause) => Effect.fail(new RenderFailure({ cause })));
