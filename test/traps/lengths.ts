// Lua table length with nil elements can be any border; sparse arrays cannot determine synchronized length.

export function lengths(slots: (number | undefined)[], counts: readonly number[], record: { readonly targets: (number | undefined)[] }, words: string): number {
  let total = slots.length; // rejected
  total += record.targets.length; // rejected
  total += counts.length;
  total += words.length;
  return total;
}
