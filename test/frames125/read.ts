import { decodePng } from "../animation58/read";
import { PLACEMENTS } from "./layout";

interface Image { readonly width: number; readonly height: number; readonly rgb: Uint8Array }

export interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly pixels: number }

function decodePpm(bytes: Uint8Array): Image {
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 64)).match(/^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  if (header === null) throw new Error("unsupported PPM: expected binary P6 with 8-bit samples");
  const width = Number(header[1]), height = Number(header[2]);
  return { width, height, rgb: bytes.subarray(header[0].length, header[0].length + width * height * 3) };
}

export const decodeImage = (bytes: Uint8Array): Image => bytes[0] === 0x50 ? decodePpm(bytes) : decodePng(bytes);

export function largestBox(image: Image, rgb: readonly [number, number, number], tolerance = 40): Box | undefined {
  const { width, height } = image;
  const hit = (index: number) => [0, 1, 2].every(channel => Math.abs((image.rgb[index * 3 + channel] ?? 0) - (rgb[channel] ?? 0)) <= tolerance);
  const seen = new Uint8Array(width * height);
  let best: Box | undefined;
  for (let start = 0; start < width * height; start++) {
    if (seen[start] === 1 || !hit(start)) continue;
    let x0 = width, y0 = height, x1 = -1, y1 = -1, pixels = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      const x = index % width, y = Math.floor(index / width);
      pixels++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (seen[next] === 1 || !hit(next)) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    if (best === undefined || pixels > best.pixels) best = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, pixels };
  }
  return best;
}

export function readFrames(image: Image): string[] {
  const { width: W, height: H } = image;
  const ui = (x: number, y: number) => `${(0.4 + (x - W / 2) * 0.6 / H).toFixed(4)},${(0.6 - y * 0.6 / H).toFixed(4)}`;
  return [`size=${W}x${H}`, ...PLACEMENTS.map(({ name, rgb }) => {
    const box = largestBox(image, rgb);
    if (box === undefined || box.pixels < 16) return `${name}=gone`;
    return `${name}=${box.x},${box.y},${box.width},${box.height} ui-topleft=${ui(box.x, box.y)} ui-size=${(box.width * 0.6 / H).toFixed(4)},${(box.height * 0.6 / H).toFixed(4)} fill=${box.pixels}/${box.width * box.height}`;
  })];
}

if (import.meta.main) {
  const file = process.argv[2];
  if (file === undefined) throw new Error("usage: bun test/frames125/read.ts CAPTURE.png|.ppm");
  for (const row of readFrames(decodeImage(new Uint8Array(await Bun.file(file).arrayBuffer())))) console.log(row);
}
