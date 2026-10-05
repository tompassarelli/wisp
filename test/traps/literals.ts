// Decimal literals must be binary32 values, or say which one they mean with f32().
import { f32 } from "../../src/sim/f32";

export const tenth = 0.1; // rejected
export const negative = -0.3; // rejected
export const tiny = 1e-7; // rejected
export const exact = 0.10000000149011612;
export const half = 0.5;
export const whole = 2.0;
export const named = f32(0.1);
export const namedNegative = f32(-(0.3));
