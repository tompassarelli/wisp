import { f32 } from "../../src/sim/f32";

export type Parent = "game-ui" | "console" | "red";
export type Point = "topleft" | "center";

export interface Placement {
  readonly name: string;
  readonly texture: string;
  readonly rgb: readonly [number, number, number];
  readonly parent: Parent;
  readonly scale: number;
  readonly size: number;
  readonly point: Point;
  readonly abs?: readonly [number, number];
  readonly relative?: { readonly to: string; readonly x: number; readonly y: number };
}

const team = (index: number) => `ReplaceableTextures\\TeamColor\\TeamColor0${index}.blp`;

export const PLACEMENTS: readonly Placement[] = [
  { name: "abs-scaled", texture: team(0), rgb: [255, 3, 3], parent: "game-ui", scale: 2, size: f32(0.04), point: "topleft", abs: [f32(0.1), f32(0.25)] },
  { name: "center-scaled", texture: team(3), rgb: [84, 0, 129], parent: "game-ui", scale: 2, size: f32(0.04), point: "center", abs: [f32(0.25), f32(0.2)] },
  { name: "anchor", texture: team(2), rgb: [28, 230, 185], parent: "game-ui", scale: 1, size: f32(0.04), point: "topleft", abs: [f32(0.4), f32(0.5)] },
  { name: "rel-scaled", texture: team(1), rgb: [0, 66, 255], parent: "game-ui", scale: 2, size: f32(0.04), point: "topleft", relative: { to: "anchor", x: f32(0.02), y: f32(-0.01) } },
  { name: "child-of-scaled", texture: team(7), rgb: [229, 91, 176], parent: "red", scale: 1, size: f32(0.02), point: "topleft", relative: { to: "abs-scaled", x: f32(0.01), y: 0 } },
  { name: "left-of-43", texture: team(4), rgb: [255, 252, 1], parent: "game-ui", scale: 1, size: f32(0.04), point: "topleft", abs: [f32(-0.05), f32(0.45)] },
  { name: "right-of-43", texture: team(5), rgb: [254, 138, 14], parent: "game-ui", scale: 1, size: f32(0.04), point: "topleft", abs: [f32(0.82), f32(0.45)] },
  { name: "console-child", texture: team(6), rgb: [32, 192, 0], parent: "console", scale: 1, size: f32(0.04), point: "topleft", abs: [f32(0.6), f32(0.3)] },
];

export const READY_FILE = "frames125-p0.txt";
