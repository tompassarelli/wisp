// Lua32 float division loses bits above 2^24, and its % floors rather than truncating.

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function floorMod(a: number, b: number): number {
  return a - b * Math.floor(a / b);
}

export function idiv(a: number, b: number): number {
  const quotient = floorDiv(a, b);
  return quotient < 0 && quotient * b !== a ? quotient + 1 : quotient;
}

export function imod(a: number, b: number): number {
  const remainder = a - idiv(a, b) * b;
  return remainder < 0 ? remainder + b : remainder;
}
