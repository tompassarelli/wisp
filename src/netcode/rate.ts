export const FULL_SPEED_FPS = 60;
export const SLOW_FPS = 55;
export const SATURATED_BUSY_MS = 750;
export const SUSTAIN_SECONDS = 2;

export interface MachineRate {
  fps: number;
  slow: boolean;
  slowSeconds: number;
  fastSeconds: number;
}

export const machineRate = (): MachineRate => ({ fps: -1, slow: false, slowSeconds: 0, fastSeconds: 0 });

export const secondFps = (frames: number, seconds: number): number =>
  seconds <= 0 ? FULL_SPEED_FPS : Math.min(FULL_SPEED_FPS, Math.floor(frames / seconds + 0.5));

export const saturatedSecond = (fps: number, busyMs: number): boolean => fps < SLOW_FPS && busyMs >= SATURATED_BUSY_MS;

export function noteMachineSecond(rate: MachineRate, fps: number, busyMs: number): void {
  rate.fps = fps;
  if (saturatedSecond(fps, busyMs)) {
    rate.fastSeconds = 0;
    rate.slowSeconds++;
    if (rate.slowSeconds >= SUSTAIN_SECONDS) rate.slow = true;
  } else {
    rate.slowSeconds = 0;
    rate.fastSeconds++;
    if (rate.fastSeconds >= SUSTAIN_SECONDS) rate.slow = false;
  }
}
