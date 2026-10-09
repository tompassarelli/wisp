
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no element ${index} in a table of ${items.length}`);
  return item;
}
