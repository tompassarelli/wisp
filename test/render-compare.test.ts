import { expect, test } from "bun:test";
import { checkerPng } from "../host/render/compareScenes";
import { boundOf, compareScene, HEADROOM, measure } from "../host/render/renderCompare";

test("[spec #121] a region's measures are its largest, 99th-percentile and mean channel delta and the fraction of pixels past two levels, and its bound is the measure times the headroom, rounded up and capped at the scale", () => {
  const deltas = [...Array.from({ length: 98 }, () => 0), 2, 40];
  const measured = measure(deltas);
  expect(measured).toEqual({ maxDelta: 40, p99Delta: 40, meanDelta: 0.42, differingFraction: 0.01 });
  expect(boundOf(measured)).toEqual({ maxDelta: 60, p99Delta: 60, meanDelta: 0.63, differingFraction: 0.015 });
  expect(boundOf({ maxDelta: 250, p99Delta: 250, meanDelta: 250, differingFraction: 0.9 })).toEqual({ maxDelta: 255, p99Delta: 255, meanDelta: 255, differingFraction: 1 });
  expect(boundOf(measure([]))).toEqual({ maxDelta: 0, p99Delta: 0, meanDelta: 0, differingFraction: 0 });
  expect(HEADROOM).toBe(1.5);
});

test("[spec #121] identical renders measure zero in every region, a different render measures its edges apart from its flat areas, and a size mismatch is refused", () => {
  const same = compareScene("checker", checkerPng(64, 8), checkerPng(64, 8));
  expect(same.map((region) => region.name)).toEqual(["checker/flat", "checker/edge"]);
  expect(same.every((region) => region.measured.maxDelta === 0 && region.bound.differingFraction === 0)).toBe(true);
  expect(same.reduce((sum, region) => sum + region.pixels, 0)).toBe(64 * 64);
  const shifted = compareScene("checker", checkerPng(64, 8), checkerPng(64, 4));
  expect(shifted.find((region) => region.area === "edge")?.measured.maxDelta).toBeGreaterThan(100);
  expect(() => compareScene("checker", checkerPng(64, 8), checkerPng(32, 8))).toThrow("64x64");
});
