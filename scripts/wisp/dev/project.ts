import type { HotProject } from "../hotReload";
import type { TestDeclaration } from "../testSelection";

export interface DevProject {

  readonly root: string;

  readonly sources: readonly string[];
  readonly typeCheck: {

    readonly projects: readonly string[];

    readonly command: readonly string[];
  };
  readonly tests: TestDeclaration;

  readonly journey?: { readonly module: string; readonly export: string; readonly name: string; readonly clients?: number };

  readonly hot?: HotProject;
}
