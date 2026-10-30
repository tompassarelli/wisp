import { Effect, Layer } from "effect";
import { PlayDesktop, PlayMachine, PlayProblem } from "./play";
import { hostPlatform } from "../os/platform/layer";
import { linuxPlayHostLayer, linuxPlayMachineLayer, type PlayTools } from "./linuxLaunch";
import { PlatformUnsupported } from "../contract/services";
export type { PlayTools } from "./linuxLaunch";

const refused = (platform: string) => Effect.fail(new PlayProblem({ problem: new PlatformUnsupported({ capability: "playing on the owner's desktop", platform }).message }));

export const playHostLayer = (display: string, tools: Partial<PlayTools> = {}, platform = hostPlatform()): Layer.Layer<PlayMachine | PlayDesktop, PlayProblem> =>
  platform === "linux" ? linuxPlayHostLayer(display, tools) : Layer.mergeAll(Layer.effect(PlayMachine, refused(platform)), Layer.effect(PlayDesktop, refused(platform)));

export const playMachineLayer = (tools: Partial<PlayTools> = {}, platform = hostPlatform()): Layer.Layer<PlayMachine, PlayProblem> =>
  platform === "linux" ? linuxPlayMachineLayer(tools) : Layer.effect(PlayMachine, refused(platform));
