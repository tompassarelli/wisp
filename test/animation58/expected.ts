/**
 * Each ruler's row, `needle X,needle Y,global marker X` in world units from
 * its origin, or `gone`, as wisp:docs/warsmash-notes.md's "Animation
 * playback" and "Effects: attachment, scale and lifetime" rules draw it
 * headlessly. The 3.0.1 capture read by read.ts confirms or replaces each,
 * within the ruler's timing allowance (layout.ts).
 */
export const EXPECTED = [
  // Stand, not the Stand Hit listed before it; and Stand Hit when asked for.
  "unit-stand=0,24,0",
  "unit-stand-hit=0,12,0",
  // Never told what to play: Birth at 250 ms, then Stand 500 ms after Birth's 500 ms.
  "birth-during=250,48,125",
  "birth-after=500,24,500",
  // Time scale 0 from creation freezes the global sequence at 0.
  "global-frozen=0,24,0",
  // Walk sought to 0.875 s; the global clock kept its 600 ms through the selection and the seek.
  "global-kept=875,36,300",
  // An index the model lacks shows no sequence: the needle at its origin.
  "index-out-of-range=0,0,0",
  // A hidden, frozen clip shown and sought to 0.4 s draws frame start + 400, with or without a second seek.
  "clip-shown=400,24,0",
  "clip-second-seek=400,24,0",
  // 4.5 s of a 1002 ms loop that drops each lap's overshoot at 60 frames a second: 433, where wrapping by the length gives 492.
  "loop-played=433,36,250",
  "loop-reference=900,72,250",
  // A non-looping sequence holds at its end − 1 ms (999), before the needle's last-millisecond jump to 1100.
  "nonloop-held=999,60,250",
  // Sought past the end: a loop restarts at its start, a non-looping sequence holds at its end − 1 ms.
  "loop-seek-past-end=0,36,0",
  "nonloop-seek-past-end=999,60,0",
  // 50 ms into a 150 ms blend from Stand at 500 to Walk at 50: two thirds of the old pose.
  "blend-150=350,28,275",
  "blend-0=50,36,275",
  // Switched at time scale 0: the selection keeps time scale 0, so the blend never moves (old pose) and Walk stays at 0.
  "blend-switch-frozen=500,24,250",
  "timescale-then-select=0,36,250",
  // wisp#59. Destroyed while frozen: Death's first frame, for good; a model without Death is gone at once.
  "death-frozen=0,84,0",
  "no-death-frozen=gone",
  // Destroyed mid-Stand at 1.25 s: Death from that moment, level with the ruler told to play Death then (read 5.75 s later here).
  "death-playing=192,84,500",
  "death-reference=192,84,500",
  // Collapsed to scale 0, then destroyed, as Smashcraft's victory pose is: nothing shown.
  "teardown-hidden=gone",
  // Matrix scale multiplies: X doubled twice is 4 × 125; a reset between leaves 2 × 125.
  "matrix-scale-once=250,24,0",
  "matrix-scale-twice=500,24,0",
  "matrix-scale-reset=250,24,0",
];
