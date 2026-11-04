import { appendFileSync, writeFileSync } from "node:fs";
import { monotonicNs } from "../os/platform/linux/monotonic";
import type { InputSample, WindowView } from "./binding";

/** A sample whose input changed from the sample before it, stamped on CLOCK_MONOTONIC, which the press-latency harness reads too; `pressed` when it carried a new pad button or a key going down. */
export interface SampleEdge {
  readonly sampleNs: number;
  readonly mask: number;
  readonly pressed: boolean;
}

/** `WISP_WINDOW_SAMPLE_LOG`: where the window appends one JSON line per button change or key transition, for the press-latency harness (wisp:docs/native-window-plan.md, "How it is measured"). */
export const SAMPLE_LOG_VARIABLE = "WISP_WINDOW_SAMPLE_LOG";

/** Starts `path` empty and returns the recorder for samples taken from `window`; the library's clock counts from its first call, so each stamp is moved onto CLOCK_MONOTONIC by the offset read here. */
export function openSampleLog(path: string, window: Pick<WindowView, "nowNs">): (sample: Pick<InputSample, "sampleNs" | "mask" | "keys">) => void {
  writeFileSync(path, "");
  const offsetNs = monotonicNs() - window.nowNs();
  let previous = 0;
  return (sample) => {
    if (sample.mask === previous && sample.keys.length === 0) return;
    const pressed = (sample.mask & ~previous) !== 0 || sample.keys.some((key) => key.down);
    previous = sample.mask;
    appendFileSync(path, JSON.stringify({ sampleNs: sample.sampleNs + offsetNs, mask: sample.mask, pressed } satisfies SampleEdge) + "\n");
  };
}

export const parseSampleLog = (text: string): SampleEdge[] =>
  text.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as SampleEdge);
