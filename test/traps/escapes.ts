// Game code states its types; it doesn't assert them away.
const rows: number[] = [1, 2];
export const first = rows[0]!; // rejected
export const checked = rows[0] ?? 0;
export function loose(value: any): number { // rejected
  return Number(value);
}
export const forced = "1" as unknown as number; // rejected
export const widened = 1 as number;
