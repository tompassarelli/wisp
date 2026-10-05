// Rounds a real result to binary32, as Warcraft's Lua and Wurst's interpreter
// do for every real operation. Math.fround on the host; the warcraft-numbers
// plugin compiles f32(x) to x, because Lua numbers are already binary32.
export function f32(value: number): number {
  return Math.fround(value);
}
