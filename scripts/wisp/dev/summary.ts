import type { ProcessOutput } from "../devProcesses";
import type { JourneyOutcome } from "../journeyRun";
import type { RegistryResult } from "../registryRun";
import type { Selection, TestUnit } from "../testSelection";

export interface ProcessResult {
  readonly passed: number;

  readonly failures: readonly string[];
}

const OUTPUT_LINES = 40;

export const elapsedLabel = (milliseconds: number) => `${(milliseconds / 1000).toFixed(3).padStart(8)} s  `;

export const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export const indent = (text: string) => text.split("\n").map((line) => `           ${line}`).join("\n");

export const counts = (passed: number, failed: number) => `${failed === 0 ? "" : `${plural(failed, "failure")}, `}${passed} passed`;

export const scope = (units: readonly TestUnit[], selection: Selection, total: number) => (selection.full === undefined
  ? `${plural(units.length, "test file")} of ${total} affected`
  : `${plural(units.length, "test file")}, all: ${selection.full}`);

export function fileResult(paths: string, { exitCode, output }: ProcessOutput): ProcessResult {
  const passed = Number(/^\s*(\d+) pass$/m.exec(output)?.[1] ?? 0);
  if (exitCode === 0) return { passed, failures: [] };
  const lines = output.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("bun test v"));
  const shown = lines.length > OUTPUT_LINES ? [...lines.slice(0, OUTPUT_LINES), `... ${lines.length - OUTPUT_LINES} more lines`] : lines;
  return { passed, failures: [`${paths} exited ${exitCode}:\n${shown.join("\n")}`] };
}

export const isRegistryResult = (value: unknown): value is RegistryResult =>
  typeof value === "object" && value !== null && "module" in value && "passed" in value && "failures" in value;

export function registryResult(modules: readonly TestUnit[], { exitCode, results, output }: ProcessOutput, local: (path: string) => string): ProcessResult {
  const reported = new Map(results.filter(isRegistryResult).map((result) => [result.module, result]));
  let passed = 0;
  const failures: string[] = [];
  for (const unit of modules) {
    const result = reported.get(unit.path);
    if (result === undefined) {
      failures.push(`${local(unit.path)} didn't run: the test process exited ${exitCode}${output === "" ? "" : `:\n${output}`}`);
      continue;
    }
    passed += result.passed;
    for (const { test, message } of result.failures) failures.push(`${local(unit.path)} > ${test}: ${message}`);
  }
  return { passed, failures };
}

const isJourneyOutcome = (value: unknown): value is JourneyOutcome =>
  typeof value === "object" && value !== null && ("stopped" in value || ("lines" in value && "problems" in value));

export interface JourneySummary {
  readonly summary: string;
  readonly report?: string;
}

export function journeySummary(name: string, output: ProcessOutput): JourneySummary {
  const outcome = output.results.find(isJourneyOutcome);
  if (outcome === undefined) return { summary: `${name} didn't finish`, report: `exited ${output.exitCode}\n${output.output}` };
  if ("stopped" in outcome) return { summary: `${name} stopped`, report: outcome.stopped };
  if (outcome.problems === 0) return { summary: `${name} passed` };
  return { summary: `${name}: ${plural(outcome.problems, "problem")}`, report: outcome.lines.join("\n") };
}
