import { EDGE_TOLERANCE, compareEdges, silhouetteBounds, type PixelBox } from "../screenBounds";
import type { Image, Region } from "./image";
import type { Metric } from "./metric";

/** A `visibility: shown` capture with the same run's `visibility: hidden` capture of its frame. */
interface ShownImage extends Image { readonly hidden: Image }

function crop(image: Image, r: Region): Image {
  const rgb = new Uint8Array(r.width * r.height * 3);
  for (let y = 0; y < r.height; y++) rgb.set(image.rgb.subarray(((r.y + y) * image.width + r.x) * 3, ((r.y + y) * image.width + r.x + r.width) * 3), y * r.width * 3);
  return { width: r.width, height: r.height, rgb };
}

/** The pixel box, in region coordinates, of the region's pixels whose largest channel |shown − hidden| exceeds silhouetteBounds' SILHOUETTE_DELTA. */
function regionSilhouette(image: Image, r: Region): PixelBox | undefined {
  const hidden = (image as Partial<ShownImage>).hidden;
  if (hidden === undefined) throw new Error("draw-extent needs each shown capture paired with its run's hidden capture");
  if (hidden.width !== image.width || hidden.height !== image.height) throw new Error("shown and hidden captures differ in size");
  return silhouetteBounds(crop(image, r), crop(hidden, r), { left: 0, top: 0, right: r.width, bottom: r.height });
}

/** Largest of the four silhouette box edge differences, in px; an empty silhouette on either side is an infinite distance. */
export const drawExtent: readonly Metric[] = [{ name: "draw-extent", bound: EDGE_TOLERANCE, distance: (a, b, r) => {
  const reference = regionSilhouette(a, r), candidate = regionSilhouette(b, r);
  if (reference === undefined || candidate === undefined) return Infinity;
  const edges = compareEdges(reference, candidate);
  return Math.max(Math.abs(edges.left), Math.abs(edges.top), Math.abs(edges.right), Math.abs(edges.bottom));
} }];
