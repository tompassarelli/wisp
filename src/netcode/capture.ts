export const Capture = {
  captured: 0,
  alreadyCaptured: 1,
  wrongEpoch: 2,
  frameExhausted: 3,
  pendingFull: 4,
  conflict: 6,
  outOfHistory: 7,
  tooFarAhead: 8,
} as const;

export type Capture = (typeof Capture)[keyof typeof Capture];
