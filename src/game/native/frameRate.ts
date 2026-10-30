/** Warcraft III's simulation rate, which headless clients, lockstep peers and the renderers step at. */
export const FRAMES_PER_SECOND = 60;
export const FRAME_MS = 1000 / FRAMES_PER_SECOND;
/** Frames headless clients have stepped in this process: a test's deterministic cost (wisp:host/testing/testCostPreload.ts). */
export const steppedFrames = { count: 0 };

export interface CallbackTiming {

  wallMs(this: void, frame: number): number;
}

export const EVEN_CALLBACKS: CallbackTiming = { wallMs: (frame) => frame * FRAME_MS };

export function turnStart(timing: CallbackTiming | undefined, frame: number): number {
  if (timing === undefined) return frame;
  let start = frame;
  while (timing.wallMs(start) <= timing.wallMs(start - 1)) start++;
  return start;
}

export function stampWallTime(timing: CallbackTiming | undefined, clients: readonly { setWallTime(seconds: number): void }[], frame: number): void {
  if (timing === undefined) return;
  for (const client of clients) client.setWallTime(timing.wallMs(frame) / 1000);
}
