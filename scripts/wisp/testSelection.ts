








import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { ImportGraph, isModulePath } from "./importGraph";


export interface TestDeclaration {

  readonly files: readonly string[];

  readonly registry?: string;

  readonly registryRunners?: readonly string[];

  readonly preload?: readonly string[];

  readonly reads?: Readonly<Record<string, readonly string[]>>;





  readonly isolated?: readonly (readonly string[])[];

  readonly journeys?: readonly string[];





  readonly perFile?: readonly string[];





  readonly warm?: Readonly<Record<string, readonly string[]>>;

  readonly env?: Readonly<Record<string, string>>;

  readonly envForFiles?: (files: readonly string[]) => Readonly<Record<string, string>>;
}

export interface TestUnit {

  readonly path: string;
  readonly kind: "file" | "registry";
}

export interface Changes {
  readonly changed: readonly string[];
  readonly created: readonly string[];
  readonly deleted: readonly string[];
}

export interface Selection {
  readonly units: readonly TestUnit[];

  readonly full?: string;

  readonly audits?: ReadonlyMap<string, readonly string[]>;
}


const READS_FILES = /\b(?:readFileSync|readFile|readdirSync|readdir|Bun\.file|Bun\.Glob|sys\.readFile|createReadStream)\b/;

const scan = (root: string, pattern: string) => [...new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })]
  .filter((path) => !path.split("/").includes("node_modules"))
  .map((path) => resolve(root, path));

export class TestPlan {
  private graph!: ImportGraph;
  private units: readonly TestUnit[] = [];
  private preloads = new Set<string>();
  private readonly reads: readonly { readonly unit: string; readonly globs: readonly Bun.Glob[] }[];

  private everySave = new Map<string, string>();
  private readonly groups: ReadonlyMap<string, string>;
  private readonly journeys: ReadonlySet<string>;
  private readonly perFile: ReadonlySet<string>;

  constructor(private readonly root: string, private readonly declaration: TestDeclaration) {
    this.reads = Object.entries(declaration.reads ?? {}).map(([unit, globs]) => ({
      unit: resolve(root, unit),
      globs: globs.map((glob) => new Bun.Glob(glob)),
    }));
    this.journeys = new Set((declaration.journeys ?? []).map((path) => resolve(root, path)));
    this.perFile = new Set((declaration.perFile ?? []).map((path) => resolve(root, path)));
    this.groups = new Map((declaration.isolated ?? []).flatMap((group, index) => group.map((path) => [resolve(root, path), `isolated ${index}`] as const)));
    this.rescan();
  }


  isJourney(path: string): boolean {
    return this.journeys.has(path);
  }


  group(path: string): string {
    return this.groups.get(path) ?? "shared";
  }


  all(): readonly TestUnit[] {
    return this.units;
  }


  alwaysRun(): ReadonlyMap<string, string> {
    return this.everySave;
  }


  rescan(): void {
    const runners = new Set((this.declaration.registryRunners ?? []).map((path) => resolve(this.root, path)));
    const files = this.declaration.files.flatMap((pattern) => scan(this.root, pattern)).filter((path) => !runners.has(path));
    const registry = this.declaration.registry === undefined ? [] : scan(this.root, this.declaration.registry);
    const units = new Map<string, TestUnit>();
    for (const path of files) units.set(path, { path, kind: "file" });
    for (const path of registry) units.set(path, { path, kind: "registry" });
    this.units = [...units.values()].sort((left, right) => left.path.localeCompare(right.path));
    this.graph = new ImportGraph(this.root);
    const preload = (this.declaration.preload ?? []).map((path) => resolve(this.root, path));
    this.graph.add([...preload, ...this.units.map((unit) => unit.path)]);
    this.preloads = new Set(preload.flatMap((path) => [...this.graph.dependencies(path)]));
    this.classify();
  }


