export type Matrix = Float32Array;

export function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) out[column * 4 + row] = (out[column * 4 + row] ?? 0) + (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
  }
  return out;
}
export function normalize(v: readonly number[]): number[] {
  const length = Math.hypot(...v) || 1;
  return v.map((value) => value / length);
}
export function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [(a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0), (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0), (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0)];
}
export function dot(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);
}
export function perspective(tangent: number, near: number, far: number, aspect = 1): Matrix {
  const out = new Float32Array(16);
  out[0] = 1 / tangent; out[5] = aspect / tangent; out[10] = (far + near) / (near - far); out[11] = -1; out[14] = 2 * far * near / (near - far);
  return out;
}
