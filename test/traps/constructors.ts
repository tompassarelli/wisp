export function constructors(flags: readonly boolean[], values: readonly unknown[], count: number): unknown[] {
  return [
    flags.some(Boolean), // rejected
    values.map(String), // rejected
    Boolean(count), // rejected
    Object(count), // rejected
    values instanceof Array, // rejected
    flags.some((flag) => flag),
    Number("1"),
    String(count),
    Number.isInteger(count),
    Object.keys(values),
    Array.isArray(values),
    new Array<number>(),
  ];
}

export const stored = Number; // rejected
export const label: String = "";
