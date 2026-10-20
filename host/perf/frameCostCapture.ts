import { MAX_FRAME_COST_CAPTURE } from "../../src/runtime/frameCostCapture";
import { writtenPreloadFile } from "../headless/headlessInput";
import { preloadLines } from "../io/preloadRecord";

interface FrameCostSample {
  readonly luaUs: number;
  readonly natives: number;
  readonly catchUp: number;
  readonly gcKb: number | undefined;
  readonly sectionsUs: readonly number[];
}

export interface FrameCostCapture {
  readonly run: number;
  readonly version: number;
  readonly clockStepUs: number;
  readonly elapsedMs: number;
  readonly sections: readonly string[];
  readonly samples: readonly FrameCostSample[];
}

export interface CaptureDistribution {
  readonly frames: number;
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export interface SectionRow extends Omit<CaptureDistribution, "frames"> {
  readonly name: string;
  readonly worstShare: number | undefined;
}

export interface SectionTable {
  readonly frames: number;
  readonly worstFrames: number;
  readonly rows: readonly SectionRow[];
  readonly gcKb: Omit<CaptureDistribution, "frames"> | undefined;
}

const SECTION_NAMES = /^(?:[a-z][a-z0-9-]*(?:,[a-z][a-z0-9-]*)*)?$/;

type CaptureHeading = Omit<FrameCostCapture, "samples"> & { readonly frames: number };

function parseHeading(line: string): CaptureHeading {
  const head = /^frame capture run=(\d+) frames=(\d+) version=(\d+) clock-us=([\d.]+) elapsed-ms=([\d.]+) changed=([01]) sections=(\S*)$/.exec(line);
  if (head === null) throw new Error("missing frame capture heading");
  const [run, frames, version, clockStepUs, elapsedMs, changed] = head.slice(1, 7).map(Number);
  const sectionText = head[7] ?? "";
  if (run === undefined || frames === undefined || version === undefined || clockStepUs === undefined || elapsedMs === undefined || ![run, frames, version, clockStepUs, elapsedMs].every(Number.isFinite)
    || run < 1 || frames < 1 || frames > MAX_FRAME_COST_CAPTURE || clockStepUs <= 0 || elapsedMs <= 0) throw new Error("invalid frame capture bounds or unavailable native clock");
  if (changed !== 0) throw new Error("frame capture crossed a code reload");
  if (!SECTION_NAMES.test(sectionText)) throw new Error(`invalid frame capture sections ${sectionText}`);
  return { run, frames, version, clockStepUs, elapsedMs, sections: sectionText === "" ? [] : sectionText.split(",") };
}

function parseSample(line: string, index: number, sections: number): FrameCostSample {
  const match = /^sample (\d+) lua-us=([\d.]+) natives=(\d+) catchup=(\d+) gc-kb=(-?[\d.]+|none) sections-us=([\d.,]*)$/.exec(line);
  if (match === null) throw new Error(`invalid frame capture sample ${index + 1}`);
  const [frame, luaUs, natives, catchUp] = match.slice(1, 5).map(Number);
  const gcKb = match[5] === "none" ? undefined : Number(match[5]);
  const sectionsUs = match[6] === "" ? [] : (match[6] ?? "").split(",").map(Number);
  if (frame !== index + 1 || luaUs === undefined || natives === undefined || catchUp === undefined || ![luaUs, natives, catchUp, gcKb ?? 0, ...sectionsUs].every(Number.isFinite)
    || sectionsUs.length !== sections) throw new Error(`invalid frame capture sample ${index + 1}`);
  return { luaUs, natives, catchUp, gcKb, sectionsUs };
}

export function parseFrameCostCapture(text: string): FrameCostCapture {
  const lines = preloadLines(text);
  if (lines === undefined) throw new Error("frame capture is not a complete Preload file");
  const { frames, ...heading } = parseHeading(lines[0] ?? "");
  if (lines.length !== frames + 1) throw new Error(`frame capture has ${lines.length - 1} samples, expected ${frames}`);
  return { ...heading, samples: lines.slice(1).map((line, index) => parseSample(line, index, heading.sections.length)) };
}

export function captureReceipt(text: string, slot: number): string {
  if (text.trimStart().startsWith("function PreloadFiles")) return text;
  const prefix = `p${slot} capture: `;
  const lines = text.split("\n").filter((line) => line.startsWith(prefix)).map((line) => line.slice(prefix.length));
  if (lines.length === 0) throw new Error(`neither a Preload receipt nor a perf run with p${slot} capture lines`);
  return writtenPreloadFile(lines);
}

function spread(values: readonly number[]): Omit<CaptureDistribution, "frames"> {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("frame capture has no samples");
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle] ?? 0 : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  const rank = (numerator: number) => sorted[Math.ceil(sorted.length * numerator / 100) - 1] ?? 0;
  return { median, p95: rank(95), p99: rank(99), max: sorted[sorted.length - 1] ?? 0 };
}

export function captureDistribution(capture: FrameCostCapture): CaptureDistribution {
  return { frames: capture.samples.length, ...spread(capture.samples.map(({ luaUs }) => luaUs)) };
}

export function sectionTable(capture: FrameCostCapture): SectionTable {
  const { samples } = capture;
  const other = samples.map(({ luaUs, sectionsUs }) => sectionsUs.reduce((rest, value) => rest - value, luaUs));
  const columns = [...capture.sections.map((name, index) => ({ name, values: samples.map(({ sectionsUs }) => sectionsUs[index] ?? 0) })),
    { name: "other", values: other }, { name: "total", values: samples.map(({ luaUs }) => luaUs) }];
  const worstFrames = Math.ceil(samples.length / 100);
  const worst = samples.map(({ luaUs }, index) => ({ luaUs, index })).sort((a, b) => b.luaUs - a.luaUs || a.index - b.index).slice(0, worstFrames);
  const worstTotal = worst.reduce((total, { luaUs }) => total + luaUs, 0);
  const rows = columns.map(({ name, values }): SectionRow => ({
    name, ...spread(values),
    worstShare: worstTotal > 0 ? worst.reduce((total, { index }) => total + (values[index] ?? 0), 0) / worstTotal : undefined,
  }));
  const gc = samples.flatMap(({ gcKb }) => (gcKb === undefined ? [] : [gcKb]));
  return { frames: samples.length, worstFrames, rows, gcKb: gc.length === samples.length ? spread(gc) : undefined };
}

const ms = (us: number) => (us / 1000).toFixed(3);

export function sectionTableLines(table: SectionTable): string[] {
  const width = Math.max(7, ...table.rows.map(({ name }) => name.length));
  const cells = (values: readonly string[]) => values.map((value) => value.padStart(9)).join("");
  return [
    `${table.frames} frames; worst 1% = ${table.worstFrames} frames by total Lua time; milliseconds`,
    `${"section".padEnd(width)}${cells(["median", "p95", "p99", "worst", "worst 1%"])}`,
    ...table.rows.map((row) => `${row.name.padEnd(width)}${cells([ms(row.median), ms(row.p95), ms(row.p99), ms(row.max), row.worstShare === undefined ? "-" : `${(row.worstShare * 100).toFixed(1)}%`])}`),
    table.gcKb === undefined ? "gc-kb: unavailable" : `${"gc-kb".padEnd(width)}${cells([table.gcKb.median, table.gcKb.p95, table.gcKb.p99, table.gcKb.max].map((value) => value.toFixed(1)))}`,
  ];
}
