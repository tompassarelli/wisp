import { expect, test } from "bun:test";
import { Effect } from "effect";
import { headlessArguments } from "../scripts/wisp/commands/headless";
import { resolveRenderAsset, type AssetLayer } from "../scripts/wisp/renderAssets";

const encoded = (text: string) => new TextEncoder().encode(text);
const readers = (map: Readonly<Record<string, string>>, stock: Readonly<Record<string, string>> = {}) => ({
  map: async (path: string) => map[path] === undefined ? undefined : encoded(map[path]),
  stock: async (path: string, layer: AssetLayer) => stock[`${layer}/${path}`] === undefined ? undefined : encoded(stock[`${layer}/${path}`]),
});

test("[native] #84 Definitive draws either lone Cairne alias and Classic ignores the DE alias", async () => {
  // Warcraft 3.0.1: https://github.com/tompassarelli/smashcraft/issues/334#issuecomment-6069629530
  const body = "units/orc/HeroTaurenChieftain/HeroTaurenChieftain.mdx";
  for (const [graphics, alias, expected] of [
    ["definitive", "_de.w3mod", "_de.w3mod"],
    ["definitive", "_hd.w3mod", "_hd.w3mod"],
    ["classic", "_de.w3mod", "base"],
  ] as const) {
    const imports = readers({ [body]: "classic", [`${alias}/${body}`]: "definitive" });
    const result = await Effect.runPromise(resolveRenderAsset(imports, body.replace(/\.mdx$/, ".mdl").replaceAll("/", "\\"), graphics));
    expect(new TextDecoder().decode(result.bytes)).toBe(graphics);
    expect(result.selected).toEqual({ source: "map", layer: expected, path: expected === "base" ? body : `${expected}/${body}` });
    expect(result.attempts.at(-1)).toEqual(result.selected);
  }
  expect(headlessArguments(["--render", "/private/render", "--frames", "1", "--graphics", "definitive"]).graphics).toBe("definitive");
});

test("[spec #84] map overrides win over stock and a missing custom import never loads stock", async () => {
  const result = await Effect.runPromise(resolveRenderAsset(readers({ "Unit.mdx": "override" }, { "_de.w3mod/Unit.mdx": "stock" }), "Unit.mdx", "definitive"));
  expect(new TextDecoder().decode(result.bytes)).toBe("override");
  const missing = await Effect.runPromise(resolveRenderAsset(readers({}, { "base/war3mapImported/Unit.mdx": "stock" }), "war3mapImported\\Unit.mdx", "definitive"));
  expect(missing.bytes).toBeUndefined();
  expect(missing.attempts.every(({ source }) => source === "map")).toBe(true);
});

test("[spec #84] stock layer reads keep the request and selected layer for render.json", async () => {
  const result = await Effect.runPromise(resolveRenderAsset(readers({}, { "_de.w3mod/Unit.mdx": "stock DE" }), "Unit.mdx", "definitive"));
  expect(result).toMatchObject({ requested: "Unit.mdx", graphics: "definitive", selected: { source: "stock", layer: "_de.w3mod", path: "Unit.mdx" } });
  expect(new TextDecoder().decode(result.bytes)).toBe("stock DE");
});

test("[invariant] an explicit layer path is read once and asset paths cannot escape the install", async () => {
  const result = await Effect.runPromise(resolveRenderAsset(readers({ "_de.w3mod/Unit.mdx": "DE" }), "_de.w3mod\\Unit.mdx", "definitive"));
  expect(result.attempts).toHaveLength(1);
  for (const path of ["../Unit.mdx", "/Unit.mdx", "C:\\Unit.mdx"]) {
    await expect(Effect.runPromise(resolveRenderAsset(readers({}), path))).rejects.toThrow("invalid map asset path");
  }
});
