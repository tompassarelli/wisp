



import { join } from "node:path";
import { Console, Data, Effect } from "effect";
import { captureProcess } from "./wisp/mapBuild";

export const ALLOWLIST = "clean-room-allowlist.tsv";


export const GAME_EXTENSIONS = [
  "mdx", "mdl", "blp", "dds", "tga", "wav", "mp3", "flac", "ogg", "opus", "w3x", "w3m", "w3n", "w3g", "mpq",
  "slk", "j", "ai", "fdf", "toc", "imp", "wts", "w3u", "w3t", "w3a", "w3b", "w3d", "w3h", "w3q", "w3e", "wpm",
  "doo", "shd", "mmp", "w3i", "w3r", "w3c", "w3s", "ttf", "otf", "png", "jpg", "jpeg", "gif", "webp", "bmp",
] as const;


const MAGIC = ["MDLX", "BLP1", "BLP2", "MPQ\x1a", "MPQ\x1b", "HM3W"];


export const JASS_DECLARATION = String.raw`^[[:space:]]*((constant[[:space:]]+)?native[[:space:]]+[A-Za-z0-9_]+[[:space:]]+takes[[:space:]]|function[[:space:]]+[A-Za-z0-9_]+[[:space:]]+takes[[:space:]].*[[:space:]]returns[[:space:]]|type[[:space:]]+[A-Za-z0-9_]+[[:space:]]+extends[[:space:]]|constant[[:space:]]+[A-Za-z0-9_]+[[:space:]]+[A-Za-z0-9_]+[[:space:]]*=)`;


export const JASS_LIMIT = 20;


export const JASS_SCAN_BYTES = 2_000_000;

export type Origin = "original" | "generated" | "stock-path";

export interface Policy {

  readonly origins: readonly Origin[];
}

export interface Entry { readonly path: string; readonly origin: string; readonly how: string }


export function parseAllowlist(text: string): Entry[] {
  return text.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#")).map((line) => {
    const [path = "", origin = "", how = ""] = line.split("\t");
    return { path, origin, how };
  });
}

const fix = (policy: Policy) => "Delete it, regenerate it from our own source, or load it from the user's install at run time;"
  + ` if it is ours, add it to ${ALLOWLIST} as PATH<TAB>${policy.origins.join("|")}<TAB>HOW (wisp:docs/clean-room.md).`;


export function cleanRoomProblems(input: {
  readonly files: readonly { readonly path: string; readonly head: string }[];
  readonly jassLines: ReadonlyMap<string, number>;
  readonly allowlist: readonly Entry[];
  readonly policy: Policy;
}): string[] {
  const problems: string[] = [];
  const FIX = fix(input.policy);
  const allowed = new Map(input.allowlist.map((entry) => [entry.path, entry]));
  const tracked = new Set(input.files.map(({ path }) => path));
  for (const entry of input.allowlist) {
    if (!(input.policy.origins as readonly string[]).includes(entry.origin)) {
      problems.push(`${ALLOWLIST}: ${entry.path} names origin "${entry.origin}"; this repository allows ${input.policy.origins.join(", ")} (wisp:docs/clean-room.md)`);
    } else if (entry.how.trim() === "") {
      problems.push(`${ALLOWLIST}: ${entry.path} doesn't say how it was made (wisp:docs/clean-room.md)`);
    }
    if (!tracked.has(entry.path)) problems.push(`${ALLOWLIST}: ${entry.path} isn't committed; remove its row`);
  }
  for (const { path, head } of input.files) {
    if (allowed.has(path)) continue;
    const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
    const magic = MAGIC.some((bytes) => head.startsWith(bytes));

    const gameExtension = (GAME_EXTENSIONS as readonly string[]).includes(extension) && (extension !== "mdx" || head.startsWith("MDLX"));
    if (gameExtension || magic) problems.push(`clean room: ${path} is a game-format file. ${FIX}`);
  }
  for (const [path, lines] of input.jassLines) {
    if (lines > JASS_LIMIT && !allowed.has(path)) {
      problems.push(`clean room: ${path} has ${lines} JASS declaration lines (over ${JASS_LIMIT}), like a copy of common.j or blizzard.j. ${FIX}`);
    }
  }
  return problems;
}

export class CleanRoomError extends Data.TaggedError("CleanRoomError")<{ readonly message: string }> {}

const git = (root: string, args: readonly string[]) => captureProcess(`git ${args[0]}`, root, ["git", "-C", root, ...args]);


export const cleanRoom = (root: string, policy: Policy) => Effect.gen(function*() {
  const listed = yield* git(root, ["ls-files", "-z"]);
  if (listed.exitCode !== 0) return yield* new CleanRoomError({ message: `clean room: git ls-files failed: ${listed.stderr.trim()}` });
  const paths = listed.stdout.split("\0").filter((path) => path !== "");
  const files = yield* Effect.forEach(paths, (path) => Effect.promise(async () => {
    const file = Bun.file(join(root, path));
    const bytes = await file.slice(0, 4).bytes().catch(() => new Uint8Array());
    return { path, head: String.fromCharCode(...bytes), size: file.size };
  }), { concurrency: 64 });
  const scanned = files.filter(({ size }) => size <= JASS_SCAN_BYTES).map(({ path }) => path);
  const batches = Array.from({ length: Math.ceil(scanned.length / 1000) }, (_, n) => scanned.slice(n * 1000, n * 1000 + 1000));
  const jassLines = new Map<string, number>();
  for (const batch of batches) {

    const grep = yield* git(root, ["grep", "--cached", "-z", "-c", "-I", "-E", JASS_DECLARATION, "--", ...batch.map((path) => `:(literal)${path}`)]);
    if (grep.exitCode > 1) return yield* new CleanRoomError({ message: `clean room: git grep failed: ${grep.stderr.trim()}` });
    for (const line of grep.stdout.split("\n").filter((line) => line !== "")) {
      const [path = "", count = "0"] = line.split("\0");
      jassLines.set(path, Number(count));
    }
  }
  const allowlistFile = Bun.file(join(root, ALLOWLIST));
  const allowlist = parseAllowlist((yield* Effect.promise(() => allowlistFile.exists())) ? yield* Effect.promise(() => allowlistFile.text()) : "");
  return cleanRoomProblems({ files, jassLines, allowlist, policy });
});


export const runCleanRoom = (root: string, policy: Policy) => cleanRoom(root, policy).pipe(
  Effect.flatMap((problems) => problems.length === 0
    ? Console.log("clean room: no game files or copied game scripts outside the allowlist")
    : Effect.forEach(problems, (problem) => Console.error(problem), { discard: true }).pipe(Effect.andThen(Effect.sync(() => process.exit(1))))),
);


export const WISP_POLICY: Policy = { origins: ["original", "generated"] };

if (import.meta.main) await Effect.runPromise(runCleanRoom(process.argv[2] ?? join(import.meta.dir, ".."), WISP_POLICY));
