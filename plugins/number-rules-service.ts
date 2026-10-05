// TypeScript language-service plugin: the editor reports the number rules
// (wisp:plugins/number-rules.ts) with the type errors. The package ships it
// as plugins/number-rules-service.cjs, which tsserver loads from a tsconfig:
//   "plugins": [{ "name": "wisp/plugins/number-rules-service.cjs", "project": "./tsconfig.game.json" }]
// `project` names the map's tsconfig when the editor's project also holds host
// code; the rules then apply only to files that config includes.
// TypeScript 7's language server loads no plugins; the check command
// (wisp:scripts/numberRules.ts) reports the same rules there.
import { resolve } from "node:path";
import type * as ts from "typescript";
import { programNumberRules } from "./number-rules";

interface Options {
  readonly project?: string;
}

export default function init({ typescript }: { typescript: typeof ts }): ts.server.PluginModule {
  const normalize = typescript.server.toNormalizedPath;
  return {
    create(info) {
      const service = info.languageService;
      const host = info.serverHost;
      let mapFiles: { readonly key: string; readonly names: ReadonlySet<string> } | undefined;
      /** Whether the map config includes the file; parsed again when the project's files or that config change. */
      const inMap = (fileName: string): boolean => {
        const { project }: Options = info.config;
        if (project === undefined) return true;
        const configPath = resolve(info.project.getCurrentDirectory(), project);
        const key = `${host.getModifiedTime?.(configPath)?.getTime()}\0${info.project.getRootFiles().join("\0")}`;
        if (mapFiles?.key !== key) {
          const parsed = typescript.getParsedCommandLineOfConfigFile(configPath, {}, {
            useCaseSensitiveFileNames: host.useCaseSensitiveFileNames,
            fileExists: (path) => host.fileExists(path),
            readFile: (path) => host.readFile(path),
            readDirectory: (path, extensions, excludes, includes, depth) => host.readDirectory(path, extensions, excludes, includes, depth),
            getCurrentDirectory: () => host.getCurrentDirectory(),
            onUnRecoverableConfigFileDiagnostic: () => {},
          });
          mapFiles = { key, names: new Set((parsed?.fileNames ?? []).map(normalize)) };
        }
        return mapFiles.names.has(normalize(fileName));
      };
      const proxy: ts.LanguageService = { ...service };
      proxy.getSemanticDiagnostics = (fileName) => {
        const diagnostics = service.getSemanticDiagnostics(fileName);
        const program = service.getProgram();
        const file = program?.getSourceFile(fileName);
        if (program === undefined || file === undefined || !inMap(fileName)) return diagnostics;
        return [...diagnostics, ...programNumberRules(typescript, program, file)];
      };
      return proxy;
    },
  };
}
