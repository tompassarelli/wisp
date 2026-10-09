import { decodeDds, parseHeaders } from "dds-parser";

export function ddsTexture(bytes: ArrayBuffer) {
  const info = parseHeaders(bytes), image = info.images[0];
  if (image === undefined) throw new Error("DDS texture has no image");
  return { width: image.shape.width, height: image.shape.height,
    data: decodeDds(new Uint8Array(bytes, image.offset, image.length), info.format, image.shape.width, image.shape.height) };
}
