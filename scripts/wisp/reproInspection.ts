import type { ReproInspection } from "../../src/runtime/repro";

export interface ReproFieldDiff {
  readonly path: string;
  /** Null means the canonical field is absent at this frame. */
  readonly before: string | null;
  readonly after: string | null;
}

/** Stable lexical field-path order; values remain the consumer's exact canonical text. */
export function diffReproStates(before: ReproInspection, after: ReproInspection): ReproFieldDiff[] {
  const left = new Map(before.fields.map(field => [field.path, field.value]));
  const right = new Map(after.fields.map(field => [field.path, field.value]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap(path => {
    const a = left.get(path) ?? null;
    const b = right.get(path) ?? null;
    return a === b ? [] : [{ path, before: a, after: b }];
  });
}
