import type { HeadlessClient } from "../../src/headless/client";

const ORDERS: readonly (readonly [string, readonly (readonly [string, ...number[]])[]])[] = [
  ["a.mdx", [["BlzSetSpecialEffectMatrixScale", 2, 0, 3], ["BlzSetSpecialEffectYaw", 1]]],
  ["b.mdx", [["BlzSetSpecialEffectYaw", 1], ["BlzSetSpecialEffectMatrixScale", 2, 0, 3]]],
  ["c.mdx", [["BlzSetSpecialEffectMatrixScale", 2, 0, 3], ["BlzSetSpecialEffectPitch", 1]]],
  ["d.mdx", [["BlzSetSpecialEffectMatrixScale", 2, 0, 3], ["BlzSetSpecialEffectRoll", 1]]],
  ["e.mdx", [["BlzSetSpecialEffectMatrixScale", 2, 0, 3], ["BlzSetSpecialEffectOrientation", 1, 0, 0]]],
];

/** #118: a yaw, pitch, roll or orientation set after a matrix scale resets it to 1; the opposite order keeps it. One row per effect: model, yaw, matrix scale, flat. */
export function effectOrderRows(client: HeadlessClient): string[] {
  const call = (name: string, ...args: unknown[]) => (client.natives[name] as (this: void, ...args: unknown[]) => unknown)(...args);
  const models = new Set(ORDERS.map(([model]) => model));
  for (const [model, calls] of ORDERS) {
    const effect = call("AddSpecialEffect", model, 0, 0);
    for (const [name, ...args] of calls) call(name, effect, ...args);
  }
  return client.effectPoses().filter(pose => models.has(pose.model)).map(pose => `${pose.model} ${pose.yaw} ${pose.matrixScale.join(",")} ${String(pose.flat)}`);
}

export const EFFECT_ORDER_ROWS = ["a.mdx 1 1,1,1 false", "b.mdx 1 2,0,3 true", "c.mdx 0 1,1,1 false", "d.mdx 0 1,1,1 false", "e.mdx 1 1,1,1 false"];
