import { FRAMES_PER_SECOND } from "./frameRate";
import type { Handle, HandleFactory } from "./types";

type Callback = (this: void) => void;

interface Timer extends Handle {
  callback: Callback | undefined;
  periodic: boolean;
  timeout: number;
  period: number;
  due: number;
  order: number;
  firedAt: number;
  running: boolean;
  expired: boolean;
  paused: number | undefined;
}

const TRIM = 1e6;

/** The frames a span of seconds takes, with the float noise of a period such as binary32 1/60 removed. */
const framesOf = (seconds: number): number => Math.round(seconds * FRAMES_PER_SECOND * TRIM) / TRIM;

/** The timers of one running game, counted in whole simulation frames: a timer fires on the frame at or after its deadline, once per frame at most, in deadline then start order. */
export class Clock {
  private readonly timers: Timer[] = [];
  private order = 0;
  private now = 0;
  speed: unknown = "MAP_SPEED_NORMAL";

  constructor(private readonly handle: HandleFactory) {}

  create(): Handle {
    const timer: Timer = { ...this.handle("timer"), callback: undefined, periodic: false, timeout: 0, period: 0, due: 0, order: 0, firedAt: 0,
      running: false, expired: false, paused: undefined };
    this.timers.push(timer);
    return timer;
  }

  start(handle: Handle, seconds: number, periodic: boolean, callback: Callback): void {
    const timer = handle as Timer;
    timer.callback = callback;
    timer.periodic = periodic;
    timer.timeout = seconds;
    timer.period = Math.max(0, framesOf(seconds));
    timer.due = this.now + timer.period;
    timer.order = ++this.order;
    timer.firedAt = this.now;
    timer.running = true;
    timer.expired = false;
    timer.paused = undefined;
  }

  pause(handle: Handle): void {
    const timer = handle as Timer;
    if (timer.running) timer.paused = this.elapsed(timer);
    timer.running = false;
  }

  destroy(handle: Handle): void {
    const timer = handle as Timer;
    timer.running = false;
    const index = this.timers.indexOf(timer);
    if (index >= 0) this.timers.splice(index, 1);
  }

  /** Seconds into the timer's current period. */
  elapsed(handle: Handle): number {
    const timer = handle as Timer;
    if (timer.paused !== undefined) return timer.paused;
    if (timer.expired) return timer.timeout;
    if (!timer.running) return 0;
    const into = timer.period - Math.max(0, timer.due - this.now);
    return Math.max(0, into) / FRAMES_PER_SECOND;
  }

  runDue(frame: number): void {
    this.now = frame;
    for (;;) {
      let next: Timer | undefined;
      for (const timer of this.timers) {
        if (!timer.running || timer.callback === undefined || timer.due > frame || timer.firedAt === frame) continue;
        if (next === undefined || timer.due < next.due || (timer.due === next.due && timer.order < next.order)) next = timer;
      }
      if (next === undefined || next.callback === undefined) return;
      next.firedAt = frame;
      if (next.periodic) {
        const following = next.due + next.period;
        next.due = following > frame ? following : frame + next.period;
      } else {
        next.running = false;
        next.expired = true;
      }
      next.callback();
    }
  }
}
