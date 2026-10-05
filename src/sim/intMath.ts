// Integer arithmetic with identical results on the host and in Warcraft's Lua,
// whose integers are 32-bit and whose numbers are binary32. Float division
// loses bits above 2^24, and Lua's % floors where JavaScript's truncates, so
// synchronized code uses these instead of `/` with Math.floor or `%`.
// The warcraft-numbers plugin compiles floorDiv and floorMod to Lua's // and %.

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function floorMod(a: number, b: number): number {
  return a - b * Math.floor(a / b);
}

/** Wurst `div`: the quotient truncated toward zero. */
export function idiv(a: number, b: number): number {
  const quotient = floorDiv(a, b);
  return quotient < 0 && quotient * b !== a ? quotient + 1 : quotient;
}

/** Wurst `mod`: the truncated remainder, plus b when it is negative. */
export function imod(a: number, b: number): number {
  const remainder = a - idiv(a, b) * b;
  return remainder < 0 ? remainder + b : remainder;
}
