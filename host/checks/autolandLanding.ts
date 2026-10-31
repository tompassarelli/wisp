type Landing = "land" | "retest";

export type StackedLane = { readonly paths: string; readonly moved: boolean };

const SHARED_INPUT = /^(?:\.github\/|bun\.lock$|package\.json$|tsconfig[^/]*$|typescript-toolchain\.lock$|knip\.json$|structure\.toml$|(?:.*\/)?Cargo\.(?:toml|lock)$|clean-room-allowlist\.tsv$)/;

const paths = (list: string): string[] => list.split("\n").filter((path) => path !== "");

export function landing(candidate: string, moved: string): Landing {
  const own = new Set(paths(candidate));
  return paths(moved).some((path) => SHARED_INPUT.test(path) || own.has(path)) ? "retest" : "land";
}

export function landedPrefix(lanes: readonly StackedLane[], moved: string): number {
  const cut = lanes.findIndex((lane) => lane.moved || landing(lane.paths, moved) === "retest");
  return cut === -1 ? lanes.length : cut;
}

if (import.meta.main) console.log(landedPrefix(JSON.parse(process.argv[3] ?? "[]"), process.argv[2] ?? ""));
