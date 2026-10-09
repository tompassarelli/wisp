import { expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { checkUnitModels, compareUnitModels, type UnitModels } from "../scripts/wisp/unitModels";

const directory = mkdtempSync(join(tmpdir(), "wisp-unit-models-"));
const source = join(directory, "synthetic.mdx");
writeFileSync(source, "source-owned synthetic model placeholder; resolution only");
const sources = [
  { entry: "Models\\Classic.mdx", source },
  { entry: "Models\\Definitive.mdx", source },
];
const declaration = (scale = 1.05): UnitModels => ({
  scaleTolerance: 0.1,
  units: [{ id: "u097", classic: { path: "Models\\Classic.mdl", scale: 1 }, definitive: { path: "Models\\Definitive.mdx", scale } }],
});

test("[spec #97] missing mode models report unit ID, mode and path; a complete pair passes", async () => {
  await Effect.runPromise(checkUnitModels(declaration(), sources));
  for (const [mode, missing] of [["classic", "Classic.mdl"], ["definitive", "Definitive.mdx"]] as const) {
    const available = sources.filter((item) => !item.entry.toLowerCase().includes(mode));
    await expect(Effect.runPromise(checkUnitModels(declaration(), available))).rejects.toThrow(`unit u097 ${mode}: unresolved model Models\\${missing}`);
  }
  await expect(Effect.runPromise(checkUnitModels(declaration(), [{ ...sources[0]!, source: join(directory, "absent.mdx") }, sources[1]!]))).rejects.toThrow("unit u097 classic: unresolved model");
});

test("[spec #97] absolute mode scale differences above tolerance fail with both values; below passes", async () => {
  await Effect.runPromise(checkUnitModels(declaration(1.05), sources));
  await expect(Effect.runPromise(checkUnitModels(declaration(1.2), sources))).rejects.toThrow("classic scale 1, definitive scale 1.2");
  await expect(Effect.runPromise(checkUnitModels({ ...declaration(), scaleTolerance: -1 }, sources))).rejects.toThrow();
});

test("[spec #97] comparison identifies only the changed unit mode fields in supplied observations", () => {
  const before = declaration();
  const after: UnitModels = { ...before, units: [{ ...before.units[0]!, definitive: { path: "Models\\Edited.mdx", scale: 1.2 } }] };
  expect(compareUnitModels(before, after)).toEqual([
    { id: "u097", mode: "definitive", field: "path", before: "Models\\Definitive.mdx", after: "Models\\Edited.mdx" },
    { id: "u097", mode: "definitive", field: "scale", before: 1.05, after: 1.2 },
  ]);
});
