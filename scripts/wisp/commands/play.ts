// `wisp play`: from the owner's desktop to a match of the game's declared
// playtest (wisp:docs/play.md). The game declares its prefix, Steam shortcut,
// map, opponent and helper; `layer` provides what its own steps use.
import { Effect, Layer } from "effect";
import { type Command, UsageFailure } from "../command";
import { type PlayDeclaration, play } from "../play";
import { type PlayTools, playHostLayer } from "../playHost";

export const makePlay = <R>(declaration: PlayDeclaration<R>, layer: Layer.Layer<R>, tools: Partial<PlayTools> = {}): Command => (args) =>
  args.length > 0
    ? Effect.fail(new UsageFailure({ problem: "play takes no arguments" }))
    : play(declaration, (line) => console.log(line)).pipe(Effect.provide(Layer.merge(playHostLayer(declaration.display, tools), layer)));
