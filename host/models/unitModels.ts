import { Effect, Schema } from "effect";

export const UnitModels = Schema.Struct({
  units: Schema.Array(Schema.Struct({
    id: Schema.String,
    path: Schema.String,
    scale: Schema.Finite.check(Schema.isGreaterThan(0)),
  })),
});
export type UnitModels = typeof UnitModels.Type;
export interface ModelSource { readonly entry: string; readonly source: string }

class UnitModelsFailure extends Schema.TaggedError<UnitModelsFailure>()("UnitModelsFailure", { problem: Schema.String }) {
  override get message() { return this.problem; }
}

const modelKey = (path: string) => path.replaceAll("/", "\\").toLowerCase().replace(/\.mdl$/, ".mdx");

export const checkUnitModels = (declaration: UnitModels, sources: readonly ModelSource[]) => Effect.gen(function*() {
  const decoded = yield* Schema.decodeEffect(UnitModels)(declaration).pipe(
    Effect.mapError((cause) => new UnitModelsFailure({ problem: cause.message })),
  );
  const paths = new Map(sources.map((source) => [modelKey(source.entry), source.source]));
  const problems: string[] = [];
  for (const unit of decoded.units) {
    const source = paths.get(modelKey(unit.path));
    const exists = source === undefined ? false : yield* Effect.tryPromise({
      try: () => Bun.file(source).exists(),
      catch: (cause) => new UnitModelsFailure({ problem: `unit ${unit.id}: cannot read ${unit.path}: ${String(cause)}` }),
    });
    if (!exists) problems.push(`unit ${unit.id}: unresolved model ${unit.path}`);
  }
  if (problems.length > 0) return yield* new UnitModelsFailure({ problem: problems.join("\n") });
});

interface UnitModelChange {
  readonly id: string;
  readonly field: "path" | "scale";
  readonly before: string | number | undefined;
  readonly after: string | number | undefined;
}

export function compareUnitModels(before: UnitModels, after: UnitModels): readonly UnitModelChange[] {
  const changes: UnitModelChange[] = [];
  const old = new Map(before.units.map((unit) => [unit.id, unit]));
  const next = new Map(after.units.map((unit) => [unit.id, unit]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    for (const field of ["path", "scale"] as const) {
      const a = old.get(id)?.[field], b = next.get(id)?.[field];
      if (a !== b) changes.push({ id, field, before: a, after: b });
    }
  }
  return changes;
}
