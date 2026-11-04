/** A key the press-latency harness presses and releases in-process. */
export interface Keyboard {
  /** Presses or releases the key, returning the monotonic nanoseconds just before and after the request left for the server. */
  readonly send: (down: boolean) => { readonly beforeNs: number; readonly afterNs: number };
}
