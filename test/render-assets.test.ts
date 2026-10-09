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

test("[native] #91 explicit Cairne DDS imports resolve in the HD body alias and report all five rows", async () => {

  const hashes = ["e21b4dc2716ec2d55d5b2e463a717d18cf1cfe291c307ff9fdb7ea59518561b9", "52a752a5c355a36010bdcec3fe749caee4234e9b1bcbe9e5e71f4a6b164848f4", "cfa7424fbbbe3c3420d6ec782aadce62190eab36e103201325cafb7bf07c8a0f", "50947f5bc5912c7e60aae029b69913179db6cca478bceaacd24dd41a8ac07fc3", "8555afc6182719e3e6100e441adb73c4cae7cb45f852114b44895a2fc1a8c70b"];
  const body = { source: "map", layer: "_hd.w3mod", path: "_hd.w3mod/war3mapImported/Cairne.mdx" } as const;
  for (const hash of hashes) {
    const texture = `war3mapImported/DefinitiveTexture-${hash}.dds`;
    const selectedPath = `_hd.w3mod/${texture}`;
    const explicit = await Effect.runPromise(resolveRenderAsset(readers({ [selectedPath]: "explicit" }), texture, "definitive", body));
    expect(explicit).toMatchObject({ requested: texture, bodyAlias: body.layer, selectedPath, suffixConversion: "none", selected: { source: "map", layer: body.layer, path: selectedPath } });
    expect(new TextDecoder().decode(explicit.bytes)).toBe("explicit");
  }
});

test("[native] #91 old imported HD body refuses missing HD stock; good pilot selected stock DE body resolves", async () => {


  const texture = "Units/Orc/HeroTaurenChieftain/Tauren_Chieftain_Diffuse.tif";
  const dds = texture.replace(/\.tif$/, ".dds");
  const assets = readers({}, { [`_de.w3mod/${dds}`]: "native stock" });
  for (const [name, source, layer, expected] of [
    ["old candidate", "map", "_hd.w3mod", undefined],
    ["good pilot stock body", "stock", "_de.w3mod", "stock"],
  ] as const) {
    const result = await Effect.runPromise(resolveRenderAsset(assets, texture, "definitive", { source, layer, path: "Cairne.mdx" }));
    expect(result.selected?.source, name).toBe(expected);
    expect(result.bodyAlias, name).toBe(layer);
    expect(result.selectedPath, name).toBe(expected === undefined ? null : `_de.w3mod/${dds}`);
    expect(result.suffixConversion, name).toBe(".tif → .dds");
  }
});

test("[repro #82] installed DE skies read shared base weather textures while imported HD bodies keep their layer", async () => {

  const texture = "ReplaceableTextures/Weather/RaysOfLight.tif";
  const assets = readers({}, { [`base/${texture}`]: "shared weather" });
  const stock = await Effect.runPromise(resolveRenderAsset(assets, texture, "definitive", { source: "stock", layer: "_de.w3mod", path: "Environment/Sky/Outland_Sky/Outland_Sky.mdx" }));
  expect(new TextDecoder().decode(stock.bytes)).toBe("shared weather");
  expect(stock.selected).toEqual({ source: "stock", layer: "base", path: texture });
  const imported = await Effect.runPromise(resolveRenderAsset(assets, texture, "definitive", { source: "map", layer: "_hd.w3mod", path: "war3mapImported/Body.mdx" }));
  expect(imported.bytes).toBeUndefined();
  expect(imported.attempts.filter(({ source }) => source === "stock").map(({ layer }) => layer)).toEqual(["_hd.w3mod"]);
});
