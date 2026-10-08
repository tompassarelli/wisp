/**
 * Each ruler's row, `needle X,needle Y,global marker X` in world units from
 * its drawn origin, or `gone`, as wisp:docs/warsmash-notes.md's "Animation
 * playback" and "Effects: attachment, scale and lifetime" rules draw it
 * headlessly, a second after the map is ready. The 3.0.1 capture read by
 * read.ts confirms or replaces each, within the ruler's timing allowance
 * (layout.ts). Times are seconds after the cases start.
 */
export const EXPECTED = [
  // Stand, not the Stand Hit listed before it; and Stand Hit when asked for.
  "unit-stand=0,24,0",
  "unit-stand-hit=0,12,0",
  // Never told what to play: Birth at 250 ms, then Stand 500 ms after Birth's 500 ms (499 after flooring 60 frame steps).
  "birth-during=250,48,125",
  "birth-after=499,24,500",
  // Time scale 0 in the creating call freezes the global sequence at 0.
  "global-frozen=0,24,0",
  // Walk sought to 0.875 s; the global clock kept its 600 ms through the selection and the seek.
  "global-kept=875,36,300",
  // An index the model lacks shows Stand (3.0.1, 8 Oct capture).
  "index-out-of-range=0,24,0",
  // A hidden, frozen clip shown and sought to 0.4 s draws frame start + 400, with or without a second seek.
  "clip-shown=400,24,0",
  "clip-second-seek=400,24,0",
  // 3.0.1 capture 2: a selection restarts on the next drawn frame, replacing a seek made in the same callback.
  "select-freeze-seek=0,36,500",
  "freeze-then-select-seek=0,36,250",
  // 4.5 s of a 1002 ms loop wraps by its length, keeping the overshoot: 492 (3.0.1, 8 Oct capture).
  "loop-played=492,36,250",
  "loop-reference=900,72,250",
  // A non-looping sequence holds its interval end, after the needle's last-millisecond jump to 1100 (3.0.1, 8 Oct capture).
  "nonloop-held=1100,60,250",
  // Frozen at 0.5 s and sought to 1.5 s: a loop wraps to 498, a non-looping sequence holds its end.
  "loop-seek-past-end=498,36,250",
  "nonloop-seek-past-end=1100,60,250",
  // 50 ms into a 150 ms blend from Stand at 500 to Walk at 50: two thirds of the old pose.
  "blend-150=350,28,275",
  "blend-0=50,36,275",
  // Switched at time scale 0: the selection keeps time scale 0, so the blend never moves (old pose) and Walk stays at 0.
  "blend-switch-frozen=500,24,250",
  "timescale-then-select=0,36,250",
  // wisp#59. Told to play Death at 5.25 s, and destroyed mid-Stand at 5.25, 6.25 and 7.25 s: Death from that moment,
  // read 3.75 s after the first.
  "death-reference=125,84,500",
  "death-at-0=125,84,500",
  "death-at-1=92,84,500",
  "death-at-2=58,84,500",
  // Destroyed while frozen: Death's first frame, for good; a model without Death is gone at once.
  "death-frozen=0,84,250",
  "no-death-frozen=gone",
  // Collapsed to scale 0, then destroyed, as Smashcraft's victory pose is: nothing shown.
  "teardown-hidden=gone",
  // Matrix scale multiplies: X doubled twice is 4 × 125; a reset between leaves 2 × 125. The global marker, frozen at
  // 100 ms, sits at (40 + 50) × the X scale, less 40.
  "matrix-scale-once=250,24,140",
  "matrix-scale-twice=500,24,320",
  "matrix-scale-reset=250,24,140",
];

/** What the map writes when it is ready: the ruler count and where each ruler unit stands, `X×128,Y×128`. */
export const EXPECTED_FILE = [
  "ready=30",
  "unit-stand-at=-224000,64000",
  "unit-stand-hit-at=-224000,43520",
  "index-out-of-range-at=-224000,-58880",
  "blend-150-at=-70400,-58880",
  "blend-0-at=-70400,-79360",
  "blend-switch-frozen-at=-70400,-99840",
  "timescale-then-select-at=-70400,-120320",
];
