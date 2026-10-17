import type { model } from "../../vendor/war3-model.mjs";
import type { DrawnPose, PopcornEmitterPose, UnsupportedEmitterPose } from "./headlessRender";
import { type Matrix, multiply } from "../browser/matrix";
import type { Sampler } from "./screen";

export function emitterInventory(pose: DrawnPose, data: model.Model, sampler: Sampler, placed: Matrix, popcornEmitters: PopcornEmitterPose[], unsupportedEmitters: UnsupportedEmitterPose[]): void {
  const emitters = [...(data.ParticleEmitterPopcorns ?? []).map((emitter) => ({ emitter, kind: "popcorn" as const })), ...data.ParticleEmitters.map((emitter) => ({ emitter, kind: "model particle" as const }))];
  for (const { emitter, kind } of emitters) {
    const alpha = "Alpha" in emitter ? sampler.interp.animVectorVal(emitter.Alpha, 1) : 1;
    const visible = pose.alpha > 0 && sampler.interp.animVectorVal(emitter.Visibility, 1) > 0 && alpha > 0;
    const node = sampler.rendererData.nodes[emitter.ObjectId];
    if (node === undefined) throw new Error(`missing node for ${kind} emitter "${emitter.Name}"`);
    const world = multiply(placed, node.matrix), pivot = emitter.PivotPoint ?? data.PivotPoints[emitter.ObjectId];
    const position = [0, 1, 2].map((row) => (world[12 + row] ?? 0) + [0, 1, 2].reduce((sum, axis) => sum + (world[axis * 4 + row] ?? 0) * (pivot?.[axis] ?? 0), 0)) as [number, number, number];
    const scale = [0, 1, 2].map((axis) => Math.hypot(world[axis * 4] ?? 0, world[axis * 4 + 1] ?? 0, world[axis * 4 + 2] ?? 0)) as [number, number, number];
    const entry = { model: pose.model, handle: pose.handle.id, emitter: emitter.Name || `${kind}#${emitter.ObjectId}`, effect: emitter.Path ?? "", position, scale };
    unsupportedEmitters.push({ ...entry, kind, objectId: emitter.ObjectId, visible, supported: kind === "popcorn" });
    if (visible && kind === "popcorn") popcornEmitters.push(entry);
  }
}

export const undrawnEmitters = (unsupportedEmitters: readonly UnsupportedEmitterPose[]): string[] =>
  unsupportedEmitters.filter((emitter) => emitter.visible && !emitter.supported).map((emitter) => `${emitter.model}: undrawn version-1 model emitter "${emitter.emitter}" (${emitter.effect || "no effect path"})`);
