
import { reportNumber } from "./frameCost";


export const MAX_FRAME_COST_CAPTURE = 18000;

export const frameCostCaptureFile = (slot: number, run: number, prefix = "wisp") => `${prefix}-perf-capture-p${slot}-run${run}.txt`;

export const frameCostCaptureHeading = (run: number, frames: number, version: number, clockStepUs: number, elapsedMs: number, changed: boolean) =>
  `frame capture run=${run} frames=${frames} version=${version} clock-us=${reportNumber(clockStepUs)} elapsed-ms=${reportNumber(elapsedMs)} changed=${changed ? 1 : 0}`;

export const frameCostCaptureSample = (frame: number, luaUs: number | undefined, natives: number, catchUp: number) =>
  `sample ${frame} lua-us=${luaUs === undefined ? "none" : reportNumber(luaUs)} natives=${natives} catchup=${catchUp}`;
