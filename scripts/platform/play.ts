import { Effect, Layer } from "effect";
import { PlayDesktop, PlayMachine, PlayProblem } from "../wisp/play";
import { hostPlatform } from "./layer";
import { linuxPlayHostLayer, linuxPlayMachineLayer, type PlayTools } from "./linux/play";
import { PlatformUnsupported } from "./services";
export type { PlayTools } from "./linux/play";

const refused = (platform: string) => Effect.fail(new PlayProblem({ problem: new PlatformUnsupported({ capability: "playing on the owner's desktop", platform }).message }));

export const playHostLayer = (display: string, tools: Partial<PlayTools> = {}, platform = hostPlatform()): Layer.Layer<PlayMachine | PlayDesktop, PlayProblem> =>
  platform === "linux" ? linuxPlayHostLayer(display, tools) : Layer.mergeAll(Layer.effect(PlayMachine, refused(platform)), Layer.effect(PlayDesktop, refused(platform)));

export const playMachineLayer = (tools: Partial<PlayTools> = {}, platform = hostPlatform()): Layer.Layer<PlayMachine, PlayProblem> =>
  platform === "linux" ? linuxPlayMachineLayer(tools) : Layer.effect(PlayMachine, refused(platform));
