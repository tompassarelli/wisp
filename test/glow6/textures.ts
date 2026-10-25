import { TEXTURE_SIZE } from "./layout";

export interface Rgba { readonly width: number; readonly height: number; readonly data: Uint8Array }

const level = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));

/** Our own radial art for the twin quad: grey falls off linearly to the rim, alpha as a smoothstep, so colour alone and colour times alpha give different profiles. */
export function twinTexture(size = TEXTURE_SIZE): Rgba {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.min(1, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2));
    const grey = 0.8 * (1 - r), t = 1 - r, alpha = 0.8 * t * t * (3 - 2 * t), o = (y * size + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = level(grey);
    data[o + 3] = level(alpha);
  }
  return { width: size, height: size, data };
}

export function blackTexture(size = 8): Rgba {
  const data = new Uint8Array(size * size * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: size, height: size, data };
}

function halve(image: Rgba): Rgba {
  const width = Math.max(1, image.width >> 1), height = Math.max(1, image.height >> 1), data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let k = 0; k < 4; k++) {
    let sum = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) sum += image.data[((Math.min(image.height - 1, y * 2 + dy)) * image.width + Math.min(image.width - 1, x * 2 + dx)) * 4 + k] ?? 0;
    data[(y * width + x) * 4 + k] = Math.round(sum / 4);
  }
  return { width, height, data };
}

/**
 * A BLP1 file with a 256-grey palette, 8-bit alpha and a full mip chain. Only grey texels are stored exactly; the palette
 * index is the red channel.
 */
export function encodeGreyBlp(image: Rgba): Uint8Array {
  const levels: Rgba[] = [image];
  while ((levels.at(-1)?.width ?? 1) > 1 || (levels.at(-1)?.height ?? 1) > 1) levels.push(halve(levels.at(-1) ?? image));
  const header = 28 + 16 * 4 * 2, palette = 256 * 4;
  const sizes = levels.map(({ width, height }) => width * height * 2);
  const out = new Uint8Array(header + palette + sizes.reduce((a, b) => a + b, 0));
  const view = new DataView(out.buffer);
  out.set([66, 76, 80, 49]);
  [1, 8, image.width, image.height, 4, 1].forEach((value, i) => view.setUint32(4 + i * 4, value, true));
  let offset = header + palette;
  levels.forEach((_, i) => {
    view.setUint32(28 + i * 4, offset, true);
    view.setUint32(28 + 64 + i * 4, sizes[i] ?? 0, true);
    offset += sizes[i] ?? 0;
  });
  for (let i = 0; i < 256; i++) out.set([i, i, i, 0], header + i * 4);
  offset = header + palette;
  for (const { width, height, data } of levels) {
    const count = width * height;
    for (let p = 0; p < count; p++) {
      out[offset + p] = data[p * 4] ?? 0;
      out[offset + count + p] = data[p * 4 + 3] ?? 0;
    }
    offset += count * 2;
  }
  return out;
}
