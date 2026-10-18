import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { resolveRenderAsset } from "../host/render/renderAssets";

const encoded = (text: string) => new TextEncoder().encode(text);

test("[property seed 84] lookups read the map before stock, select the first file found, and never read stock for a custom import [spec #84]", async () => {
  let seed = 84;
  const next = (below: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 16) % below;
  };
  for (let sample = 0; sample < 300; sample++) {
    const name = ["Unit.mdx", "Units\\Hero.mdl", "war3mapImported\\Deck.mdx", "WAR3MAPIMPORTED/deck.blp"][next(4)]!;
    const file = name.replaceAll("\\", "/").replace(/\.mdl$/i, ".mdx");
    const map = new Map<string, string>(), stock = new Map<string, string>();
    if (next(2) === 0) map.set(file, `map ${sample}`);
    if (next(2) === 0) stock.set(file, `stock ${sample}`);
    const reads: string[] = [];
    const result = await Effect.runPromise(resolveRenderAsset({
      map: async (at) => (reads.push(`map ${at}`), map.has(at) ? encoded(map.get(at)!) : undefined),
      stock: async (at, layer) => (reads.push(`stock ${layer}/${at}`), stock.has(at) ? encoded(stock.get(at)!) : undefined),
    }, name));

    const sources = file.toLowerCase().startsWith("war3mapimported/") ? ["map" as const] : ["map" as const, "stock" as const];
    const order = sources.map((source) => ({ source, layer: "base" as const, path: file }));
    const content = ({ source, path: at }: (typeof order)[number]) => (source === "map" ? map.get(at) : stock.get(at));
    const found = order.findIndex((location) => content(location) !== undefined);
    const evidence = `sample ${sample}: ${name} map [${[...map.keys()]}] stock [${[...stock.keys()]}]`;

    expect(result.attempts, evidence).toEqual(found < 0 ? order : order.slice(0, found + 1));
    expect(reads, evidence).toEqual(result.attempts.map(({ source, layer, path: at }) => (source === "map" ? `map ${at}` : `stock ${layer}/${at}`)));
    expect(result.selected, evidence).toEqual(found < 0 ? undefined : order[found]);
    expect(result.bytes === undefined ? undefined : new TextDecoder().decode(result.bytes), evidence).toBe(found < 0 ? undefined : content(order[found]!));
    expect({ requested: result.requested, graphics: result.graphics }).toEqual({ requested: name, graphics: "classic" });
  }
  for (const path of ["../Unit.mdx", "Units/../../Unit.mdx", "/Unit.mdx", "\\Unit.mdx", "C:\\Unit.mdx"]) {
    const exit = await Effect.runPromiseExit(resolveRenderAsset({ map: async () => encoded("x"), stock: async () => encoded("x") }, path));
    expect(Exit.isFailure(exit) && String(exit.cause).includes("invalid map asset path"), path).toBe(true);
  }
});
