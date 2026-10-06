// A game for `wisp repro`'s tests: its state is a record of a total, saved as
// record text, and each frame adds a number.
import { lineTokens, parseRecord } from "../../../src/runtime/recordText";
import type { Repro, ReproResult } from "../../../src/runtime/repro";

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
