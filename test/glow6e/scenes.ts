import { installHeadless } from "../../host/headless/headless";
import { captureScene } from "../../host/render/headlessRender";
import type { RenderScene } from "../../host/render/renderScene";
import { PHASES, PHASE_SECONDS, START_SECONDS } from "./layout";
import { GLOW_NOOPS, install, start } from "./main";

/** Runs the map headless and records each phase's scene half-way through it. */
export function phaseScenes(): Map<string, RenderScene> {
  const runtime = installHeadless({ filePrefix: "glow6e", globalPrefixes: ["__glow6e"], intentionalNoops: GLOW_NOOPS });
  const clients = runtime.clients({ install, start }, [0, 1], {});
  clients.start();
  const client = clients.clients[0];
  if (client === undefined) throw new Error("no headless client");
  const scenes = new Map<string, RenderScene>();
  clients.frames((START_SECONDS + PHASE_SECONDS / 2) * 60);
  for (const [index, phase] of PHASES.entries()) {
    if (index > 0) clients.frames(PHASE_SECONDS * 60);
    scenes.set(phase.name, captureScene(client));
  }
  runtime.restore();
  return scenes;
}
