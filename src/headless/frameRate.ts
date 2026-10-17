/** Warcraft III's simulation rate, which headless clients, lockstep peers and the renderers step at. */
export const FRAMES_PER_SECOND = 60;
export const FRAME_MS = 1000 / FRAMES_PER_SECOND;
/** Frames headless clients have stepped in this process: a test's deterministic cost (wisp:host/testing/testCostPreload.ts). */
export const steppedFrames = { count: 0 };
