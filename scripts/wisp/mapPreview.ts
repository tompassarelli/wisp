import { decodeBLP, getBLPImageData } from "../../vendor/war3-model.mjs";
import type { MapInfo } from "../mapInfo";
import type { Frame } from "./frameProbe";

export const MINIMAP_ENTRIES = ["war3mapMap.blp", "war3mapMap.tga"] as const;

/** Warcraft 3.0.1 lobby capture on Smashcraft d8fe5996: Preview.tga is ignored. */
export function selectMapPreview(info: Pick<MapInfo, "flags">, entries: ReadonlySet<string>) {
  if ((info.flags & 1) !== 0) throw new Error("hide-minimap preview flag needs a Warcraft 3.0.1 reference capture");
  if (MINIMAP_ENTRIES.every((name) => entries.has(name.toLowerCase()))) throw new Error("map has both minimap encodings; texture precedence needs a Warcraft 3.0.1 reference capture");
  const entry = MINIMAP_ENTRIES.find((name) => entries.has(name.toLowerCase()));
  if (entry === undefined) throw new Error("map has no supported war3mapMap.blp or war3mapMap.tga; a native reference is needed for the fallback");
  return { entry, flags: info.flags, hideMinimap: (info.flags & 1) !== 0,
    rule: "3.0.1 lobby reference uses war3mapMap with hide-minimap unset, ignoring war3mapPreview",
    customPreviewPresent: ["war3mapPreview.tga", "war3mapPreview.blp", "war3mapPreview.dds"].some((name) => entries.has(name.toLowerCase())) };
}

export function decodePreviewTexture(bytes: Uint8Array): Frame {
  let width: number, height: number, rgba: Uint8Array | Uint8ClampedArray;
  if (bytes[0] === 66 && bytes[1] === 76) {
    const image = getBLPImageData(decodeBLP(bytes.slice().buffer), 0);
    ({ width, height } = image); rgba = image.data;
  } else {
    const image = decodeTga(bytes);
    ({ width, height } = image); rgba = image.rgba;
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++) {
    for (let channel = 0; channel < 3; channel++) rgb[pixel * 3 + channel] = rgba[pixel * 4 + channel] ?? 0;
  }
  return { width, height, rgb };
}

function decodeTga(bytes: Uint8Array) {
  if (bytes.length < 18) throw new Error("truncated TGA header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = bytes[2] ?? 0, stride = (bytes[16] ?? 0) / 8;
  if (bytes[1] !== 0 || ![2, 3, 10, 11].includes(type) || ![1, 3, 4].includes(stride)) throw new Error("unsupported TGA preview encoding");
  const width = view.getUint16(12, true), height = view.getUint16(14, true), descriptor = bytes[17] ?? 0;
  if (width === 0 || height === 0 || width * height > 4096 * 4096) throw new Error("unsupported TGA preview dimensions");
  const rgba = new Uint8Array(width * height * 4);
  let offset = 18 + (bytes[0] ?? 0), pixel = 0;
  while (pixel < width * height) {
    if (offset >= bytes.length) throw new Error("truncated TGA pixels");
    const packet = type >= 10 ? bytes[offset++] ?? 0 : 0;
    const count = type >= 10 ? (packet & 127) + 1 : 1, repeat = (packet & 128) !== 0;
    if (pixel + count > width * height) throw new Error("TGA packet exceeds preview dimensions");
    for (let i = 0; i < count; i++) {
      if (offset + stride > bytes.length) throw new Error("truncated TGA pixel");
      const row = Math.floor(pixel / width), column = pixel % width;
      const x = (descriptor & 16) === 0 ? column : width - 1 - column;
      const y = (descriptor & 32) !== 0 ? row : height - 1 - row;
      const at = (y * width + x) * 4;
      rgba[at] = bytes[offset + (stride === 1 ? 0 : 2)] ?? 0;
      rgba[at + 1] = bytes[offset + (stride === 1 ? 0 : 1)] ?? 0;
      rgba[at + 2] = bytes[offset] ?? 0;
      rgba[at + 3] = stride === 4 ? bytes[offset + 3] ?? 255 : 255;
      pixel++;
      if (!repeat || i === count - 1) offset += stride;
    }
  }
  return { width, height, rgba };
}
