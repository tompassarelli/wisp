import { colourMetric, type Metric } from "./metric";
import { luma, pixel, type Image, type Region } from "./image";
function horizon(image: Image, r: Region): number {
  let best = -1, row = r.y;
  for (let y = r.y + 1; y < r.y + r.height; y++) {
    let gradient = 0;
    for (let x = r.x; x < r.x + r.width; x++) gradient += Math.abs(luma(pixel(image,x,y))-luma(pixel(image,x,y-1)));
    if (gradient > best) { best = gradient; row = y; }
  }
  return row;
}
export const sky: readonly Metric[] = [{ ...colourMetric, name: "top-band-deltaE00", distance: (a,b,r) => colourMetric.distance(a,b,{...r,height:Math.max(1,Math.floor(r.height/10))}) }, { name: "horizon-rows", bound: 4, distance: (a,b,r) => Math.abs(horizon(a,r)-horizon(b,r)) }];
