





import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { API, type Diagnostic, DiagnosticCategory, type Snapshot } from "typescript-native/unstable/async";

export interface TypeError {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: number;
  readonly message: string;
}

export interface FileCheck {

  readonly files: readonly string[];
  readonly errors: readonly TypeError[];
}

const flatten = (diagnostic: Diagnostic, depth = 0): string =>
  [`${"  ".repeat(depth)}${diagnostic.text}`, ...(diagnostic.messageChain ?? []).map((chained) => flatten(chained, depth + 1))].join("\n");


function position(text: string, offset: number): { readonly line: number; readonly column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = text.indexOf("\n"); index !== -1 && index < offset; index = text.indexOf("\n", index + 1)) {
    line++;
    lineStart = index + 1;
  }
  return { line, column: offset - lineStart + 1 };
}


export const formatTypeError = (root: string, error: TypeError) =>
  `${relative(root, error.file)}:${error.line}:${error.column} TS${error.code} ${error.message}`;

export class TypeChecker {
  private snapshot: Snapshot | undefined;

  private readonly members = new Map<string, Set<string>>();

  private pending: Promise<unknown> = Promise.resolve();

  private constructor(private readonly api: API, private readonly projects: readonly string[]) {}


  static async open(root: string, projects: readonly string[]): Promise<TypeChecker> {
    const checker = new TypeChecker(new API({ cwd: root }), projects.map((project) => resolve(root, project)));
    await checker.reopen();
    return checker;
  }


  reopen(): Promise<void> {
    return this.serially(async () => {
      await this.replace(this.snapshot === undefined ? { openProjects: [...this.projects] } : { fileChanges: { invalidateAll: true } });
      this.members.clear();
      for (const project of this.snapshot?.getProjects() ?? []) {
        this.members.set(project.configFileName, new Set((await project.program.getSourceFileNames()).map((name) => resolve(name))));
      }
    });
  }


  check(files: readonly string[]): Promise<FileCheck> {
    return this.serially(async () => {
      await this.replace({ fileChanges: { changed: [...files] } });
      const checked = new Set<string>();
      const results = await Promise.all((this.snapshot?.getProjects() ?? []).flatMap((project) => {
        const members = this.members.get(project.configFileName);
        return files.filter((file) => members?.has(file) === true).map(async (file) => {
          checked.add(file);
          const [syntactic, semantic] = await Promise.all([project.program.getSyntacticDiagnostics(file), project.program.getSemanticDiagnostics(file)]);
          return [...syntactic, ...semantic].map((diagnostic) => ({ file, diagnostic }));
        });
      }));
      const errors = new Map<string, TypeError>();
      const texts = new Map<string, string>();
      for (const { file, diagnostic } of results.flat()) {
        if (diagnostic.category !== DiagnosticCategory.Error && diagnostic.category !== DiagnosticCategory.Warning) continue;
        const path = diagnostic.fileName === undefined ? file : resolve(diagnostic.fileName);
        let text = texts.get(path);
        if (text === undefined) texts.set(path, text = readFileSync(path, "utf8"));
        const error = { file: path, ...position(text, diagnostic.pos), code: diagnostic.code, message: flatten(diagnostic) };

        errors.set(`${error.file}:${error.line}:${error.column}:${error.code}:${error.message}`, error);
      }
      return { files: files.filter((file) => checked.has(file)), errors: [...errors.values()] };
    });
  }

  close(): Promise<void> {
    return this.api.close();
  }

  private serially<A>(work: () => Promise<A>): Promise<A> {
    const result = this.pending.then(work, work);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async replace(params: Parameters<API["updateSnapshot"]>[0]): Promise<void> {
    const previous = this.snapshot;
    this.snapshot = await this.api.updateSnapshot(params);
    await previous?.dispose();
  }
}
