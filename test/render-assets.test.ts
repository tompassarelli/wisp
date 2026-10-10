import { expect, test } from "bun:test";
import { Effect } from "effect";
import { resolveRenderAsset, type AssetLayer } from "../scripts/wisp/renderAssets";

const encoded = (text: string) => new TextEncoder().encode(text);
const readers = (map: Readonly<Record<string, string>>, stock: Readonly<Record<string, string>> = {}) => ({
  map: async (path: string) => map[path] === undefined ? undefined : encoded(map[path]),
  stock: async (path: string, layer: AssetLayer) => stock[`${layer}/${path}`] === undefined ? undefined : encoded(stock[`${layer}/${path}`]),
});

test("[spec #84] map overrides win over stock, a missing custom import never loads stock, and stock reads keep the request and selected layer for render.json", async () => {
  const result = await Effect.runPromise(resolveRenderAsset(readers({ "Unit.mdx": "override" }, { "_de.w3mod/Unit.mdx": "stock" }), "Unit.mdx", "definitive"));
  expect(new TextDecoder().decode(result.bytes)).toBe("override");
  const missing = await Effect.runPromise(resolveRenderAsset(readers({}, { "base/war3mapImported/Unit.mdx": "stock" }), "war3mapImported\\Unit.mdx", "definitive"));
  expect(missing.bytes).toBeUndefined();
  expect(missing.attempts.every(({ source }) => source === "map")).toBe(true);
  {
    const result = await Effect.runPromise(resolveRenderAsset(readers({}, { "_de.w3mod/Unit.mdx": "stock DE" }), "Unit.mdx", "definitive"));
    expect(result).toMatchObject({ requested: "Unit.mdx", graphics: "definitive", selected: { source: "stock", layer: "_de.w3mod", path: "Unit.mdx" } });
    expect(new TextDecoder().decode(result.bytes)).toBe("stock DE");
  }
  for (const path of ["../Unit.mdx", "/Unit.mdx", "C:\\Unit.mdx"]) {
    await expect(Effect.runPromise(resolveRenderAsset(readers({}), path))).rejects.toThrow("invalid map asset path");
  }
});
