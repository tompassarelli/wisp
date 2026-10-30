const CONTROL_INTS = 8;
const SEQUENCE = 0, STOP = 1, ACKNOWLEDGED = 2;
const SLOTS = 64, FIELDS = 5;

/** The shared memory between Bun's main thread, which takes each wake from the render thread, and the worker thread that steps the game: a wake count, a stop flag and a ring of the wakes' numbers. */
export interface WakeBox {
  readonly buffer: SharedArrayBuffer;
  readonly control: Int32Array;
  readonly ring: Float64Array;
}

export interface Wake {
  readonly kind: number;
  readonly frame: number;
  readonly sampleNs: number;
  readonly mask: number;
  readonly handledNs: number;
}

export const wakeBox = (buffer: SharedArrayBuffer = new SharedArrayBuffer(CONTROL_INTS * 4 + SLOTS * FIELDS * 8)): WakeBox => ({
  buffer, control: new Int32Array(buffer, 0, CONTROL_INTS), ring: new Float64Array(buffer, CONTROL_INTS * 4, SLOTS * FIELDS),
});

/** Called on the main thread for every wake: numbers into the ring, then the count, so nothing is allocated. */
export function publishWake(box: WakeBox, kind: number, frame: number, sampleNs: number, mask: number, handledNs: number): void {
  const next = Atomics.load(box.control, SEQUENCE) + 1;
  const at = next % SLOTS * FIELDS;
  box.ring[at] = kind;
  box.ring[at + 1] = frame;
  box.ring[at + 2] = sampleNs;
  box.ring[at + 3] = mask;
  box.ring[at + 4] = handledNs;
  Atomics.store(box.control, SEQUENCE, next);
  Atomics.notify(box.control, SEQUENCE);
}

/** The worker side: calls `take` for the newest wake each time one arrives, until a stop is requested, then runs `beforeAcknowledging` and acknowledges. */
export async function takeWakes(box: WakeBox, take: (wake: Wake) => void, beforeAcknowledging: () => void): Promise<void> {
  let seen = 0;
  for (;;) {
    const sequence = Atomics.load(box.control, SEQUENCE);
    if (Atomics.load(box.control, STOP) === 1) break;
    if (sequence === seen) {
      const waiting = Atomics.waitAsync(box.control, SEQUENCE, seen);
      if (waiting.async) await waiting.value;
      continue;
    }
    seen = sequence;
    const at = sequence % SLOTS * FIELDS;
    take({ kind: box.ring[at]!, frame: box.ring[at + 1]!, sampleNs: box.ring[at + 2]!, mask: box.ring[at + 3]!, handledNs: box.ring[at + 4]! });
  }
  beforeAcknowledging();
  Atomics.store(box.control, ACKNOWLEDGED, 1);
  Atomics.notify(box.control, ACKNOWLEDGED);
}

/** Tells the worker to stop and waits up to `timeoutMs` until it has, so it makes no call on the window after this returns true. */
export function stopWakes(box: WakeBox, timeoutMs: number): boolean {
  Atomics.store(box.control, STOP, 1);
  Atomics.notify(box.control, SEQUENCE);
  return Atomics.wait(box.control, ACKNOWLEDGED, 0, timeoutMs) !== "timed-out";
}
