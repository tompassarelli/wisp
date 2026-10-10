import { expect, test } from "bun:test";
import { decodePreviewTexture, decodeMinimapMarkers, drawStartMarkers, selectMapPreview } from "../scripts/wisp/mapPreview";

test("[native] #85 parchment and custom-lineup archive choices match two captured maps in Classic and Definitive", () => {

  for (const reference of [
    { map: "smashcraft-0911b5da", flags: 40016, shown: "war3mapMap.blp" },
    { map: "custom-minimap-d8fe5996", flags: 40016, shown: "war3mapMap.blp" },
  ]) {
    const selected = selectMapPreview({ flags: reference.flags }, new Set(["war3mapmap.blp", "war3mappreview.tga"]));
    expect(selected.entry, reference.map).toBe(reference.shown);
    expect(selected.hideMinimap, reference.map).toBe(false);
    expect(selected.customPreviewPresent, reference.map).toBe(true);
  }
});

test("[native] #85 captured Smashcraft start marker keeps position and red player color", () => {
  const words = [0, 1, 2, 41, 202, 0xffff0303];
  const bytes = new Uint8Array(words.length * 4), view = new DataView(bytes.buffer);
  words.forEach((word, i) => view.setUint32(i * 4, word, true));
  const markers = decodeMinimapMarkers(bytes);
  expect(markers).toEqual([{ type: 2, x: 41, y: 202, color: 0xffff0303 }]);

  const image = drawStartMarkers({ width: 256, height: 256, rgb: new Uint8Array(256 * 256 * 3) }, markers,
    { width: 2, height: 2, rgba: new Uint8Array(16).fill(255) });
  expect(Array.from(image.rgb.slice((201 * 256 + 40) * 3, (201 * 256 + 40) * 3 + 3))).toEqual([255, 3, 3]);
  expect(Array.from(image.rgb.slice((200 * 256 + 40) * 3, (200 * 256 + 40) * 3 + 3))).toEqual([0, 0, 0]);
});

test("[invariant] #85 preview refuses uncalibrated hidden-minimap behavior instead of guessing an image", () => {
  expect(() => selectMapPreview({ flags: 1 }, new Set(["war3mapmap.blp"]))).toThrow("reference capture");
});

test("[reference] authored TGA pixels keep RGB and top-left orientation for raw and RLE previews", () => {

  for (const type of [2, 10]) {
    const header = new Uint8Array(18);
    header[2] = type; header[12] = 2; header[14] = 1; header[16] = 24; header[17] = 16;
    const bytes = Uint8Array.from([...header, ...(type === 10 ? [1] : []), 255, 0, 0, 0, 0, 255]);
    const image = decodePreviewTexture(bytes);
    expect([image.width, image.height, ...image.rgb]).toEqual([2, 1, 255, 0, 0, 0, 0, 255]);
  }
});
