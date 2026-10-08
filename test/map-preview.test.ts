import { expect, test } from "bun:test";
import { decodePreviewTexture, selectMapPreview } from "../scripts/wisp/mapPreview";

test("[native] #85 Smashcraft d8fe5996 lobby selects parchment minimap despite the custom preview", () => {
  // Warcraft 3.0.1 capture: smashcraft#317 comment 6064778830; private archive flags 40016.
  const selected = selectMapPreview({ flags: 40016 }, new Set(["war3mapmap.blp", "war3mappreview.tga"]));
  expect(selected.entry).toBe("war3mapMap.blp");
  expect(selected.hideMinimap).toBe(false);
  expect(selected.customPreviewPresent).toBe(true);
});

test("[invariant] #85 preview refuses uncalibrated hidden-minimap behavior instead of guessing an image", () => {
  expect(() => selectMapPreview({ flags: 1 }, new Set(["war3mapmap.blp"]))).toThrow("reference capture");
});

test("[reference] authored TGA pixels keep RGB and top-left orientation for raw and RLE previews", () => {
  // Authored two-pixel image: red at the left, blue at the right, bottom/right-origin header.
  for (const type of [2, 10]) {
    const header = new Uint8Array(18);
    header[2] = type; header[12] = 2; header[14] = 1; header[16] = 24; header[17] = 16;
    const bytes = Uint8Array.from([...header, ...(type === 10 ? [1] : []), 255, 0, 0, 0, 0, 255]);
    const image = decodePreviewTexture(bytes);
    expect([image.width, image.height, ...image.rgb]).toEqual([2, 1, 255, 0, 0, 0, 0, 255]);
  }
});
