



import { f32 } from "../../src/sim/f32";

function Sin(value: number): number {
  return value;
}

export function libraries(a: number, b: number): number[] {
  return [
    f32(Math.sin(a)), // rejected
    f32(Math.atan2(a, b) * 2.0), // rejected
    f32(Math.sqrt(a)), // rejected
    Atan2(a, b), // rejected
    SquareRoot(a), // rejected
    GetRandomReal(a, b), // rejected
    Math.tan(a),
    f32(Sin(a)),
    f32(Math.abs(a)),
    Math.floor(b),
  ];
}
