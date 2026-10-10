import { lab } from "./colour";
import { mean } from "./image";
import { type Metric } from "./metric";
export const shading: readonly Metric[] = [{ name: "L-star", bound: 3, distance: (a,b,r) => Math.abs(lab(mean(a,r))[0]-lab(mean(b,r))[0]) }];
