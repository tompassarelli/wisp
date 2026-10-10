import { installHeadless } from "./headless";
import { type SoakGame, type SoakInputs, type SoakProject, type SoakRepro, playSoakMatch, soakRepro } from "./soak";

const INPUTS = ["edges", "silences", "hitches", "slow", "typed", "files"] as const;

export const soakInputCount = (inputs: SoakInputs): number => INPUTS.reduce((count, key) => count + (inputs[key]?.length ?? 0), 0);

export function deltaDebug<T>(inputs: readonly T[], fails: (cut: readonly T[]) => boolean): readonly T[] {
  let kept = inputs;
  if (fails([])) return [];
  let parts = 2;
  while (kept.length > 1) {
    const width = Math.ceil(kept.length / parts);
    let cut = false;
    for (let start = 0; start < kept.length; start += width) {
      const candidate = [...kept.slice(0, start), ...kept.slice(start + width)];
      if (!fails(candidate)) continue;
      kept = candidate;
      parts = Math.max(2, parts - 1);
      cut = true;
      break;
    }
    if (cut) continue;
    if (parts >= kept.length) break;
    parts = Math.min(kept.length, parts * 2);
  }
  return kept;
}

export interface ShrunkSoakRepro {
  readonly repro: SoakRepro;
  readonly before: number;
  readonly after: number;
  readonly attempts: number;
  readonly elapsedMs: number;
}

export function shrinkSoakRepro(project: SoakProject, game: SoakGame, repro: SoakRepro): ShrunkSoakRepro {
  if (repro.project !== project.name) throw new Error(`repro belongs to ${repro.project}, not ${project.name}`);
  const kind = repro.findings[0]?.kind;
  if (kind === undefined) throw new Error("the repro has no failure to shrink");
  const started = performance.now();
  const runtime = installHeadless(project.map);
  let attempts = 0;
  try {
    const replay = (inputs: SoakInputs) => {
      attempts++;
      return playSoakMatch(runtime, game, project, repro.match, inputs);
    };
    const baseline = replay(repro.inputs);
    if (!baseline.findings.some(finding => finding.kind === kind)) throw new Error(`the original repro no longer fails with ${kind}`);
    let result = baseline;
    const entries = INPUTS.flatMap(key => (repro.inputs[key] ?? []).map((entry, index) => ({ key, index, frame: entry[0] })))
      .sort((a, b) => a.frame - b.frame);
    const select = (cut: readonly (typeof entries)[number][]): SoakInputs => {
      const kept = new Set(cut.map(entry => `${entry.key}:${entry.index}`));
      const has = (key: string) => (_: unknown, index: number) => kept.has(`${key}:${index}`);
      return {
        edges: repro.inputs.edges.filter(has("edges")), silences: repro.inputs.silences.filter(has("silences")),
        hitches: repro.inputs.hitches.filter(has("hitches")), slow: repro.inputs.slow.filter(has("slow")),
        ...(repro.inputs.typed === undefined ? {} : { typed: repro.inputs.typed.filter(has("typed")) }),
        ...(repro.inputs.files === undefined ? {} : { files: repro.inputs.files.filter(has("files")) }),
      };
    };
    const kept = deltaDebug(entries, cut => {
      const candidate = replay(select(cut));
      if (!candidate.findings.some(finding => finding.kind === kind)) return false;
      result = candidate;
      return true;
    });
    const shrunk = soakRepro(project.name, { ...result, inputs: select(kept) });
    return {
      repro: { ...shrunk, findings: [...shrunk.findings.filter(finding => finding.kind === kind), ...shrunk.findings.filter(finding => finding.kind !== kind)] },
      before: entries.length, after: kept.length, attempts, elapsedMs: performance.now() - started,
    };
  } finally {
    runtime.restore();
  }
}

export function assertSoakReproFixed(project: SoakProject, game: SoakGame, repro: SoakRepro): void {
  const runtime = installHeadless(project.map);
  try {
    const result = playSoakMatch(runtime, game, project, repro.match, repro.inputs);
    const kind = repro.findings[0]?.kind;
    const failure = result.findings.find(finding => finding.kind === kind);
    if (failure !== undefined) throw new Error(`${failure.kind} at frame ${failure.frame}: ${failure.text}`);
  } finally {
    runtime.restore();
  }
}
