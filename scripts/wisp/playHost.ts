import { Effect, Layer } from "effect";
import { hostPlatform } from "../platform/layer";
import { linuxPlayHostLayer, linuxPlayMachineLayer, type PlayTools } from "../platform/linux/play";
import { PlatformUnsupported } from "../platform/services";
import { PlayDesktop, PlayMachine, PlayProblem } from "./play";
export { PLAY_TOOLS, type PlayTools, capacityDeferral, launchCommand } from "../platform/linux/play";

const refused = (platform: string) => Effect.fail(new PlayProblem({ problem: new PlatformUnsupported({ capability: "playing on the owner's desktop", platform }).message }));

export const playHostLayer = (display: string, tools: Partial<PlayTools> = {}, platform = hostPlatform()): Layer.Layer<PlayMachine | PlayDesktop, PlayProblem> =>
  platform === "linux" ? linuxPlayHostLayer(display, tools) : Layer.mergeAll(Layer.effect(PlayMachine, refused(platform)), Layer.effect(PlayDesktop, refused(platform)));

export const playMachineLayer = (tools: Partial<PlayTools> = {}, platform = hostPlatform()): Layer.Layer<PlayMachine, PlayProblem> =>
  platform === "linux" ? linuxPlayMachineLayer(tools) : Layer.effect(PlayMachine, refused(platform));
