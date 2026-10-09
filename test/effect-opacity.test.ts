import { expect, test } from "bun:test";
import { layerBlendFactors, layerOpacity, model } from "../vendor/war3-model.mjs";


const SRC_COLOR = 0x0300, SRC_ALPHA = 0x0302, ONE_MINUS_SRC_ALPHA = 0x0303;
function blended(filterMode: model.FilterMode, color: number, alpha: number, backdrop: number): number {
  const factors = layerBlendFactors(filterMode);
  if (factors === null) return color;
  const factor = (name: number) => (name === 0 ? 0 : name === 1 ? 1 : name === SRC_ALPHA ? alpha : name === ONE_MINUS_SRC_ALPHA ? 1 - alpha : name === SRC_COLOR ? color : Number.NaN);
  return color * factor(factors[0]) + backdrop * factor(factors[1]);
}

test("[native #72] an additive layer adds its colour times its alpha, so a faded additive cue adds nothing", () => {

  expect(blended(model.FilterMode.Additive, 0.8, 0, 0.3)).toBe(0.3);
  expect(blended(model.FilterMode.Additive, 0.8, 0.5, 0.3)).toBeCloseTo(0.7);
  expect(blended(model.FilterMode.AddAlpha, 0.8, 0.5, 0.3)).toBeCloseTo(0.7);
});

test("[native #72] a layer's alpha is its geoset's animated alpha times its own", () => {

  expect(layerOpacity(0.5, 0.4, 1)).toBeCloseTo(0.2);
  expect(layerOpacity(0, 1, 1)).toBe(0);
});

test("[native #72] an effect's alpha fades an additive layer once, not squared", () => {


  const alpha = layerOpacity(1, 1, 40 / 255);
  expect(alpha).toBeCloseTo(40 / 255);
  expect(blended(model.FilterMode.Additive, 1, alpha, 0)).toBeCloseTo(40 / 255);
});
