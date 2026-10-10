import { luma, pixel, type Image, type Region } from "./image";
import { relative, type Metric } from "./metric";
function above(image: Image, r: Region, threshold: number): number {
  let count = 0;
  for (let y=r.y;y<r.y+r.height;y++) for (let x=r.x;x<r.x+r.width;x++) if (luma(pixel(image,x,y)) > threshold) count++;
  return count;
}
export function bloom(threshold: number): readonly Metric[] {
  return [{ name: "halo-profile-9", bound: 0.10, distance: (a,b,r) => {
    let error = 0;
    const y = r.y+Math.floor((r.height-1)/2);
    for (let i=0;i<9;i++) { const x=r.x+Math.round(i*(r.width-1)/8); error=Math.max(error,relative(luma(pixel(a,x,y)),luma(pixel(b,x,y)))); }
    return error;
  } }, { name: "pixels-over-threshold", bound: 0.20, distance: (a,b,r) => relative(above(a,r,threshold),above(b,r,threshold)) }];
}
