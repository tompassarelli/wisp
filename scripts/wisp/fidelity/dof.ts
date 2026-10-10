import { luma, pixel, type Image, type Region } from "./image";
import { relative, type Metric } from "./metric";
function sharpness(image: Image, r: Region): number {
  let sum = 0, n = 0;
  for (let y = r.y; y < r.y+r.height; y++) for (let x = r.x; x < r.x+r.width; x++) {
    if (x+1 < r.x+r.width) { sum += Math.abs(luma(pixel(image,x+1,y))-luma(pixel(image,x,y))); n++; }
    if (y+1 < r.y+r.height) { sum += Math.abs(luma(pixel(image,x,y+1))-luma(pixel(image,x,y))); n++; }
  }
  return n === 0 ? 0 : sum/n;
}
export const dof: readonly Metric[] = [{ name: "depth-band-sharpness", bound: 0.15, distance: (a,b,r) => relative(sharpness(a,r),sharpness(b,r)) }];
