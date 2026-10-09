import type { EffectDeaths } from "../../src/headless/client";
import type { Lockstep } from "../../src/headless/lockstep";
import { DYING } from "./cases";


export const EFFECT_DEATHS: EffectDeaths = (model) => (model === DYING ? 2 : undefined);


const READS = [0, 60, 118, 122, 299, 300, 600];





export function deathTimeline(this: void, clients: Lockstep): string[] {
  const lines: string[] = [];
  clients.start();
  for (const frame of READS) {
    clients.frames(frame - clients.frame);
    for (const client of clients.clients) {
      const drawn = client.effectPoses().filter(pose => pose.model === DYING).map(pose => `${Math.floor(pose.x)} ${pose.animation ?? "stand"}`);
      lines.push(`p${client.slot} drawn@${frame}=${drawn.join(",")}`);
    }
  }
  return lines;
}
