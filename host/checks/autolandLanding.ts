type Landing = "land" | "retest";

const SHARED_INPUT = /^(?:\.github\/|bun\.lock$|package\.json$|tsconfig[^/]*$|typescript-toolchain\.lock$|knip\.json$|structure\.toml$|(?:.*\/)?Cargo\.(?:toml|lock)$|clean-room-allowlist\.tsv$)/;

const paths = (list: string): string[] => list.split("\n").filter((path) => path !== "");

export function landing(candidate: string, moved: string): Landing {
  const own = new Set(paths(candidate));
  return paths(moved).some((path) => SHARED_INPUT.test(path) || own.has(path)) ? "retest" : "land";
}

if (import.meta.main) console.log(landing(process.argv[2] ?? "", process.argv[3] ?? ""));
