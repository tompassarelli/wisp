// Which captured poses Warcraft draws (wisp:docs/headless.md, "Lighting, fog and sky": far cull and world bounds).
import type { WorldBounds } from "./terrain";

interface Placed {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly alpha: number;
  readonly scale: number;
  readonly flat: boolean;
  readonly unit?: true;
}

/**
 * The poses drawn: seen (alpha and scale above 0, not flattened), origin
 * within the far plane from the eye, and, for an effect, origin inside the
 * world bounds. A part reaching nearer or inside doesn't keep a model whose
 * origin lies out.
 */
export function drawnPoses<T extends Placed>(poses: readonly T[], eye: readonly number[], far: number, world?: WorldBounds): T[] {
  const [ex = 0, ey = 0, ez = 0] = eye;
  const outside = (pose: T) => world !== undefined && pose.unit !== true && (pose.x < world.minX || pose.x > world.maxX || pose.y < world.minY || pose.y > world.maxY);
  return poses.filter((pose) => pose.alpha > 0 && pose.scale > 0 && !pose.flat && Math.hypot(pose.x - ex, pose.y - ey, pose.z - ez) <= far && !outside(pose));
}
