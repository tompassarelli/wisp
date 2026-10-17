import { luma, mean } from "./image";
import { colourMetric, type Metric } from "./metric";
export const cinematicFilter: readonly Metric[] = [colourMetric, { name: "luma", bound: 5, distance: (a,b,r) => Math.abs(luma(mean(a,r))-luma(mean(b,r))) }];
