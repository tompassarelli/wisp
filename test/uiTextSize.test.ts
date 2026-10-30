import { expect, test } from "bun:test";
import { uiTextSize } from "../host/render/screen";

const scaled = (wanted: number) => ({ font: { height: wanted }, scale: wanted / 0.0085, plain: true });

test("uiTextSize_sizes_a_scaled_plain_frame_by_its_scale_alone", () => {
  for (const [height, sizes] of [[1080, [135, 168.75]], [1920, [240, 300]]] as const) {
    expect(uiTextSize(scaled(0.075), height, 0)).toBeCloseTo(sizes[0], 3);
    expect(uiTextSize(scaled(0.09375), height, 0)).toBeCloseTo(sizes[1], 3);
  }
});

test("uiTextSize_multiplies_a_templated_frames_font_by_its_scale", () => {
  expect(uiTextSize({ font: { height: 0.036 }, scale: 0.6, plain: false }, 1080, 0)).toBeCloseTo(0.036 * 0.6 * 1800, 3);
  expect(uiTextSize({ font: { height: 0.036 }, scale: 0.6, plain: false }, 1920, 0)).toBeCloseTo(0.036 * 0.6 * 3200, 3);
});

test("uiTextSize_keeps_an_unscaled_plain_frames_font_height", () => {
  expect(uiTextSize({ font: { height: 0.019 }, scale: 1, plain: true }, 1080, 0)).toBeCloseTo(34.2, 3);
  expect(uiTextSize({ font: { height: 0.019 }, scale: 1, plain: true }, 1920, 0)).toBeCloseTo(60.8, 3);
});
