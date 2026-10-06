/// <reference path="../../src/natives/warcraft.d.ts" />
// Each platform's math library differs by an ulp, and a headless replay
// can't repeat Warcraft's own math or random numbers.
function Sin(value: number): number {
  return value;
}

export function libraries(a: number, b: number): number[] {
  return [
    Math.sin(a), // rejected
    Math.atan2(a, b), // rejected
    Math.sqrt(a), // rejected
    Atan2(a, b), // rejected
    SquareRoot(a), // rejected
    GetRandomReal(a, b), // rejected
    Sin(a),
    Math.abs(a),
    Math.floor(b),
  ];
}
