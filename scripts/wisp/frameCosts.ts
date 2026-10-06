// FrameCosts: the frame meter's report after each hot reload
// (wisp:docs/frame-cost.md). Each client writes what the frames before the
// reload and the same number of frames after it cost; `wisp hot --watch` and
// `wisp dev` print the change and flag a regression.
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { type FrameWindow, type Spread, frameCostFile } from "../../src/runtime/frameCost";
import { Count, FILE_SLOT_NUMBERS, type MalformedGameFile, Seconds, preloadRecord } from "./boundary";
import { type GameFileFailure, GameFiles } from "./gameFiles";

const SpreadText = Schema.String.check(Schema.isPattern(/^\d+(\.\d+)?\/\d+(\.\d+)?\/\d+(\.\d+)?$/));
const LuaText = Schema.Union([Schema.Literal("none"), SpreadText]);
const windowFields = (label: string) => `${label} frames={${label}Frames} lua={${label}Lua} natives={${label}Natives} catchup={${label}CatchUp}`;

/** The report a client writes once the version it runs has played a window of frames. */
export const FrameCostReportFile = preloadRecord(
  { head: ["frame cost {version} after {previous} clock={clock}", windowFields("before"), windowFields("after")] },
  Schema.Struct({
    version: Schema.String.check(Schema.isPattern(/^v\d+$/)),
    previous: Schema.String.check(Schema.isPattern(/^v\d+$/)),
    clock: Seconds,
    beforeFrames: Count, beforeLua: LuaText, beforeNatives: SpreadText, beforeCatchUp: SpreadText,
    afterFrames: Count, afterLua: LuaText, afterNatives: SpreadText, afterCatchUp: SpreadText,
  }),
);

export interface FrameCostReport {
  readonly version: number;
  readonly previous: number;
  /** The game clock's step in microseconds; 0 without a clock. */
  readonly clockStep: number;
  readonly before: FrameWindow;
  readonly after: FrameWindow;
}

function parseSpread(text: string): Spread {
  const [median = 0, mean = 0, max = 0] = text.split("/").map(Number);
  return { median, mean, max };
}

const window = (frames: number, lua: string, natives: string, catchUp: string): FrameWindow =>
  ({ frames, lua: lua === "none" ? undefined : parseSpread(lua), natives: parseSpread(natives), catchUp: parseSpread(catchUp) });

/** A frame-cost report file's text, decoded. */
export const decodeFrameCostReport = (file: string, text: string): Effect.Effect<FrameCostReport, MalformedGameFile> =>
  FrameCostReportFile.decode(file, text).pipe(Effect.map((fields) => ({
    version: Number(fields.version.slice(1)),
    previous: Number(fields.previous.slice(1)),
    clockStep: fields.clock,
    before: window(fields.beforeFrames, fields.beforeLua, fields.beforeNatives, fields.beforeCatchUp),
    after: window(fields.afterFrames, fields.afterLua, fields.afterNatives, fields.afterCatchUp),
  })));

/** How much worse a version may be before it is flagged: a share of the previous value, 0.2 for 20%. */
export const DEFAULT_FRAME_COST_THRESHOLD = 0.2;

const milliseconds = (microseconds: number) => (microseconds / 1000).toFixed(2);
const change = (before: number, after: number) => (before === 0 ? (after === 0 ? "+0%" : "new") : `${after >= before ? "+" : ""}${Math.round((after / before - 1) * 100)}%`);
const rose = (before: number, after: number, threshold: number) => after > before * (1 + threshold);

/** What got worse beyond the threshold: Lua time per frame, by its mean, and calls per frame, by their median. */
export function frameCostRegressions({ before, after, clockStep }: FrameCostReport, threshold = DEFAULT_FRAME_COST_THRESHOLD): string[] {
  const regressions: string[] = [];
  // A mean of 120 frames moves by less than a quarter of the clock's step from rounding alone.
  if (before.lua !== undefined && after.lua !== undefined && rose(before.lua.mean, after.lua.mean, threshold) && after.lua.mean - before.lua.mean > clockStep / 4) {
    regressions.push(`Lua time ${change(before.lua.mean, after.lua.mean)}`);
  }
  if (rose(before.natives.median, after.natives.median, threshold)) regressions.push(`natives ${change(before.natives.median, after.natives.median)}`);
  return regressions;
}

/** The report as one line: each value before and after the reload, then any regression. */
export function formatFrameCost(slot: number, report: FrameCostReport, threshold = DEFAULT_FRAME_COST_THRESHOLD): string {
  const { before, after } = report;
  const lua = before.lua === undefined || after.lua === undefined
    ? "Lua time: no clock"
    : `Lua ${milliseconds(before.lua.mean)} -> ${milliseconds(after.lua.mean)} ms mean (${change(before.lua.mean, after.lua.mean)}), max ${milliseconds(before.lua.max)} -> ${milliseconds(after.lua.max)} ms`;
  const natives = `natives ${before.natives.median} -> ${after.natives.median} median (${change(before.natives.median, after.natives.median)}), max ${before.natives.max} -> ${after.natives.max}`;
  const catchUp = `catch-up ${before.catchUp.median} -> ${after.catchUp.median} median, max ${before.catchUp.max} -> ${after.catchUp.max}`;
  const regressions = frameCostRegressions(report, threshold);
  const verdict = regressions.length === 0 ? "" : `; REGRESSION over ${Math.round(threshold * 100)}%: ${regressions.join(", ")}`;
  return `p${slot} frame cost v${report.version} vs v${report.previous} (${before.frames} and ${after.frames} frames): ${lua}; ${natives}; ${catchUp}${verdict}`;
}

export interface ClientFrameCost {
  readonly slot: number;
  readonly report: FrameCostReport;
}

export class FrameCosts extends Context.Service<FrameCosts, {
  /** Reports in these CustomMapData folders that are new or changed since the previous look. */
  readonly changed: (directories: readonly string[]) => Effect.Effect<readonly ClientFrameCost[], GameFileFailure | MalformedGameFile>;
}>()("wisp/FrameCosts") {
  static readonly layer = (filePrefix = "wisp") => Layer.effect(FrameCosts, Effect.gen(function*() {
    const files = yield* GameFiles;
    const seen = new Map<string, string>();
    return FrameCosts.of({
      changed: Effect.fnUntraced(function*(directories) {
        const reports: ClientFrameCost[] = [];
        for (const directory of directories) {
          for (const slot of FILE_SLOT_NUMBERS) {
            const path = join(directory, frameCostFile(slot, filePrefix));
            const stored = yield* files.read(path);
            if (stored === undefined || seen.get(path) === stored.text) continue;
            // Marked seen before decoding, so a malformed report fails once, not on every look.
            seen.set(path, stored.text);
            reports.push({ slot, report: yield* decodeFrameCostReport(path, stored.text) });
          }
        }
        return reports;
      }),
    });
  }));
}
