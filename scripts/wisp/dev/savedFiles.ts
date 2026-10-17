import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import type { Changes } from "./testSelection";

const PROJECT_FILE = /^(?:tsconfig[^/]*\.json|package\.json|bunfig\.toml|[^/]*\.lock)$/;

const EDITOR_FILE = /^(?:\..*|.*~|.*\.sw[a-p]|4913)$/;

/** Whether a save of `path` reaches the tests: a project file at the root, or a file under one of `sources`. `wisp ci pre-merge` reads a diff the same way. */
export function followsSave(root: string, sources: readonly string[], path: string): boolean {
  const local = relative(root, path);
  if (local.startsWith("..") || EDITOR_FILE.test(basename(path)) || local.split(sep).includes("node_modules")) return false;
  return dirname(local) === "." ? PROJECT_FILE.test(local) : sources.some((source) => local.startsWith(`${source}${sep}`));
}

export const isProjectFile = (root: string, path: string) => dirname(relative(root, path)) === ".";

export class SavedFiles {
  private readonly hashes = new Map<string, number | bigint>();

  constructor(private readonly root: string, private readonly sources: readonly string[]) {
    for (const source of sources) {
      for (const path of new Bun.Glob("**/*").scanSync({ cwd: join(root, source), onlyFiles: true })) this.read(join(root, source, path));
    }
    for (const path of new Bun.Glob("*").scanSync({ cwd: root, onlyFiles: true })) if (PROJECT_FILE.test(path)) this.read(join(root, path));
  }

  follows(path: string): boolean {
    return followsSave(this.root, this.sources, path);
  }

  changes(paths: Iterable<string>): Changes {
    const changed: string[] = [];
    const created: string[] = [];
    const deleted: string[] = [];
    for (const path of paths) {
      const known = this.hashes.get(path);
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat === undefined) {
        if (known !== undefined) {
          this.hashes.delete(path);
          deleted.push(path);
        }
        continue;
      }
      if (!stat.isFile()) continue;
      const hash = this.read(path);
      if (known === undefined) created.push(path);
      else if (hash !== known) changed.push(path);
    }
    return { changed, created, deleted };
  }

  private read(path: string): number | bigint | undefined {
    try {
      const hash = Bun.hash(readFileSync(path));
      this.hashes.set(path, hash);
      return hash;
    } catch {
      return undefined;
    }
  }
}
