// `wisp play [--keep-launch-options]`: from the owner's desktop to a match of
// the game's declared playtest (wisp:docs/play.md). The game declares its
// prefix, Steam shortcut, map, match setup and helper; `layer` provides what
// its own steps use.
import { Effect, Layer } from "effect";
import { type Command, UsageFailure } from "../command";
import { type PlayDeclaration, play } from "../play";
import { type PlayTools, playHostLayer } from "../playHost";

export const makePlay = <R>(declaration: PlayDeclaration<R>, layer: Layer.Layer<R>, tools: Partial<PlayTools> = {}): Command => (args) =>
  args.some((arg) => arg !== "--keep-launch-options")
    ? Effect.fail(new UsageFailure({ problem: "play takes only --keep-launch-options" }))
    : play(declaration, (line) => console.log(line), { keepLaunchOptions: args.includes("--keep-launch-options") }).pipe(
      Effect.provide(Layer.merge(playHostLayer(declaration.display, tools), layer)),
    );
