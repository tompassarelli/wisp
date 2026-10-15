import type { NativeBehavior } from "../clientTypes";
import { describeNumber, fixed, leadingNumber } from "../jassFormat";

export function mathNatives(): Readonly<Record<string, NativeBehavior>> {
  return {
    I2S: (n: number) => describeNumber(n),
    R2S: (n: number) => fixed(n, 3),
    R2SW: (n: number, width: number, precision: number) => {
      // R2SW pads to width and rounds to at least one decimal (wisp:docs/warsmash-notes.md, Script rules).
      let text = fixed(n, precision > 0 ? precision : 0);
      if (precision <= 0) text = `${text}.0`;
      while (text.length < width + 1) text = ` ${text}`;
      return text;
    },
    R2I: (n: number) => (n < 0 ? Math.ceil(n) : Math.floor(n)),
    I2R: (n: number) => n,
    S2I: (text: string) => {
      const value = leadingNumber(text, false);
      return value < 0 ? Math.ceil(value) : Math.floor(value);
    },
    S2R: (text: string) => Math.fround(leadingNumber(text, true)),
    SubString: (text: string, start: number, end: number) => text.substring(start, end),
    StringLength: (text: string) => text.length,
    SquareRoot: (n: number) => Math.fround(Math.sqrt(n)),
    Atan2: (y: number, x: number) => Math.fround(Math.atan2(y, x)),
    BlzBitAnd: (a: number, b: number) => a & b,
    BlzBitOr: (a: number, b: number) => a | b,
    BlzBitXor: (a: number, b: number) => a ^ b,
  };
}
