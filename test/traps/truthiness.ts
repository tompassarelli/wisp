// JavaScript treats 0 and "" as false and Lua treats them as true, so a truthiness test of a number or string differs (smashcraft#389).

const sign = (x: number): -1 | 0 | 1 => (x > 0 ? 1 : x < 0 ? -1 : 0);
type Branded = number & { readonly brand: "frames" };

export function truthiness(x: number, count: number, name: string, frames: Branded, flag: boolean, target: { readonly x: number } | undefined, slots: { count?: number }): number {
  let facing = sign(x) || 1; // rejected: `||`
  facing += (flag && count) || 2; // rejected: `||`
  facing += count && 3; // rejected: `&&`
  slots.count ||= 4; // rejected: `||=`
  slots.count &&= 5; // rejected: `&&=`
  if (!count) facing++; // rejected: `!`
  if (frames) facing++; // rejected: an `if` condition
  if (flag && count) facing++; // rejected: an `if` condition
  while (count) count--; // rejected: a `while` condition
  for (let left = count; left; left--) facing++; // rejected: a `for` condition
  facing += name ? 1 : 0; // rejected: a `?:` condition
  if (flag) facing++;
  if (!flag || target === undefined) facing--;
  if (target && target.x !== 0) facing++;
  facing += target ? target.x : 0;
  facing += !!flag ? 1 : 0;
  if (count !== 0 && name !== "") facing++;
  return facing + (slots.count ?? 0);
}
