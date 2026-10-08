import type { EffectDeaths } from "../../src/headless/client";
import type { Lockstep } from "../../src/headless/lockstep";
import { DYING } from "./cases";

/** DYING's Death sequence lasts two seconds; the other fixture model has none. */
export const EFFECT_DEATHS: EffectDeaths = (model) => (model === DYING ? 2 : undefined);

/** Frames after start at which the timeline reads what each client draws. */
const READS = [0, 60, 118, 122, 600];

/**
 * Starts the effects map and, at each read frame, lists every effect each
 * client draws as `x animation`, in creation order.
 */
export function deathTimeline(this: void, clients: Lockstep): string[] {
  const lines: string[] = [];
  clients.start();
  for (const frame of READS) {
    clients.frames(frame - clients.frame);
    for (const client of clients.clients) {
      const drawn = client.effectPoses().map(pose => `${Math.floor(pose.x)} ${pose.animation ?? "stand"}`);
      lines.push(`p${client.slot} drawn@${frame}=${drawn.join(",")}`);
    }
  }
  return lines;
}
