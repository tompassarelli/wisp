// The path every unit walks: a square lap around the map center. It uses only
// integer arithmetic, so every client computes the same positions.
import { floorDiv, floorMod } from "wisp/src/sim/intMath";

/** Length of each side of the square. */
export const SIDE = 1024;
/** Distance walked per tick. */
export const STEP = 32;

export interface Offset {
  readonly x: number;
  readonly y: number;
}

/** Where `player`'s unit stands after `tick` ticks, relative to the center; each player walks half a lap ahead of the previous one. */
export function pathPoint(tick: number, player: number): Offset {
  const lap = 4 * SIDE;
  const half = floorDiv(SIDE, 2);
  const distance = floorMod(floorMod(tick, floorDiv(lap, STEP)) * STEP + player * floorDiv(lap, 2), lap);
  const along = floorMod(distance, SIDE);
  switch (floorDiv(distance, SIDE)) {
    case 0: return { x: along - half, y: -half };
    case 1: return { x: half, y: along - half };
    case 2: return { x: half - along, y: half };
    default: return { x: -half, y: half - along };
  }
}
