import { decodeBLP, getBLPImageData } from "../../vendor/war3-model.mjs";
import type { MapInfo } from "../mapInfo";
import type { Frame } from "./frameProbe";

export const MINIMAP_ENTRIES = ["war3mapMap.blp", "war3mapMap.tga"] as const;


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
  const { width, height, rgba } = decodePreviewRgba(bytes);
  const rgb = new Uint8Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel++) {
    for (let channel = 0; channel < 3; channel++) rgb[pixel * 3 + channel] = rgba[pixel * 4 + channel] ?? 0;
  }
  return { width, height, rgb };
}

export function decodePreviewRgba(bytes: Uint8Array) {
  let width: number, height: number, rgba: Uint8Array | Uint8ClampedArray;
  if (bytes[0] === 66 && bytes[1] === 76) {
    const image = getBLPImageData(decodeBLP(bytes.slice().buffer), 0);
    ({ width, height } = image); rgba = image.data;
  } else {
    const image = decodeTga(bytes);
    ({ width, height } = image); rgba = image.rgba;
  }
  return { width, height, rgba };
}

export interface MinimapMarker { readonly type: number; readonly x: number; readonly y: number; readonly color: number }

export function decodeMinimapMarkers(bytes: Uint8Array): readonly MinimapMarker[] {
  if (bytes.length < 8) throw new Error("truncated war3map.mmp");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0) throw new Error("unsupported war3map.mmp version");
  const count = view.getUint32(4, true);
  if (8 + count * 16 !== bytes.length) throw new Error("truncated war3map.mmp marker table");
  return Array.from({ length: count }, (_, i) => ({ type: view.getUint32(8 + i * 16, true), x: view.getUint32(12 + i * 16, true), y: view.getUint32(16 + i * 16, true), color: view.getUint32(20 + i * 16, true) }));
}

export function drawStartMarkers(frame: Frame, markers: readonly MinimapMarker[], icon: ReturnType<typeof decodePreviewRgba>): Frame {
  const rgb = frame.rgb.slice();
  for (const marker of markers) {
    if (marker.type !== 2) throw new Error(`minimap marker type ${marker.type} needs its native icon and reference`);
    const left = Math.round(marker.x * frame.width / 256 - icon.width / 2), top = Math.round(marker.y * frame.height / 256 - icon.height / 2);
    for (let y = 0; y < icon.height; y++) for (let x = 0; x < icon.width; x++) {
      const targetX = left + x, targetY = top + y;
      if (targetX < 0 || targetY < 0 || targetX >= frame.width || targetY >= frame.height) continue;
      const source = (y * icon.width + x) * 4, target = (targetY * frame.width + targetX) * 3;
      const alpha = ((icon.rgba[source + 3] ?? 0) / 255) * ((marker.color >>> 24) / 255);
      for (let channel = 0; channel < 3; channel++) {
        const tint = (marker.color >>> ((2 - channel) * 8)) & 255;
        const foreground = (icon.rgba[source + channel] ?? 0) * tint / 255;
        rgb[target + channel] = Math.round(foreground * alpha + (rgb[target + channel] ?? 0) * (1 - alpha));
      }
    }
  }
  return { ...frame, rgb };
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
