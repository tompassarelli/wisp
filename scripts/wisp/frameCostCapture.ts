import { MAX_FRAME_COST_CAPTURE } from "../../src/runtime/frameCostCapture";
import { preloadLines } from "./boundary";

export interface FrameCostSample {
  readonly luaUs: number;
  readonly natives: number;
  readonly catchUp: number;
}

export interface FrameCostCapture {
  readonly run: number;
  readonly version: number;
  readonly clockStepUs: number;
  readonly elapsedMs: number;
  readonly samples: readonly FrameCostSample[];
}

export interface CaptureDistribution {
  readonly frames: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export function parseFrameCostCapture(text: string): FrameCostCapture {
  const lines = preloadLines(text);
  if (lines === undefined) throw new Error("frame capture is not a complete Preload file");
  const head = /^frame capture run=(\d+) frames=(\d+) version=(\d+) clock-us=([\d.]+) elapsed-ms=([\d.]+) changed=([01])$/.exec(lines[0] ?? "");
  if (head === null) throw new Error("missing frame capture heading");
  const [run, frames, version, clockStepUs, elapsedMs, changed] = head.slice(1).map(Number);
  if (run === undefined || frames === undefined || version === undefined || clockStepUs === undefined || elapsedMs === undefined || ![run, frames, version, clockStepUs, elapsedMs].every(Number.isFinite)
    || run < 1 || frames < 1 || frames > MAX_FRAME_COST_CAPTURE || clockStepUs <= 0 || elapsedMs <= 0) throw new Error("invalid frame capture bounds or unavailable native clock");
  if (changed !== 0) throw new Error("frame capture crossed a code reload");
  if (lines.length !== frames + 1) throw new Error(`frame capture has ${lines.length - 1} samples, expected ${frames}`);
  const samples = lines.slice(1).map((line, index): FrameCostSample => {
    const match = /^sample (\d+) lua-us=([\d.]+) natives=(\d+) catchup=(\d+)$/.exec(line);
    if (match === null) throw new Error(`invalid frame capture sample ${index + 1}`);
    const [frame, luaUs, natives, catchUp] = match.slice(1).map(Number);
    if (frame !== index + 1 || luaUs === undefined || natives === undefined || catchUp === undefined || ![luaUs, natives, catchUp].every(Number.isFinite)) throw new Error(`invalid frame capture sample ${index + 1}`);
    return { luaUs, natives, catchUp };
  });
  return { run, version, clockStepUs, elapsedMs, samples };
}

export function captureDistribution(capture: FrameCostCapture): CaptureDistribution {
  const sorted = capture.samples.map(({ luaUs }) => luaUs).sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("frame capture has no samples");
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  const rank = (numerator: number) => sorted[Math.ceil(sorted.length * numerator / 100) - 1] ?? 0;
  return { frames: sorted.length, median, p95: rank(95), p99: rank(99), max: sorted[sorted.length - 1] ?? 0 };
}
