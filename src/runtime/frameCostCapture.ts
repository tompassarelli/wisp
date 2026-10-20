import { reportNumber } from "./frameCost";

export const MAX_FRAME_COST_CAPTURE = 18000;

export const frameCostCaptureFile = (slot: number, run: number, prefix = "wisp") => `${prefix}-perf-capture-p${slot}-run${run}.txt`;

export const frameCostCaptureHeading = (run: number, frames: number, version: number, clockStepUs: number, elapsedMs: number, changed: boolean, sections: readonly string[]) =>
  `frame capture run=${run} frames=${frames} version=${version} clock-us=${reportNumber(clockStepUs)} elapsed-ms=${reportNumber(elapsedMs)} changed=${changed ? 1 : 0} sections=${sections.join(",")}`;

const signed = (value: number) => (value < 0 ? `-${reportNumber(-value)}` : reportNumber(value));

export const frameCostCaptureSample = (frame: number, luaUs: number | undefined, natives: number, catchUp: number, gcKb: number | undefined, sectionsUs: readonly number[]) =>
  `sample ${frame} lua-us=${luaUs === undefined ? "none" : reportNumber(luaUs)} natives=${natives} catchup=${catchUp} gc-kb=${gcKb === undefined ? "none" : signed(gcKb)} sections-us=${sectionsUs.map((value) => reportNumber(value)).join(",")}`;
