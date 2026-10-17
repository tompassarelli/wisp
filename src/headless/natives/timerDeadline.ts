import { addFloat32TowardZero } from "../../sim/binary32";

// Warcraft timer deadlines add toward zero; sub-resolution repeats advance one resolution to avoid stalling.

export const after = (at: number, length: number): number => {
  const due = addFloat32TowardZero(at, length);
  return due > at ? due : addFloat32TowardZero(at, at * 1.1920928955078125e-7);
};
