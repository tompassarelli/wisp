import { Effect, Schema } from "effect";

const ModeModel = Schema.Struct({
  path: Schema.String,
  scale: Schema.Finite.check(Schema.isGreaterThan(0)),
});
export const UnitModels = Schema.Struct({
  scaleTolerance: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  units: Schema.Array(Schema.Struct({ id: Schema.String, classic: ModeModel, definitive: ModeModel })),
});
export type UnitModels = typeof UnitModels.Type;
export interface ModelSource { readonly entry: string; readonly source: string }

export class UnitModelsFailure extends Schema.TaggedError<UnitModelsFailure>()("UnitModelsFailure", { problem: Schema.String }) {
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
    for (const mode of ["classic", "definitive"] as const) {
      const model = unit[mode], source = paths.get(modelKey(model.path));
      const exists = source === undefined ? false : yield* Effect.tryPromise({
        try: () => Bun.file(source).exists(),
        catch: (cause) => new UnitModelsFailure({ problem: `unit ${unit.id} ${mode}: cannot read ${model.path}: ${String(cause)}` }),
      });
      if (!exists) problems.push(`unit ${unit.id} ${mode}: unresolved model ${model.path}`);
    }
    const difference = Math.abs(unit.classic.scale - unit.definitive.scale);
    if (difference > decoded.scaleTolerance) problems.push(`unit ${unit.id}: classic scale ${unit.classic.scale}, definitive scale ${unit.definitive.scale}, difference ${difference} exceeds tolerance ${decoded.scaleTolerance}`);
  }
  if (problems.length > 0) return yield* new UnitModelsFailure({ problem: problems.join("\n") });
});

export interface UnitModelChange {
  readonly id: string;
  readonly mode: "classic" | "definitive";
  readonly field: "path" | "scale";
  readonly before: string | number | undefined;
  readonly after: string | number | undefined;
}

export function compareUnitModels(before: UnitModels, after: UnitModels): readonly UnitModelChange[] {
  const changes: UnitModelChange[] = [];
  const old = new Map(before.units.map((unit) => [unit.id, unit]));
  const next = new Map(after.units.map((unit) => [unit.id, unit]));
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    for (const mode of ["classic", "definitive"] as const) {
      for (const field of ["path", "scale"] as const) {
        const a = old.get(id)?.[mode][field], b = next.get(id)?.[mode][field];
        if (a !== b) changes.push({ id, mode, field, before: a, after: b });
      }
    }
  }
  return changes;
}
