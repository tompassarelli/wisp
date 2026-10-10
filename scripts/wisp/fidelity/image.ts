import { inflateSync } from "node:zlib";

export interface Image { readonly width: number; readonly height: number; readonly rgb: Uint8Array }
export interface Region { readonly id: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly critical: boolean }
export type RGB = readonly [number, number, number];
export function pixel(image: Image, x: number, y: number): RGB {
  const i = (y * image.width + x) * 3;
  return [image.rgb[i] ?? 0, image.rgb[i + 1] ?? 0, image.rgb[i + 2] ?? 0];
}
export const luma = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export function mean(image: Image, region: Region): RGB {
  const sums = [0, 0, 0];
  for (let y = region.y; y < region.y + region.height; y++) for (let x = region.x; x < region.x + region.width; x++) {
    const rgb = pixel(image, x, y);
    for (let c = 0; c < 3; c++) sums[c] = (sums[c] ?? 0) + (rgb[c] ?? 0);
  }
  const n = region.width * region.height;
  return [(sums[0] ?? 0) / n, (sums[1] ?? 0) / n, (sums[2] ?? 0) / n];
}
export function decodePng(bytes: Uint8Array): Image {
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) throw new Error("not a PNG image");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, channels = 0;
  const chunks: Uint8Array[] = [];
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at);
    if (at + 12 + length > bytes.length) throw new Error("truncated PNG chunk");
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "IHDR") {
      width = view.getUint32(at + 8); height = view.getUint32(at + 12);
      channels = bytes[at + 17] === 2 ? 3 : bytes[at + 17] === 6 ? 4 : 0;
      if (length !== 13 || bytes[at + 16] !== 8 || channels === 0 || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || bytes[at + 20] !== 0) throw new Error("PNG must be non-interlaced 8-bit RGB or RGBA");
    } else if (type === "IDAT") chunks.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  if (width < 1 || height < 1 || width * height > 16_777_216) throw new Error("PNG dimensions exceed capture limit");
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error("invalid PNG scanline length");
  const decoded = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    if (filter > 4) throw new Error("invalid PNG filter");
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[y * stride + x - channels] ?? 0 : 0;
      const up = y > 0 ? decoded[(y - 1) * stride + x] ?? 0 : 0;
      const corner = y > 0 && x >= channels ? decoded[(y - 1) * stride + x - channels] ?? 0 : 0;
      const prediction = left + up - corner;
      const a = Math.abs(prediction-left), b = Math.abs(prediction-up), c = Math.abs(prediction-corner);
      const paeth = a <= b && a <= c ? left : b <= c ? up : corner;
      const predictors = [0,left,up,Math.floor((left+up)/2),paeth];
      decoded[y * stride + x] = ((raw[y * (stride + 1) + x + 1] ?? 0) + (predictors[filter] ?? 0)) & 255;
    }
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) rgb.set(decoded.subarray(i * channels, i * channels + 3), i * 3);
  return { width, height, rgb };
}
