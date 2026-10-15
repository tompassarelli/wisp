import { relative } from "node:path";
import type { Changes, Reach, Selection, TestUnit } from "../testSelection";
import { isProjectFile } from "./savedFiles";
import { plural } from "./summary";

export interface SelectablePlan {
  all(): readonly TestUnit[];
  select(changes: Changes, reach: Reach): Selection;
  everything(reason: string): Selection;
}

export interface RunSelection {
  readonly selection: Selection;
  readonly saved: readonly string[];
  readonly changedModules: readonly string[];
  readonly reopen: boolean;
  readonly announce: readonly string[];
}

const PACKAGE_FILE = /(?:package\.json|\.lock)$/;

function deferredLines(selection: Selection, local: (path: string) => string): string[] {
  const deferred = selection.deferred ?? 0;
  const unread = selection.unread ?? [];
  return [
    ...(deferred > 0 ? [`left to the landing gate: ${plural(deferred, "test file")} that import the saved files only through other modules`] : []),
    ...(unread.length > 0 ? [`left to the landing gate: ${unread.map(local).join(", ")}, which no test declares reading`] : []),
  ];
}

export function selectRun(changes: Changes | undefined, plan: SelectablePlan, root: string): RunSelection {
  if (changes === undefined) {
    return { selection: { units: plan.all(), full: "the first run" }, saved: [], changedModules: [], reopen: false, announce: ["first run"] };
  }
  const local = (path: string) => relative(root, path);
  const saved = [...changes.changed, ...changes.created, ...changes.deleted];
  const projectFiles = saved.filter((path) => isProjectFile(root, path));
  const selection = projectFiles.length > 0 ? plan.everything(`${projectFiles.map(local).join(", ")} changed`) : plan.select(changes, "direct");
  return {
    selection,
    saved,
    changedModules: changes.changed.filter((path) => !isProjectFile(root, path)),
    reopen: projectFiles.length > 0 || changes.created.length > 0 || changes.deleted.length > 0,
    announce: [
      `saved ${saved.map(local).join(", ")}`,
      ...deferredLines(selection, local),
      ...(projectFiles.some((path) => PACKAGE_FILE.test(path)) ? ["packages changed: restart wisp dev to load them"] : []),
    ],
  };
}
