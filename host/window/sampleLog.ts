import { appendFileSync, writeFileSync } from "node:fs";
import type { InputSample, WindowView } from "./binding";

/** A sample whose pressed buttons differ from the sample before it, stamped on the monotonic clock `process.hrtime` reads, which the press-latency harness shares. */
export interface SampleEdge {
  readonly sampleNs: number;
  readonly mask: number;
}

/** `WISP_WINDOW_SAMPLE_LOG`: where the window appends one JSON line per button change, for the press-latency harness (wisp:docs/native-window-plan.md, "How it is measured"). */
export const SAMPLE_LOG_VARIABLE = "WISP_WINDOW_SAMPLE_LOG";

/** Starts `path` empty and returns the recorder for samples taken from `window`; the library's clock counts from its first call, so each stamp is moved onto the monotonic clock by the offset read here. */
export function openSampleLog(path: string, window: Pick<WindowView, "nowNs">): (sample: InputSample) => void {
  writeFileSync(path, "");
  const offsetNs = Number(process.hrtime.bigint()) - window.nowNs();
  let previous = 0;
  return (sample) => {
    if (sample.mask === previous) return;
    previous = sample.mask;
    appendFileSync(path, JSON.stringify({ sampleNs: sample.sampleNs + offsetNs, mask: sample.mask } satisfies SampleEdge) + "\n");
  };
}

export const parseSampleLog = (text: string): SampleEdge[] =>
  text.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as SampleEdge);
