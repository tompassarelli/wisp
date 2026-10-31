import { describeNumber, fixed, fixedWidth, parsedInteger, parsedReal, truncated } from "../../game/native/textFormat";
import type { NativeBehavior } from "../clientTypes";

export function mathNatives(): Readonly<Record<string, NativeBehavior>> {
  return {
    I2S: (n: number) => describeNumber(n),
    R2S: (n: number) => fixed(n, 3),
    R2SW: (n: number, width: number, precision: number) => fixedWidth(n, width, precision),
    R2I: (n: number) => truncated(n),
    I2R: (n: number) => n,
    S2I: (text: string) => parsedInteger(text),
    S2R: (text: string) => parsedReal(text),
    SubString: (text: string, start: number, end: number) => text.substring(start, end),
    StringLength: (text: string) => text.length,
    SquareRoot: (n: number) => Math.fround(Math.sqrt(n)),
    Atan2: (y: number, x: number) => Math.fround(Math.atan2(y, x)),
    BlzBitAnd: (a: number, b: number) => a & b,
    BlzBitOr: (a: number, b: number) => a | b,
    BlzBitXor: (a: number, b: number) => a ^ b,
  };
}
