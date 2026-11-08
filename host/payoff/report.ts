import { createHash } from "node:crypto";
import { parentOf, type Run } from "./evidence";

export interface Counts {
  runs: number;
  client_minutes: number;
  estimated_minutes: number;
  compared: number;
  agrees: number;
  disagrees: number;
  invalid: number;
}

export interface Family {
  readonly id: string;
  readonly scripts: string[];
  readonly match_rule: { readonly kind: "none" | "exact-path" | "parent-directory"; readonly values: string[] };
  verdict: "native" | "wisp-only";
  native_sample_rate: number;
  readonly counts: Counts;
  readonly window_start_unix: number;
  readonly window_end_unix: number;
}

export interface Week {
  readonly week: string;
  readonly native_client_minutes: number;
  wisp_commits: number | null;
  readonly native_minutes_avoided: null;
  projected_sample_saving_minutes: number;
  readonly closed_public_boxes: null;
  readonly minutes_per_closed_box: null;
  readonly wisp_only_share: null;
}

export interface Report {
  readonly schema_version: 1;
  readonly families: Family[];
  readonly sampler: typeof SAMPLER;
  readonly kinds: { readonly week: string; readonly kind: string; readonly counts: Counts }[];
  readonly weeks: Week[];
  retire: string[];
  readonly fixes: { readonly kind: string; readonly evidence: string[] }[];
  files: string[];
  readonly runs: Run[];
  readonly warnings: string[];
}

const DAY = 86_400;
const WINDOW = 14 * DAY;

const bucket = (script: string, revision: string) => createHash("sha256").update(`${script}\n${revision}`).digest().readUInt32BE(0) % 10;

const SAMPLER = {
  identity: "sha256-first-u32be-mod10-v1",
  input: "UTF-8(repo-relative POSIX script path + LF + full source revision); no trailing LF; reject absolute paths, dot segments and backslashes",
  native_when: "verdict=native OR bucket=0; bucket is first 4 SHA-256 bytes as unsigned big-endian integer modulo 10",
  example_script: "test/native/pads/448/lich.pad",
  example_revision: "0123456789abcdef0123456789abcdef01234567",
  example_bucket: bucket("test/native/pads/448/lich.pad", "0123456789abcdef0123456789abcdef01234567"),
} as const;

const NOTES = [
  "Pad minutes = 2 clients × (game + reset + reload + run)/60; includes failed attempts, excludes Wisp/compare/wait. Accept elapsed time is allocated equally across checks assuming 2 clients: an estimate, not per-check timing. Batch timestamps fall back to file modification time.",
  "Release-box closure history and Wisp-only closure provenance are absent from these files: release denominators/shares are unavailable. No recorded retirement or skipped-run ledger: avoided minutes are unavailable; a recommendation is not an observed saving.",
];

const emptyCounts = (): Counts => ({ runs: 0, client_minutes: 0, estimated_minutes: 0, compared: 0, agrees: 0, disagrees: 0, invalid: 0 });

function add(counts: Counts, run: Run): void {
  counts.runs += 1;
  counts.client_minutes += run.client_minutes;
  if (run.estimated) counts.estimated_minutes += run.client_minutes;
  if (run.invalid) counts.invalid += 1;
  if (run.agreement === null) return;
  counts.compared += 1;
  if (run.agreement) counts.agrees += 1;
  else counts.disagrees += 1;
}

