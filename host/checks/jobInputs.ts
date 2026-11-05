import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";

export interface FailedJob { readonly name: string; readonly steps: readonly string[] }
export interface ScopedJob { readonly name: string; readonly inputs: readonly string[] | undefined }

const CARGO_CRATES: Readonly<Record<string, string>> = { window: "window", "window-windows": "window", "relay-proto": "relay" };
const CARGO_STEP = /^Run cargo (?:build|test) /;
const INCLUDE = /include_(?:bytes|str)!\(\s*"([^"]+)"\s*\)/g;

function rustFiles(root: string, directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "target") return [];
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) return rustFiles(root, path);
    return entry.isFile() && entry.name.endsWith(".rs") ? [path] : [];
  });
}

export function cargoInputs(root: string, crate: string): readonly string[] {
  const outside = new Set<string>();
  for (const file of rustFiles(root, crate)) {
    for (const match of readFileSync(join(root, file), "utf8").matchAll(INCLUDE)) {
      const path = relative(root, join(root, dirname(file), match[1] ?? "")).split("\\").join("/");
      if (!path.startsWith(`${crate}/`)) outside.add(path);
    }
  }
  return [`${crate}/`, ".github/", ...[...outside].toSorted()];
}

export function scopeJob(job: FailedJob, inputsOf: (crate: string) => readonly string[]): ScopedJob {
  const crate = CARGO_CRATES[job.name];
  const cargoOnly = crate !== undefined && job.steps.length > 0 && job.steps.every((step) => CARGO_STEP.test(step));
  return { name: job.name, inputs: cargoOnly ? inputsOf(crate) : undefined };
}

export const touches = (files: readonly string[], inputs: readonly string[]) =>
  files.some((file) => inputs.some((input) => input.endsWith("/") ? file.startsWith(input) : file === input));
