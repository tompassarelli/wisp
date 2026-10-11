export interface MeasuredBox { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

// Offline pool lan0a, 3.0.0.24268, checks profile (800x600 client area), 11 October 2026; read.ts boxes minus the window's 2 px border.
export const MEASURED_800X600: Readonly<Record<string, MeasuredBox | "gone">> = {
  "abs-scaled": { x: 100, y: 350, width: 80, height: 80 },
  "center-scaled": { x: 210, y: 360, width: 80, height: 80 },
  anchor: { x: 400, y: 100, width: 40, height: 40 },
  "rel-scaled": { x: 480, y: 160, width: 80, height: 80 },
  "child-of-scaled": { x: 200, y: 350, width: 40, height: 40 },
  "left-of-43": "gone",
  "right-of-43": "gone",
  "console-child": { x: 600, y: 300, width: 40, height: 40 },
};
