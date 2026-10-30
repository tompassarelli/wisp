// The inputs Smashcraft's Autoland refused at the Lua32 compile (wisp#129):
// the check command must report each on the same line as the compile.
export function refused(cooldown: number, charge: number, frame: number, label: string): number {
  const ready = cooldown || charge || 1; // smashcraft runs 38014208049 and 38014439766, after the 738a6372 pin
  const slot = frame % 4; // smashcraft run 38038555931
  const reach = 10.6; // smashcraft run 38057549849: pitLordMoves.ts:224
  if (label) return ready + slot + reach; // the same rule as an `if` condition
  return cooldown > 0 || charge > 0 ? 1 : 0; // booleans: neither reports
}

export const pattern = /^[a-z]+$/; // smashcraft runs 38890506862, 39131342098 and 39137573264: specialCues.tests.ts, stageRules.ts
export const slots = [undefined, 0, 1]; // smashcraft run 39390603730: fighterCopy.tests.ts
export const anyFlag = (flags: readonly boolean[]) => flags.some(Boolean); // smashcraft d1b8128934: an empty select panel (wisp#118)