  select(changes: Changes): Selection {
    const created = changes.created[0];
    if (created !== undefined) return this.everything(`${this.local(created)} is new`);
    const deleted = changes.deleted[0];
    if (deleted !== undefined) return this.everything(`${this.local(deleted)} was deleted`);
    const selected = new Set<string>(this.everySave.keys());
    const read = new Map<string, string[]>();
    for (const path of changes.changed) {
      const readers = this.readers(path);
      for (const reader of readers) read.set(reader, [...read.get(reader) ?? [], path]);
      if (!isModulePath(path) || !this.graph.owns(path)) {
        if (readers.length === 0) return this.everything(`no test declares reading ${this.local(path)}`);
        continue;
      }
      if (!this.graph.has(path)) continue;
      this.graph.update(path);
      if (this.preloads.has(path)) return this.everything(`every test preloads ${this.local(path)}`);
      for (const dependent of this.graph.dependents(path)) selected.add(dependent);
    }
    this.classify();
    for (const path of this.everySave.keys()) selected.add(path);
    const audits = new Map<string, readonly string[]>();
    for (const [reader, paths] of read) {
      if (this.perFile.has(reader) && !selected.has(reader)) audits.set(reader, paths);
      selected.add(reader);
    }
    return { units: this.units.filter((unit) => selected.has(unit.path)), audits };
  }


  everything(reason: string): Selection {
    this.rescan();
    return { units: this.units, full: reason };
  }

  private readers(path: string): string[] {
    const local = this.local(path);
    return this.reads.filter(({ globs }) => globs.some((glob) => glob.match(local))).map(({ unit }) => unit);
  }

  private local(path: string): string {
    return relative(this.root, path);
  }

  private classify(): void {
    const declared = new Set(this.reads.map(({ unit }) => unit));
    this.everySave = new Map();
    for (const unit of this.units) {
      const computed = this.graph.computedImport(unit.path);
      if (computed !== undefined) {
        this.everySave.set(unit.path, `${this.local(computed)} has an import() the graph can't follow`);
        continue;
      }
      if (unit.kind === "file" && !declared.has(unit.path) && READS_FILES.test(readFileSync(unit.path, "utf8"))) {
        this.everySave.set(unit.path, "it reads files and declares none");
      }
    }
  }
}


export interface TestProcess {
  readonly kind: TestUnit["kind"];
  readonly units: readonly TestUnit[];

  readonly work: number;
}

interface Packing {
  readonly kind: TestUnit["kind"];
  readonly key: string;
  readonly units: TestUnit[];
  work: number;
}


function packSide(units: readonly TestUnit[], expected: (unit: TestUnit) => number, key: (unit: TestUnit) => string, count: number): Packing[] {
  const processes: Packing[] = [];
  for (const unit of [...units].sort((left, right) => expected(right) - expected(left))) {
    const shared = processes.filter((process) => process.key === key(unit));
    const lightest = processes.length < count ? undefined : shared.reduce<Packing | undefined>((least, process) => (least === undefined || process.work < least.work ? process : least), undefined);
    if (lightest === undefined) processes.push({ kind: unit.kind, key: key(unit), units: [unit], work: expected(unit) });
    else {
      lightest.units.push(unit);
      lightest.work += expected(unit);
    }
  }
  return processes;
}








export function packTests(units: readonly TestUnit[], expected: (unit: TestUnit) => number, group: (path: string) => string, count: number): TestProcess[] {
  const registry = units.filter((unit) => unit.kind === "registry");
  const files = units.filter((unit) => unit.kind === "file");
  const work = (side: readonly TestUnit[]) => side.reduce((sum, unit) => sum + expected(unit), 0);
  const longestFile = files.reduce((longest, unit) => Math.max(longest, expected(unit)), 0);
  const share = Math.max(longestFile, (work(registry) + work(files)) / count, 1);
  const registryCount = registry.length === 0 ? 0
    : files.length === 0 ? count
    : Math.min(Math.max(1, count - 1), Math.max(1, Math.ceil(work(registry) / share)));
  return [
    ...packSide(registry, expected, () => "registry", Math.max(1, registryCount)),
    ...packSide(files, expected, (unit) => group(unit.path), Math.max(1, count - registryCount)),
  ].map(({ kind, units: packed, work: expectedWork }) => ({
    kind,
    units: [...packed].sort((left, right) => left.path.localeCompare(right.path)),
    work: expectedWork,
  }));
}
