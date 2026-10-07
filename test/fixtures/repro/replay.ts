// A game for `wisp repro`'s tests: its state is a record of a total, saved as
// record text, and each frame adds a number.
import { lineTokens, parseRecord } from "../../../src/runtime/recordText";
import type { Repro, ReproInspection, ReproResult } from "../../../src/runtime/repro";

export function replayRepro(repro: Repro): ReproResult {
  const state = parseRecord(lineTokens(repro.lines.filter((line) => !line.startsWith("add "))));
  if (state === undefined || typeof state.total !== "number") return { checksum: "", frames: 0, problems: ["no state"] };
  let total = state.total;
  let frames = 0;
  for (const line of repro.lines.filter((line) => line.startsWith("add "))) {
    total += Number(line.substring(4));
    frames++;
  }
  return { checksum: `total-${total}`, frames, problems: [] };
}

export function inspectRepro(repro: Repro, frame: number): ReproInspection | string {
  if (!Number.isInteger(frame) || frame < 0 || frame > repro.frame) return `frame ${frame} is outside the saved interval 0..${repro.frame}`;
  const state = parseRecord(lineTokens(repro.lines.filter(line => !line.startsWith("add "))));
  if (state === undefined || typeof state.total !== "number") return "no state";
  let total = state.total;
  for (const line of repro.lines.filter(line => line.startsWith("add ")).slice(0, frame)) total += Number(line.substring(4));
  return { frame, checksum: `total-${total}`, state: `Fixture|total=${total}`, fields: [{ path: "total", value: String(total) }] };
}