const sorted = <V>(map: Map<string, V>) => [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

/** The UTC Monday that starts the week of `at`, as YYYY-MM-DD. */
export function weekOf(at: number): string {
  const date = new Date(at * 1000);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function matchRule(id: string, scripts: string[]): Family["match_rule"] {
  if (id.startsWith("accept/")) return { kind: "none", values: [] };
  const parents = [...new Set(scripts.map(parentOf))].sort();
  return parents.every((parent) => parent.endsWith("/pads")) ? { kind: "exact-path", values: scripts } : { kind: "parent-directory", values: parents };
}

/** Each run kind over the last 14 days; a kind with at least ten agreements and no disagreement retires to Wisp only with a one-in-ten native sample. */
function families(runs: readonly Run[], now: number): Family[] {
  const counts = new Map<string, Counts>();
  const scripts = new Map<string, Set<string>>();
  for (const run of runs.filter((r) => r.at >= now - WINDOW && r.at <= now)) {
    add(counts.get(run.kind) ?? counts.set(run.kind, emptyCounts()).get(run.kind)!, run);
    if (run.script !== null) (scripts.get(run.kind) ?? scripts.set(run.kind, new Set()).get(run.kind)!).add(run.script);
  }
  return sorted(counts).map(([id, kindCounts]) => {
    const retired = kindCounts.agrees >= 10 && kindCounts.disagrees === 0;
    const kindScripts = [...(scripts.get(id) ?? [])].sort();
    return { id, scripts: kindScripts, match_rule: matchRule(id, kindScripts), verdict: retired ? "wisp-only" : "native", native_sample_rate: retired ? 0.1 : 1, counts: kindCounts, window_start_unix: now - WINDOW, window_end_unix: now };
  });
}

function weekly(runs: readonly Run[], minutes: Map<string, number>, now: number): Week[] {
  if (runs.length === 0) return [];
  const rows: Week[] = [];
  const first = Math.min(...runs.map((run) => run.at));
  for (let monday = Date.parse(`${weekOf(first)}T00:00:00Z`) / 1000; monday <= now; monday += 7 * DAY) {
    const week = weekOf(monday);
    rows.push({ week, native_client_minutes: minutes.get(week) ?? 0, wisp_commits: null, native_minutes_avoided: null, projected_sample_saving_minutes: 0, closed_public_boxes: null, minutes_per_closed_box: null, wisp_only_share: null });
  }
  return rows;
}

/** Per-kind weekly counts from `since` (unix seconds), the weekly trend, retire candidates and disagreements to fix. */
export function summarize(all: readonly Run[], since: number, now: number): Report {
  const familyRows = families(all, now);
  const retire = familyRows.filter((family) => family.verdict === "wisp-only").map((family) => family.id);
  const runs = all.filter((run) => run.at >= since && run.at <= now);
  const kinds = new Map<string, { week: string; kind: string; counts: Counts }>();
  const fixes = new Map<string, Set<string>>();
  for (const run of runs) {
    const week = weekOf(run.at);
    const key = `${week}\u0000${run.kind}`;
    add((kinds.get(key) ?? kinds.set(key, { week, kind: run.kind, counts: emptyCounts() }).get(key)!).counts, run);
    if (run.agreement === false) (fixes.get(run.kind) ?? fixes.set(run.kind, new Set()).get(run.kind)!).add(run.path);
  }
  const kindRows = sorted(kinds).map(([, row]) => row);
  const minutes = new Map<string, number>();
  const saving = new Map<string, number>();
  for (const { week, kind, counts } of kindRows) {
    minutes.set(week, (minutes.get(week) ?? 0) + counts.client_minutes);
    if (retire.includes(kind)) saving.set(week, (saving.get(week) ?? 0) + counts.client_minutes * 0.9);
  }
  const weeks = weekly(runs, minutes, now);
  for (const row of weeks) row.projected_sample_saving_minutes = saving.get(row.week) ?? 0;
  return {
    schema_version: 1, families: familyRows, sampler: SAMPLER, kinds: kindRows, weeks, retire,
    fixes: sorted(fixes).map(([kind, paths]) => ({ kind, evidence: [...paths].sort() })),
    files: [], runs, warnings: [...NOTES],
  };
}

/** An incomplete evidence scan recommends nothing: every family stays native and no saving is projected. */
export function suppress(report: Report): void {
  report.retire = [];
  for (const family of report.families) {
    family.verdict = "native";
    family.native_sample_rate = 1;
  }
  for (const row of report.weeks) row.projected_sample_saving_minutes = 0;
}

const total = (report: Report, key: keyof Counts) => report.kinds.reduce((sum, row) => sum + row.counts[key], 0);

/** The report's one-line summary, the first line of `native payoff`. */
const summary = (report: Report) =>
  `Wisp payoff: ${total(report, "agrees")}/${total(report, "compared")} agree · ${total(report, "client_minutes").toFixed(1)} native client-min* · ${report.retire.length} retire · ${report.fixes.length} fix · savings unknown`;

export function render(report: Report): string {
  const lines = [summary(report), "week       kind                         runs client-min agree/compared disagree invalid"];
  for (const { week, kind, counts: c } of report.kinds) {
    lines.push(`${week} ${kind.padEnd(28)} ${String(c.runs).padStart(4)} ${c.client_minutes.toFixed(2).padStart(10)} ${String(c.agrees).padStart(4)}/${String(c.compared).padEnd(8)} ${String(c.disagrees).padStart(8)} ${String(c.invalid).padStart(7)}`);
  }
  lines.push("", "Weekly trend (UTC Monday)", "week       native-client-min Wisp-commits avoided-min closed-boxes min/box Wisp-only-share projected-sample-saving-min");
  for (const row of report.weeks) {
    lines.push(`${row.week} ${row.native_client_minutes.toFixed(2).padStart(17)} ${String(row.wisp_commits ?? "unknown").padStart(12)}     unknown      unknown unknown unknown ${row.projected_sample_saving_minutes.toFixed(2).padStart(12)}`);
  }
  lines.push("", "Retire (last 14 days: >=10 agrees, zero disagreements): Wisp only; native sample 1 in 10");
  lines.push(...(report.retire.length === 0 ? ["  none"] : report.retire.map((kind) => `  ${kind}`)));
  lines.push("Fix (completed disagreements; investigate attribution before changing Wisp)");
  if (report.fixes.length === 0) lines.push("  none");
  for (const fix of report.fixes) lines.push(`  ${fix.kind}`, ...fix.evidence.map((path) => `    ${path}`));
  lines.push(...report.warnings.map((warning) => `Note: ${warning}`));
  return lines.join("\n");
}
