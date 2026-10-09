import { expect, test } from "bun:test";
import { ddsTexture } from "../scripts/wisp/browser/ddsTexture";

test("[reference DDS DXT1 layout] a DDS returned for a stage's TIF texture decodes its top image", () => {
  const bytes = new ArrayBuffer(136), header = new DataView(bytes);
  header.setUint32(0, 0x20534444, true);
  header.setUint32(4, 124, true);
  header.setUint32(8, 0x1007, true);
  header.setUint32(12, 4, true);
  header.setUint32(16, 4, true);
  header.setUint32(76, 32, true);
  header.setUint32(80, 4, true);
  header.setUint32(84, 0x31545844, true);
  header.setUint16(128, 0xf800, true);
  header.setUint16(130, 0x07e0, true);
  const image = ddsTexture(bytes);
  expect([image.width, image.height]).toEqual([4, 4]);
  for (let pixel = 0; pixel < 16; pixel++) expect(Array.from(image.data.slice(pixel * 4, pixel * 4 + 4))).toEqual([255, 0, 0, 255]);
});
