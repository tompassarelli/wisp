import { deltaE00, lab } from "./colour";
import { mean, type Image, type Region } from "./image";
export interface Metric { readonly name: string; readonly bound: number; readonly distance: (reference: Image, candidate: Image, region: Region) => number }
export const colourMetric: Metric = { name: "deltaE00", bound: 5, distance: (a,b,r) => deltaE00(lab(mean(a,r)),lab(mean(b,r))) };
export const relative = (a: number,b: number) => a === 0 ? b === 0 ? 0 : Infinity : Math.abs(a-b)/Math.abs(a);
