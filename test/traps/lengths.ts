// In Lua the length of a table with nil in it is any border, so an array that
// may hold undefined keeps its count elsewhere.
export function lengths(slots: (number | undefined)[], counts: readonly number[], record: { readonly targets: (number | undefined)[] }, words: string): number {
  let total = slots.length; // rejected
  total += record.targets.length; // rejected
  total += counts.length;
  total += words.length;
  return total;
}
